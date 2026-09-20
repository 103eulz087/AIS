using System.Data;
using Dapper;
using Akrho.Infrastructure.Storage;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>
/// Thrown by <see cref="IPublicVerificationRepository.GetPhotoAsync"/> for every failure case —
/// an unknown token, a revoked/expired credential, a deleted member, AND a perfectly valid
/// credential whose member has no photo on file, PLUS a photo path that usp_Credential_GetPhotoForVerification
/// resolved but that is missing from THIS environment's disk (CLAUDE.md §8.12 — photo storage is
/// local per deployment, the database is shared). All of these collapse to the identical marker
/// exception here, matching the procedure's own single THROW 51261 — never distinguish them in
/// the message or the resulting HTTP status (anti-enumeration).
/// </summary>
public sealed class PhotoNotFoundException() : Exception("Photo not found.");

internal static class PublicVerificationErrors
{
    // usp_Credential_GetPhotoForVerification's own single failure code — see its header comment.
    public const int PhotoNotFound = 51261;
}

/// <summary>
/// The single row usp_Credential_VerifyPublic returns — the public verification page's ENTIRE
/// view. IsValid=false collapses Invalid/Revoked/Expired into identical NULLs (anti-enumeration,
/// see the procedure's own header comment) — never branch on which failure it was, here or above.
/// </summary>
public sealed record PublicVerifyRow(
    string? GiftName, string? ChapterName, string? StatusName, DateTime? RenewedThrough, bool IsValid);

/// <summary>
/// Backs the one genuinely public, unauthenticated read path in this system. Deliberately takes
/// no caller-identity dependency — there is no signed-in caller to scope, and neither procedure
/// behind this repository accepts a scope parameter (their own header comments forbid adding
/// one). See usp_Credential_VerifyPublic.sql for why this is not a scoping gap.
/// </summary>
public interface IPublicVerificationRepository
{
    /// <summary>
    /// dbo.usp_Credential_VerifyPublic, always called with ScannedByMemberId = NULL and
    /// MeetingId = NULL — that pair of NULLs is what makes the call anonymous. Never add a way
    /// to pass either from here; a signed-in in-app scan goes through
    /// <see cref="ICredentialRepository.VerifyForMemberAsync"/> instead.
    /// </summary>
    Task<PublicVerifyRow> VerifyAsync(Guid tokenSubject, bool wasOffline, string? deviceHint, CancellationToken ct);

    /// <summary>
    /// dbo.usp_Credential_GetPhotoForVerification, then <see cref="IFileStorage.OpenReadAsync"/>.
    /// Throws <see cref="PhotoNotFoundException"/> for every failure case — a bad token AND a
    /// file genuinely missing from this environment's disk both collapse to the same exception,
    /// never a 500 (CLAUDE.md §8.12).
    /// </summary>
    Task<(Stream Stream, string? ContentType, string PhotoPath)> GetPhotoAsync(Guid tokenSubject, CancellationToken ct);
}

public sealed class PublicVerificationRepository(ISqlConnectionFactory factory, IFileStorage storage)
    : IPublicVerificationRepository
{
    public async Task<PublicVerifyRow> VerifyAsync(
        Guid tokenSubject, bool wasOffline, string? deviceHint, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.QuerySingleAsync<PublicVerifyRow>(new CommandDefinition(
            "dbo.usp_Credential_VerifyPublic",
            new
            {
                TokenSubject = tokenSubject,
                ScannedByMemberId = (int?)null, // NULL is what makes this call anonymous — never populate it here
                MeetingId = (int?)null,
                WasOffline = wasOffline,
                DeviceHint = deviceHint
            },
            commandType: CommandType.StoredProcedure,
            cancellationToken: ct));
    }

    public async Task<(Stream Stream, string? ContentType, string PhotoPath)> GetPhotoAsync(
        Guid tokenSubject, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);

        PhotoLookupRow row;
        try
        {
            row = await conn.QuerySingleAsync<PhotoLookupRow>(new CommandDefinition(
                "dbo.usp_Credential_GetPhotoForVerification",
                new { TokenSubject = tokenSubject },
                commandType: CommandType.StoredProcedure,
                cancellationToken: ct));
        }
        catch (SqlException ex) when (ex.Number == PublicVerificationErrors.PhotoNotFound)
        {
            throw new PhotoNotFoundException();
        }

        try
        {
            var stream = await storage.OpenReadAsync(row.PhotoPath, ct);
            return (stream, row.ContentType, row.PhotoPath);
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException or UnauthorizedAccessException)
        {
            // The database (shared across environments) resolved a photo path that does not
            // exist on THIS environment's disk — CLAUDE.md §8.12. Same "not found" as every
            // other failure case above; never a 500.
            throw new PhotoNotFoundException();
        }
    }

    private sealed record PhotoLookupRow(string PhotoPath, string? ContentType);
}
