using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum CredentialErrorCategory { NotFound, BadRequest }

/// <summary>
/// Thrown when usp_Credential_GetOrIssueForSelf rejects a call. Same pattern as
/// <see cref="MemberProfileException"/> — the message was written in the procedure for the
/// member reading his own Digital ID screen; surface it plainly.
/// </summary>
public sealed class CredentialException : Exception
{
    public CredentialErrorCategory Category { get; }

    public CredentialException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Member not found." — defence in depth only. usp_Credential_GetOrIssueForSelf
            // takes no MemberId parameter to substitute; this only fires if the CALLER's own
            // member row is gone, which should be unreachable for an authenticated caller.
            51260 => CredentialErrorCategory.NotFound,

            _ => CredentialErrorCategory.BadRequest
        };
    }
}

internal static class CredentialErrors
{
    private static readonly HashSet<int> Known = [51260];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// The single row usp_Credential_GetOrIssueForSelf returns — everything the Digital ID screen's
/// front/back needs to render. Never the QR token payload itself (that's CredentialService's
/// job, a later slice, built on TokenSubject/KeyVersion here) — see the procedure's own header
/// comment. RenewedThrough is raw and nullable: NULL means "no Portal renewal has run yet", not
/// "lapsed" — never coerce it into a fake status here or in the DTO layer above.
/// </summary>
public sealed record MemberCredentialRow(
    Guid TokenSubject, int KeyVersion, bool IsNewlyIssued,
    DateTime CredentialIssuedDate, DateTime CredentialExpiryDate,
    string GiftName, string FirstName, string? MiddleName, string LastName,
    string MemberNumber,
    int? ChapterId, string? ChapterName, string? ChapterCode,
    string? NationalCouncilName, string? RegionName, string? ProvinceName, string? CityName,
    DateTime? DateSurvive, string? BloodTypeName,
    string StatusName, DateTime? RenewedThrough);

public interface ICredentialRepository
{
    /// <summary>
    /// Self-only, same shape as <see cref="IMemberProfileRepository.GetOwnProfileAsync"/> — no
    /// MemberId parameter to substitute; <paramref name="memberId"/> is the CALLER's own id from
    /// the JWT (CLAUDE.md invariant #4/#11), never a value from the request. Idempotent: calling
    /// this repeatedly returns the same TokenSubject as long as the existing credential is still
    /// live (see the procedure's own header comment for the race-safety design).
    /// Throws <see cref="CredentialException"/> (NotFound) — unreachable in the normal case
    /// (the caller IS the row), defence in depth only.
    /// </summary>
    Task<MemberCredentialRow> GetOrIssueForSelfAsync(int memberId, CancellationToken ct);
}

public sealed class CredentialRepository(ISqlConnectionFactory factory) : ICredentialRepository
{
    public async Task<MemberCredentialRow> GetOrIssueForSelfAsync(int memberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            // All data access goes through a stored procedure. No inline SQL, ever.
            return await conn.QuerySingleAsync<MemberCredentialRow>(new CommandDefinition(
                "dbo.usp_Credential_GetOrIssueForSelf",
                new { RequestingMemberId = memberId },   // from the token, never the body
                commandType: CommandType.StoredProcedure,
                cancellationToken: ct));
        }
        catch (SqlException ex) when (CredentialErrors.IsKnown(ex.Number))
        {
            throw new CredentialException(ex.Number, ex.Message);
        }
    }
}
