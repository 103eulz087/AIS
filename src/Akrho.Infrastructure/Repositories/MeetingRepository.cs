using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum MeetingErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when a Meeting stored procedure (or usp_Ledger_Reverse, called directly by
/// usp_Meeting_Reopen) rejects a call. Every message on these THROWs was written in the
/// procedure specifically to reach the officer reading the screen — surface it plainly
/// at the endpoint, never wrap it in something generic.
/// </summary>
public sealed class MeetingException : Exception
{
    public MeetingErrorCategory Category { get; }

    public MeetingException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Meeting not found" — thrown identically for a nonexistent id and for a
            // wrong-chapter caller. Deliberate anti-enumeration; do not split this case.
            51030 or 51155 or 51159 or 51160 or 51163
                => MeetingErrorCategory.NotFound,

            // The resource's state changed under the caller (already finalized, not yet
            // finalized, etc.) — nothing about the request itself was invalid.
            51031 or 51153 or 51156 or 51161 or 51166
                => MeetingErrorCategory.Conflict,

            // Role/chapter checks the procedure itself enforces, in addition to
            // IScopeGuard and the endpoint's authorization policy (defence in depth).
            51032 or 51152 or 51154 or 51157 or 51158 or 51162 or 51164 or 51167
                => MeetingErrorCategory.Forbidden,

            // A malformed payload: an attendance row for someone outside the chapter,
            // an unrecognised attendance status, or a reopen reason under 10 characters.
            51150 or 51151 or 51165
                => MeetingErrorCategory.BadRequest,

            _ => MeetingErrorCategory.BadRequest
        };
    }
}

/// <summary>
/// The complete set of custom THROW numbers used by the Meeting procs. Anything else —
/// a timeout, a deadlock, a dropped connection — is a real unexpected error and must NOT
/// be re-surfaced as a safe, human-authored message; it is left to propagate to the
/// generic 500 handler instead (CLAUDE.md: never leak an exception message to the client).
/// </summary>
internal static class MeetingErrors
{
    private static readonly HashSet<int> Known =
    [
        51030, 51031, 51032,
        51150, 51151, 51152, 51153, 51154, 51155, 51156, 51157, 51158, 51159,
        51160, 51161, 51162, 51163, 51164, 51165, 51166, 51167
    ];

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

public sealed record MeetingListRow(
    int MeetingId, string Subject, DateTime MeetingDate, string? Location,
    bool IsFinalized, DateTime? FinalizedDate,
    decimal CollectionTotal, int PresentCount, int LateCount, int TotalCount);

public sealed record MeetingHeaderRow(
    int MeetingId, int ChapterId, string Subject, DateTime MeetingDate, string? Body, string? Location,
    bool IsFinalized, int? FinalizedBy, DateTime? FinalizedDate, int CreatedBy, DateTime CreatedDate,
    int? LedgerEntryId, bool LedgerEntryIsReversed);

/// <summary>
/// NULL AttendanceStatusId/FundAmount/CheckedInAt means "not recorded" — a real, distinct
/// state from "recorded as absent" or "recorded as ₱0". Never coalesced away in this layer.
/// </summary>
public sealed record MeetingAttendanceRow(
    int MemberId, string GiftName, string MemberNumber, string StatusName,
    int? AttendanceStatusId, decimal? FundAmount, DateTime? CheckedInAt);

public sealed record MeetingReopenRow(
    int MeetingReopenId, int ReopenedBy, DateTime ReopenedDate, string Reason, int? ReversedLedgerEntryId);

public sealed record MeetingDetailRows(
    MeetingHeaderRow Header,
    IReadOnlyList<MeetingAttendanceRow> Attendance,
    IReadOnlyList<MeetingReopenRow> ReopenHistory);

public sealed record AttendanceRowInput(int MemberId, int AttendanceStatusId, decimal FundAmount, string? CheckedInVia);

public sealed record SaveAttendanceResultRow(int MeetingId, int RowsSaved, bool Finalized, int? LedgerEntryId);

public sealed record ReopenResultRow(int MeetingId, int? ReversedLedgerEntryId);

public interface IMeetingRepository
{
    /// <summary>Throws <see cref="MeetingException"/> (Forbidden) if the caller is not a chapter officer/admin.</summary>
    Task<int> CreateAsync(
        int chapterId, int requestingMemberId, string subject, DateOnly meetingDate,
        string? location, string? body, CancellationToken ct);

    /// <summary>Throws <see cref="MeetingException"/> (NotFound / Conflict / Forbidden).</summary>
    Task UpdateAsync(
        int meetingId, int requestingMemberId, string subject, DateOnly meetingDate,
        string? location, string? body, CancellationToken ct);

    Task<IReadOnlyList<MeetingListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take, CancellationToken ct);

