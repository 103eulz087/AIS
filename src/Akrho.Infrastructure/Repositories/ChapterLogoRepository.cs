using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum ChapterLogoErrorCategory { NotFound, Forbidden, BadRequest }

/// <summary>
/// Thrown when usp_Chapter_SetLogo/_GetLogoForMember rejects a call. Same pattern as
/// <see cref="MemberAccountActionException"/> — the message was written in the procedure
/// for the President reading his own upload screen; surface it plainly.
/// </summary>
public sealed class ChapterLogoException : Exception
{
    public ChapterLogoErrorCategory Category { get; }

    public ChapterLogoException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "No chapter logo on file." — usp_Chapter_GetLogoForMember's own not-found.
            51923 => ChapterLogoErrorCategory.NotFound,

            // Not the seated ChapterAdmin (President) of the caller's own chapter.
            51921 => ChapterLogoErrorCategory.Forbidden,

            // A detached, chapter-less member (51920), or a bad/consumed staging id (51922).
            _ => ChapterLogoErrorCategory.BadRequest
        };
    }
}

internal static class ChapterLogoErrors
{
    private static readonly HashSet<int> Known = [51920, 51921, 51922, 51923];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>usp_Chapter_GetLogoForMember's result — LogoContentType (added 2026-09-30) is
/// the actual uploaded format, since any image format is now accepted (relaxed from
/// PNG-only), so it can no longer be assumed at the serving endpoint.</summary>
public sealed record ChapterLogoRow(string LogoPath, string? LogoContentType);

public interface IChapterLogoRepository
{
    /// <summary>President (ChapterAdmin) only — claims a staged upload as the caller's OWN
    /// chapter's logo, live immediately (client decision 2026-09-29: no approval step).
    /// Throws <see cref="ChapterLogoException"/> (Forbidden / BadRequest).</summary>
    Task<string> SetLogoAsync(int requestingMemberId, int attachmentStagingId, CancellationToken ct);

    /// <summary>Any authenticated member — reads back his OWN chapter's logo path and
    /// content type (never a target id; self-scoped, same shape as
    /// <see cref="IMemberProfileRepository.GetOwnProfileAsync"/>).
    /// Throws <see cref="ChapterLogoException"/> (NotFound) when none is on file.</summary>
    Task<ChapterLogoRow> GetLogoPathForMemberAsync(int requestingMemberId, CancellationToken ct);
}

public sealed class ChapterLogoRepository(ISqlConnectionFactory factory) : IChapterLogoRepository
{
    public async Task<string> SetLogoAsync(int requestingMemberId, int attachmentStagingId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<string>(new CommandDefinition(
                "dbo.usp_Chapter_SetLogo",
                new { RequestingMemberId = requestingMemberId, AttachmentStagingId = attachmentStagingId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChapterLogoErrors.IsKnown(ex.Number))
        {
            throw new ChapterLogoException(ex.Number, ex.Message);
        }
    }

    public async Task<ChapterLogoRow> GetLogoPathForMemberAsync(int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChapterLogoRow>(new CommandDefinition(
                "dbo.usp_Chapter_GetLogoForMember",
                new { RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChapterLogoErrors.IsKnown(ex.Number))
        {
            throw new ChapterLogoException(ex.Number, ex.Message);
        }
    }
}
