using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum CorrectiveActionErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when a CorrectiveAction stored procedure rejects a call. Same pattern as
/// <see cref="MeetingException"/>/<see cref="DonationException"/> — every message on these
/// THROWs was written in the procedure to reach the officer or member reading the screen;
/// surface it plainly at the endpoint, never wrap it in something generic.
/// </summary>
public sealed class CorrectiveActionException : Exception
{
    public CorrectiveActionErrorCategory Category { get; }

    public CorrectiveActionException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Corrective action not found" — usp_CorrectiveAction_AddUpdate (case gone) and
            // usp_CorrectiveAction_Get (nonexistent id AND wrong-chapter caller, deliberately
            // identical — anti-enumeration). Do not split either case.
            51253 or 51257 => CorrectiveActionErrorCategory.NotFound,

            // Role/chapter checks the procedures themselves enforce, in addition to
            // ChapterDisciplineWrite / IScopeGuard (defence in depth).
            51249 or 51254 or 51256 => CorrectiveActionErrorCategory.Forbidden,

            // A malformed payload: a subject outside the chapter, an unrecognised category,
            // an unrecognised status, or a blank narrative.
            51250 or 51251 or 51252 or 51255 => CorrectiveActionErrorCategory.BadRequest,

            _ => CorrectiveActionErrorCategory.BadRequest
        };
    }
}

/// <summary>
/// The complete set of custom THROW numbers used by the CorrectiveAction procs. Anything
/// else — a timeout, a deadlock, a dropped connection — is a real unexpected error and must
/// NOT be re-surfaced as a safe, human-authored message; it is left to propagate to the
/// generic 500 handler instead (CLAUDE.md: never leak an exception message to the client).
/// </summary>
internal static class CorrectiveActionErrors
{
    private static readonly HashSet<int> Known = Enumerable.Range(51249, 51257 - 51249 + 1).ToHashSet();

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// One row of a chapter's corrective-action list (usp_CorrectiveAction_GetByChapter). The
/// narrative fields are NULL exactly when CanSeeNarrative is 0 — decided in SQL, per row; the
/// repository does not interpret or recompute this bit, only carries it through.
/// </summary>
public sealed record CorrectiveActionListRow(
    int CaseId, int ChapterId,
    int MemberId, string GiftName, string MemberNumber,
    int CategoryId, string CategoryName,
    string StatusName, DateTime DateFiled, DateTime? ResolutionDate,
    bool CanSeeNarrative,
    string? Content, string? ResolutionNotes, int? FiledBy, string? FiledByGiftName,
    int TotalCount);

/// <summary>One corrective action's header (usp_CorrectiveAction_Get, result set 1). Same per-caller NULLing as <see cref="CorrectiveActionListRow"/>.</summary>
public sealed record CorrectiveActionHeaderRow(
    int CaseId, int ChapterId,
    int MemberId, string GiftName, string MemberNumber,
    int CategoryId, string CategoryName,
    string StatusName, DateTime DateFiled, DateTime? ResolutionDate,
    bool CanSeeNarrative,
    string? Content, string? ResolutionNotes, int? FiledBy, string? FiledByGiftName);

/// <summary>
/// One status-history entry (usp_CorrectiveAction_Get, result set 2). StatusName/UpdateDate
/// are ALWAYS populated (the public four-field rule); UpdatedBy/UpdatedByGiftName/Notes are
/// NULL exactly when the header's CanSeeNarrative is 0 — the identical flag, not a second
/// independent decision.
/// </summary>
public sealed record CorrectiveActionTimelineRow(
    int UpdateId, DateTime UpdateDate, string StatusName,
    int? UpdatedBy, string? UpdatedByGiftName, string? Notes);

public sealed record CorrectiveActionDetailRows(
    CorrectiveActionHeaderRow Header, IReadOnlyList<CorrectiveActionTimelineRow> Timeline);

public sealed record AddCorrectiveActionUpdateResultRow(int CaseId, string StatusName);

public interface ICorrectiveActionRepository
{
    /// <summary>Throws <see cref="CorrectiveActionException"/> (Forbidden / BadRequest). Returns the new CaseId.</summary>
    Task<int> FileAsync(
        int chapterId, int requestingMemberId, int subjectMemberId, int categoryId,
        DateOnly dateFiled, string content, string? initialStatusName, CancellationToken ct);

