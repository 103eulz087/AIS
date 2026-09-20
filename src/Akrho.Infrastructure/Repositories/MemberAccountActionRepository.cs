using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum MemberAccountActionErrorCategory { NotFound, Forbidden, BadRequest }

/// <summary>
/// Thrown when usp_Member_Block/_Unblock/_ResetPassword/_ListBlocked rejects a call.
/// Every message was written in the procedure for a National Council officer reading
/// the screen; surfaced plainly, same convention as every other feature exception in
/// this codebase.
/// </summary>
public sealed class MemberAccountActionException : Exception
{
    public MemberAccountActionErrorCategory Category { get; }

    public MemberAccountActionException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // Member not found (Block), or member not found / no mobile on file (ResetPassword).
            51632 or 51638 => MemberAccountActionErrorCategory.NotFound,

            // Not seated CouncilAdmin at National Council — the one authorization these four
            // procedures share (client decision 2026-09-21: National only, never any council
            // within its own subtree).
            51631 or 51634 or 51637 or 51640 => MemberAccountActionErrorCategory.Forbidden,

            // A blank/missing reason, no account to unblock, or no active role to reset.
            _ => MemberAccountActionErrorCategory.BadRequest
        };
    }
}

internal static class MemberAccountActionErrors
{
    private static readonly HashSet<int> Known =
        [51630, 51631, 51632, 51633, 51634, 51635, 51636, 51637, 51638, 51639, 51640];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>One row of usp_Member_ListBlocked — a member currently blocked, with the most
/// recent Block action's own reason, who performed it, and when.</summary>
public sealed record BlockedMemberRow(
    int MemberId, string GiftName, string MemberNumber, string? ChapterName,
    string Reason, DateTime PerformedDate, string? BlockedByGiftName);

public interface IMemberAccountActionRepository
{
    /// <summary>National Council only. Throws <see cref="MemberAccountActionException"/>
    /// (Forbidden / BadRequest / NotFound).</summary>
    Task BlockAsync(int requestingMemberId, int memberId, string reason, CancellationToken ct);

    /// <summary>National Council only. Throws <see cref="MemberAccountActionException"/>
    /// (Forbidden / BadRequest).</summary>
    Task UnblockAsync(int requestingMemberId, int memberId, string reason, CancellationToken ct);

    /// <summary>National Council only. Never returns a password — only a fresh one-time
    /// enrolment link (CLAUDE.md invariant #16). Throws <see cref="MemberAccountActionException"/>
    /// (Forbidden / BadRequest / NotFound).</summary>
    Task<(int LinkId, DateTime ExpiresOn)> ResetPasswordAsync(
        int requestingMemberId, int memberId, string reason, byte[] tokenHash, CancellationToken ct);

    /// <summary>National Council only. Throws <see cref="MemberAccountActionException"/> (Forbidden).</summary>
    Task<IReadOnlyList<BlockedMemberRow>> ListBlockedAsync(int requestingMemberId, CancellationToken ct);
}

public sealed class MemberAccountActionRepository(ISqlConnectionFactory factory) : IMemberAccountActionRepository
{
    public async Task BlockAsync(int requestingMemberId, int memberId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Member_Block",
                new { RequestingMemberId = requestingMemberId, MemberId = memberId, Reason = reason },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MemberAccountActionErrors.IsKnown(ex.Number))
        {
            throw new MemberAccountActionException(ex.Number, ex.Message);
        }
    }

    public async Task UnblockAsync(int requestingMemberId, int memberId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Member_Unblock",
                new { RequestingMemberId = requestingMemberId, MemberId = memberId, Reason = reason },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MemberAccountActionErrors.IsKnown(ex.Number))
        {
            throw new MemberAccountActionException(ex.Number, ex.Message);
        }
    }

    public async Task<(int LinkId, DateTime ExpiresOn)> ResetPasswordAsync(
        int requestingMemberId, int memberId, string reason, byte[] tokenHash, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        var p = new DynamicParameters();
        p.Add("RequestingMemberId", requestingMemberId);
        p.Add("MemberId", memberId);
        p.Add("Reason", reason);
        p.Add("TokenHash", tokenHash);
        p.Add("LinkId", dbType: DbType.Int32, direction: ParameterDirection.Output);
        p.Add("ExpiresOnOut", dbType: DbType.DateTime2, direction: ParameterDirection.Output);

        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Member_ResetPassword", p,
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MemberAccountActionErrors.IsKnown(ex.Number))
        {
            throw new MemberAccountActionException(ex.Number, ex.Message);
        }

        return (p.Get<int>("LinkId"), p.Get<DateTime>("ExpiresOnOut"));
    }

    public async Task<IReadOnlyList<BlockedMemberRow>> ListBlockedAsync(int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<BlockedMemberRow>(new CommandDefinition(
                "dbo.usp_Member_ListBlocked",
                new { RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.AsList();
        }
        catch (SqlException ex) when (MemberAccountActionErrors.IsKnown(ex.Number))
        {
            throw new MemberAccountActionException(ex.Number, ex.Message);
        }
    }
}
