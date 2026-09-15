using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>
/// One row, always. IsValid = false covers expired, redeemed, invalidated, or an
/// unrecognised hash alike — usp_Enrolment_Get does not distinguish them, and neither
/// should the API: none of those distinctions helps an attacker, and the UI only needs
/// "still good" vs. "ask your chapter for a new one".
/// </summary>
public sealed record EnrolmentLinkRow(bool IsValid, string? FirstName, string? GiftName, string? ChapterName, DateTime? ExpiresOn);

public sealed record EnrolmentRedeemResultRow(int AccountId, int MemberId);

public enum EnrolmentFailureReason { LinkInvalid, MemberNotFound }

/// <summary>Thrown when <c>usp_Enrolment_Redeem</c> rejects a token. Both reasons read the same to the officer.</summary>
public sealed class EnrolmentException(EnrolmentFailureReason reason)
    : Exception("Enrolment link rejected.")
{
    public EnrolmentFailureReason Reason { get; } = reason;
}

public interface IEnrolmentRepository
{
    Task<EnrolmentLinkRow> GetAsync(byte[] tokenHash, CancellationToken ct);

    /// <summary>Throws <see cref="EnrolmentException"/> if the link is no longer valid or the member is gone.</summary>
    Task<EnrolmentRedeemResultRow> RedeemAsync(byte[] tokenHash, string passwordHash, string? ip, CancellationToken ct);
}

public sealed class EnrolmentRepository(ISqlConnectionFactory factory) : IEnrolmentRepository
{
    public async Task<EnrolmentLinkRow> GetAsync(byte[] tokenHash, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.QuerySingleAsync<EnrolmentLinkRow>(new CommandDefinition(
            "dbo.usp_Enrolment_Get",
            new { TokenHash = tokenHash },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }

    public async Task<EnrolmentRedeemResultRow> RedeemAsync(
        byte[] tokenHash, string passwordHash, string? ip, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<EnrolmentRedeemResultRow>(new CommandDefinition(
                "dbo.usp_Enrolment_Redeem",
                new { TokenHash = tokenHash, PasswordHash = passwordHash, Ip = ip },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ex.Number == 51110)
        {
            throw new EnrolmentException(EnrolmentFailureReason.LinkInvalid);
        }
        catch (SqlException ex) when (ex.Number == 51111)
        {
            throw new EnrolmentException(EnrolmentFailureReason.MemberNotFound);
        }
    }
}