    /// <summary>Throws <see cref="CorrectiveActionException"/> (NotFound / Forbidden / BadRequest).</summary>
    Task<AddCorrectiveActionUpdateResultRow> AddUpdateAsync(
        int caseId, int requestingMemberId, string newStatusName, string? notes, CancellationToken ct);

    /// <summary>Throws <see cref="CorrectiveActionException"/> (Forbidden) if the caller is not a member of the chapter.</summary>
    Task<IReadOnlyList<CorrectiveActionListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take, CancellationToken ct);

    /// <summary>Throws <see cref="CorrectiveActionException"/> (NotFound) — same message for a bad id or a wrong chapter.</summary>
    Task<CorrectiveActionDetailRows> GetAsync(int caseId, int requestingMemberId, CancellationToken ct);
}

public sealed class CorrectiveActionRepository(ISqlConnectionFactory factory) : ICorrectiveActionRepository
{
    public async Task<int> FileAsync(
        int chapterId, int requestingMemberId, int subjectMemberId, int categoryId,
        DateOnly dateFiled, string content, string? initialStatusName, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var args = new DynamicParameters();
            args.Add("ChapterId", chapterId);
            args.Add("RequestingMemberId", requestingMemberId);
            args.Add("SubjectMemberId", subjectMemberId);
            args.Add("CategoryId", categoryId);
            args.Add("DateFiled", dateFiled.ToDateTime(TimeOnly.MinValue));
            args.Add("Content", content);
            // The procedure's own default ('Pending') applies when we omit the parameter —
            // never send an empty string here, that would fail the proc's own status check.
            if (!string.IsNullOrWhiteSpace(initialStatusName))
                args.Add("InitialStatusName", initialStatusName);

            return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "dbo.usp_CorrectiveAction_File", args,
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CorrectiveActionErrors.IsKnown(ex.Number))
        {
            throw new CorrectiveActionException(ex.Number, ex.Message);
        }
    }

    public async Task<AddCorrectiveActionUpdateResultRow> AddUpdateAsync(
        int caseId, int requestingMemberId, string newStatusName, string? notes, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<AddCorrectiveActionUpdateResultRow>(new CommandDefinition(
                "dbo.usp_CorrectiveAction_AddUpdate",
                new
                {
                    CaseId = caseId,
                    RequestingMemberId = requestingMemberId,
                    NewStatusName = newStatusName,
                    Notes = notes
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CorrectiveActionErrors.IsKnown(ex.Number))
        {
            throw new CorrectiveActionException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<CorrectiveActionListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<CorrectiveActionListRow>(new CommandDefinition(
                "dbo.usp_CorrectiveAction_GetByChapter",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 500)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (CorrectiveActionErrors.IsKnown(ex.Number))
        {
            throw new CorrectiveActionException(ex.Number, ex.Message);
        }
    }

    public async Task<CorrectiveActionDetailRows> GetAsync(int caseId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_CorrectiveAction_Get",
                new { CaseId = caseId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var header = await multi.ReadSingleAsync<CorrectiveActionHeaderRow>();
            var timeline = (await multi.ReadAsync<CorrectiveActionTimelineRow>()).ToList();

            return new CorrectiveActionDetailRows(header, timeline);
        }
        catch (SqlException ex) when (CorrectiveActionErrors.IsKnown(ex.Number))
        {
            throw new CorrectiveActionException(ex.Number, ex.Message);
        }
    }
}