    /// <summary>Throws <see cref="MeetingException"/> (NotFound) — same message for a bad id or a wrong chapter.</summary>
    Task<MeetingDetailRows> GetAsync(int meetingId, int requestingMemberId, CancellationToken ct);

    /// <summary>Throws <see cref="MeetingException"/> (NotFound / Conflict / Forbidden / BadRequest).</summary>
    Task<SaveAttendanceResultRow> SaveAttendanceAsync(
        int meetingId, int requestingMemberId, IReadOnlyList<AttendanceRowInput> rows,
        bool finalize, CancellationToken ct);

    /// <summary>Throws <see cref="MeetingException"/> (NotFound / Conflict / Forbidden).</summary>
    Task ClearAttendanceAsync(int meetingId, int memberId, int requestingMemberId, CancellationToken ct);

    /// <summary>Throws <see cref="MeetingException"/> (NotFound / Conflict / Forbidden / BadRequest).</summary>
    Task<ReopenResultRow> ReopenAsync(int meetingId, string reason, int requestingMemberId, CancellationToken ct);
}

public sealed class MeetingRepository(ISqlConnectionFactory factory) : IMeetingRepository
{
    public async Task<int> CreateAsync(
        int chapterId, int requestingMemberId, string subject, DateOnly meetingDate,
        string? location, string? body, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "dbo.usp_Meeting_Create",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Subject = subject,
                    MeetingDate = meetingDate.ToDateTime(TimeOnly.MinValue),
                    Location = location,
                    Body = body
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MeetingErrors.IsKnown(ex.Number))
        {
            throw new MeetingException(ex.Number, ex.Message);
        }
    }

    public async Task UpdateAsync(
        int meetingId, int requestingMemberId, string subject, DateOnly meetingDate,
        string? location, string? body, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Meeting_Update",
                new
                {
                    MeetingId = meetingId,
                    RequestingMemberId = requestingMemberId,
                    Subject = subject,
                    MeetingDate = meetingDate.ToDateTime(TimeOnly.MinValue),
                    Location = location,
                    Body = body
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MeetingErrors.IsKnown(ex.Number))
        {
            throw new MeetingException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<MeetingListRow>> GetByChapterAsync(
        int chapterId, int requestingMemberId, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<MeetingListRow>(new CommandDefinition(
                "dbo.usp_Meeting_GetByChapter",
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
        catch (SqlException ex) when (MeetingErrors.IsKnown(ex.Number))
        {
            throw new MeetingException(ex.Number, ex.Message);
        }
    }

    public async Task<MeetingDetailRows> GetAsync(int meetingId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_Meeting_Get",
                new { MeetingId = meetingId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var header = await multi.ReadSingleAsync<MeetingHeaderRow>();
            var attendance = (await multi.ReadAsync<MeetingAttendanceRow>()).ToList();
            var reopenHistory = (await multi.ReadAsync<MeetingReopenRow>()).ToList();

            return new MeetingDetailRows(header, attendance, reopenHistory);
        }
        catch (SqlException ex) when (MeetingErrors.IsKnown(ex.Number))
        {
            throw new MeetingException(ex.Number, ex.Message);
        }
    }

    public async Task<SaveAttendanceResultRow> SaveAttendanceAsync(
        int meetingId, int requestingMemberId, IReadOnlyList<AttendanceRowInput> rows,
        bool finalize, CancellationToken ct)
    {
        var table = new DataTable();
        table.Columns.Add("MemberId", typeof(int));
        table.Columns.Add("AttendanceStatusId", typeof(int));
        table.Columns.Add("FundAmount", typeof(decimal));
        table.Columns.Add("CheckedInVia", typeof(string));

        foreach (var row in rows)
            table.Rows.Add(row.MemberId, row.AttendanceStatusId, row.FundAmount, (object?)row.CheckedInVia ?? DBNull.Value);

        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<SaveAttendanceResultRow>(new CommandDefinition(
                "dbo.usp_Meeting_SaveAttendance",
                new
                {
                    RequestingMemberId = requestingMemberId,
                    MeetingId = meetingId,
                    Rows = table.AsTableValuedParameter("dbo.AttendanceRow"),
                    Finalize = finalize
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MeetingErrors.IsKnown(ex.Number))
        {
            throw new MeetingException(ex.Number, ex.Message);
        }
    }

    public async Task ClearAttendanceAsync(int meetingId, int memberId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Meeting_ClearAttendance",
                new { MeetingId = meetingId, MemberId = memberId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MeetingErrors.IsKnown(ex.Number))
        {
            throw new MeetingException(ex.Number, ex.Message);
        }
    }

    public async Task<ReopenResultRow> ReopenAsync(int meetingId, string reason, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ReopenResultRow>(new CommandDefinition(
                "dbo.usp_Meeting_Reopen",
                new { MeetingId = meetingId, Reason = reason, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MeetingErrors.IsKnown(ex.Number))
        {
            throw new MeetingException(ex.Number, ex.Message);
        }
    }
}
