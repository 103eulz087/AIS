using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum IdCardExportErrorCategory { Forbidden, Conflict }

/// <summary>
/// Thrown when either the bulk-issue or the list stored procedure behind the National ID card
/// export rejects a call. Same convention as <see cref="ChapterRegistrationException"/>/
/// <see cref="CredentialException"/> — the message was written in the procedure itself for the
/// National CouncilAdmin running the export; surface it plainly, never wrap it.
/// </summary>
public sealed class IdCardExportException : Exception
{
    public IdCardExportErrorCategory Category { get; }

    public IdCardExportException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // The caller holds a CouncilAdmin seat somewhere, but not on the National Council
            // specifically — the one seat that unlocks a national, cross-chapter bulk export
            // of member photos and identifiers.
            51581 => IdCardExportErrorCategory.Forbidden,

            // The National Council row itself is missing/misconfigured (no root Council row,
            // or no matching CouncilLevel). Not the caller's fault, and not fixable by
            // retrying the same request — a data-seeding problem, not an authorization one.
            51580 => IdCardExportErrorCategory.Conflict,

            _ => IdCardExportErrorCategory.Conflict
        };
    }
}

/// <summary>
/// The complete set of custom THROW numbers used by usp_Member_ListForIdCardExport and
/// usp_Credential_BulkIssueForExport. Anything else — a timeout, a deadlock, a dropped
/// connection — is a real unexpected error and must NOT be re-surfaced as a safe, human-authored
/// message (CLAUDE.md: never leak an exception message to the client).
/// </summary>
internal static class IdCardExportErrors
{
    private static readonly HashSet<int> Known = [51580, 51581];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// One row of dbo.usp_Member_ListForIdCardExport — everything the Magicard print run needs for
/// one member's card, plus the identifiers the API layer uses to name the exported spreadsheet
/// row and photo file. Chapter-homed members only (a detached, council-homed member has no
/// current chapter for a physical card batch to be organized by — see the procedure's own
/// header). TokenSubject is nullable in the row shape but expected non-null in practice, because
/// the caller is required to call <see cref="IIdCardExportRepository.BulkIssueCredentialsAsync"/>
/// first, in the same request, with the same (requestingMemberId, chapterId) pair.
/// </summary>
public sealed record IdCardExportMemberRow(
    int MemberId, string MemberNumber,
    string FirstName, string? MiddleName, string LastName, string GiftName,
    string? BloodTypeName,
    int ChapterId, string ChapterName, string? ChapterCode,
    string StatusName,
    string? PhotoPath, string? PhotoContentType,
    Guid? TokenSubject);

public interface IIdCardExportRepository
{
    /// <summary>
    /// dbo.usp_Credential_BulkIssueForExport. Issues a MemberCredential row for every in-scope
    /// member who does not already have a currently-valid one — idempotent, mirroring
    /// usp_Credential_GetOrIssueForSelf's own rule exactly: a repeat call for a member already
    /// covered issues nothing new for him. Must be called BEFORE
    /// <see cref="ListForExportAsync"/>, with the SAME (requestingMemberId, chapterId) pair, in
    /// the same request — that is what makes TokenSubject come back non-null on that later call
    /// in practice. <paramref name="requestingMemberId"/> is always the caller's own id
    /// (ICurrentUser.MemberId), never a request parameter (CLAUDE.md invariant #4/#11); NULL
    /// <paramref name="chapterId"/> means every chapter. Throws
    /// <see cref="IdCardExportException"/> (Forbidden / Conflict).
    /// </summary>
    Task<int> BulkIssueCredentialsAsync(
        int requestingMemberId, int? chapterId, DateTime? expiryDate, CancellationToken ct);

    /// <summary>
    /// dbo.usp_Member_ListForIdCardExport. Same caller/scope rules as
    /// <see cref="BulkIssueCredentialsAsync"/>. Throws <see cref="IdCardExportException"/>
    /// (Forbidden / Conflict).
    /// </summary>
    Task<IReadOnlyList<IdCardExportMemberRow>> ListForExportAsync(
        int requestingMemberId, int? chapterId, CancellationToken ct);
}

public sealed class IdCardExportRepository(ISqlConnectionFactory factory) : IIdCardExportRepository
{
    public async Task<int> BulkIssueCredentialsAsync(
        int requestingMemberId, int? chapterId, DateTime? expiryDate, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "dbo.usp_Credential_BulkIssueForExport",
                new { RequestingMemberId = requestingMemberId, ChapterId = chapterId, ExpiryDate = expiryDate },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (IdCardExportErrors.IsKnown(ex.Number))
        {
            throw new IdCardExportException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<IdCardExportMemberRow>> ListForExportAsync(
        int requestingMemberId, int? chapterId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<IdCardExportMemberRow>(new CommandDefinition(
                "dbo.usp_Member_ListForIdCardExport",
                new { RequestingMemberId = requestingMemberId, ChapterId = chapterId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (IdCardExportErrors.IsKnown(ex.Number))
        {
            throw new IdCardExportException(ex.Number, ex.Message);
        }
    }
}
