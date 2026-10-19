using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum MemberPaymentTagErrorCategory { NotFound, Forbidden, BadRequest }

/// <summary>
/// Thrown when usp_MemberPaymentTag_Set/_ListMembers/_GetStats rejects a call. Every
/// message was written in the procedure for a National Council officer reading the
/// screen, surfaced plainly — same convention as <c>MemberAccountActionException</c>.
/// </summary>
public sealed class MemberPaymentTagException : Exception
{
    public MemberPaymentTagErrorCategory Category { get; }

    public MemberPaymentTagException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // Member not found (Set), or chapter not found (ListMembers/GetStats).
            51912 or 51913 => MemberPaymentTagErrorCategory.NotFound,

            // National Council not configured, or caller is not a seated National CouncilAdmin
            // — the one authorization all three procedures share (client decision 2026-09-29:
            // National only, same posture as MemberAccountActionException's own).
            51910 or 51911 => MemberPaymentTagErrorCategory.Forbidden,

            // Neither chapter nor search given (51914), a bad Status/StatusFilter value
            // (51915), or a search under 2 characters (51916).
            _ => MemberPaymentTagErrorCategory.BadRequest
        };
    }
}

internal static class MemberPaymentTagErrors
{
    private static readonly HashSet<int> Known = [51910, 51911, 51912, 51913, 51914, 51915, 51916];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>One row of usp_MemberPaymentTag_ListMembers — a member (either from one
/// chapter, or a direct national search hit) with his current tri-state payment status.
/// ChapterName rides along even in chapter mode (not just national-search mode) so the
/// API layer never needs a second lookup either way.</summary>
public sealed record MemberPaymentTagRow(
    int MemberId, string MemberNumber, string GiftName,
    string? FirstName, string? MiddleName, string? LastName, string? MobileNo,
    int ChapterId, string ChapterName,
    string StatusName, string PaymentStatus, DateTime? TaggedDate, string? TaggedByGiftName,
    int MembershipYear, int TotalCount);

/// <summary>One row of usp_MemberPaymentTag_GetStats — one chapter's member counts by
/// payment status, for the Paid/Unpaid/Free report.</summary>
/// <summary>One row of usp_MemberPaymentTag_GetReport — a chapter, where it is, and its
/// members counted by payment-tag status. Column order matches the procedure exactly.</summary>
public sealed record MemberPaymentTagStatsRow(
    int ChapterId, string ChapterName, string? RegionName, string? ProvinceName, string? CityName,
    int TotalMembers, int PaidCount, int FreeCount, int UnpaidCount, int MembershipYear);

/// <summary>One row of usp_MemberPaymentTag_ListForReport — a member behind a Payment report
/// number. TaggedDate is when he was marked Paid or Free (null when Unpaid). Column order
/// matches the procedure exactly.</summary>
public sealed record MemberPaymentReportMemberRow(
    int MemberId, string MemberNumber, string GiftName, string FullName,
    int ChapterId, string ChapterName, string? RegionName, string? ProvinceName, string? CityName,
    string PaymentStatus, DateTime? TaggedDate, string? TaggedByGiftName,
    int MembershipYear, int TotalCount);

public interface IMemberPaymentTagRepository
{
    /// <summary>The members behind a Payment report number (usp_MemberPaymentTag_ListForReport).
    /// Needs "View payment tags" on a National seat; throws <see cref="MemberPaymentTagException"/>.</summary>
    Task<IReadOnlyList<MemberPaymentReportMemberRow>> ListForReportAsync(
        int requestingMemberId, int? membershipYear, string? chapterIds, string? statusFilter,
        string? search, int skip, int take, CancellationToken ct);

    /// <summary>National Council only. Either <paramref name="chapterId"/> (that
    /// chapter's full roster) or <paramref name="search"/> (a direct, national-wide
    /// member search by gift name/legal name/member number) must be given — both may be
    /// combined. <paramref name="statusFilter"/> and the status this module manages
    /// throughout are plain strings ("Paid"/"Unpaid"/"Free") rather than a C# enum — this
    /// codebase's own convention for every similar status value (StatusName,
    /// RegistrationType, etc.); the stored procedure is the single source of validation
    /// truth (THROW 51915 for anything else), not a client-side enum. Throws
    /// <see cref="MemberPaymentTagException"/> (Forbidden / NotFound / BadRequest).</summary>
    Task<IReadOnlyList<MemberPaymentTagRow>> ListMembersAsync(
        int requestingMemberId, int? chapterId, string? search, string? statusFilter,
        int? membershipYear, int skip, int take, CancellationToken ct);

    /// <summary>National Council only. <paramref name="status"/> is "Paid", "Unpaid", or
    /// "Free" — validated by the procedure itself (THROW 51915), not here. Silent no-op
    /// if the member is already in the requested status. Throws
    /// <see cref="MemberPaymentTagException"/> (Forbidden / NotFound).</summary>
    Task SetAsync(
        int requestingMemberId, int memberId, string status, int? membershipYear, CancellationToken ct);

    /// <summary>National Council only. <paramref name="chapterId"/> narrows to one
    /// chapter; omitted, every chapter nationally (one row each). Throws
    /// <see cref="MemberPaymentTagException"/> (Forbidden / NotFound).</summary>
    Task<IReadOnlyList<MemberPaymentTagStatsRow>> GetStatsAsync(
        int requestingMemberId, int? membershipYear, CancellationToken ct);
}

public sealed class MemberPaymentTagRepository(ISqlConnectionFactory factory) : IMemberPaymentTagRepository
{
    public async Task<IReadOnlyList<MemberPaymentTagRow>> ListMembersAsync(
        int requestingMemberId, int? chapterId, string? search, string? statusFilter,
        int? membershipYear, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<MemberPaymentTagRow>(new CommandDefinition(
                "dbo.usp_MemberPaymentTag_ListMembers",
                new
                {
                    RequestingMemberId = requestingMemberId, ChapterId = chapterId, Search = search,
                    StatusFilter = statusFilter, MembershipYear = membershipYear,
                    Skip = skip, Take = take,
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.AsList();
        }
        catch (SqlException ex) when (MemberPaymentTagErrors.IsKnown(ex.Number))
        {
            throw new MemberPaymentTagException(ex.Number, ex.Message);
        }
    }

    public async Task SetAsync(
        int requestingMemberId, int memberId, string status, int? membershipYear, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_MemberPaymentTag_Set",
                new
                {
                    RequestingMemberId = requestingMemberId, MemberId = memberId,
                    Status = status, MembershipYear = membershipYear
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MemberPaymentTagErrors.IsKnown(ex.Number))
        {
            throw new MemberPaymentTagException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<MemberPaymentTagStatsRow>> GetStatsAsync(
        int requestingMemberId, int? membershipYear, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            // usp_MemberPaymentTag_GetReport (2026-10-19): adds place names and checks the
            // separate "View payment report" grid key. GetStats stays only for the older build.
            var rows = await conn.QueryAsync<MemberPaymentTagStatsRow>(new CommandDefinition(
                "dbo.usp_MemberPaymentTag_GetReport",
                new { RequestingMemberId = requestingMemberId, MembershipYear = membershipYear },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.AsList();
        }
        catch (SqlException ex) when (MemberPaymentTagErrors.IsKnown(ex.Number))
        {
            throw new MemberPaymentTagException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<MemberPaymentReportMemberRow>> ListForReportAsync(
        int requestingMemberId, int? membershipYear, string? chapterIds, string? statusFilter,
        string? search, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<MemberPaymentReportMemberRow>(new CommandDefinition(
                "dbo.usp_MemberPaymentTag_ListForReport",
                new
                {
                    RequestingMemberId = requestingMemberId, MembershipYear = membershipYear,
                    ChapterIds = chapterIds, StatusFilter = statusFilter, Search = search,
                    Skip = skip, Take = take
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.AsList();
        }
        catch (SqlException ex) when (MemberPaymentTagErrors.IsKnown(ex.Number))
        {
            throw new MemberPaymentTagException(ex.Number, ex.Message);
        }
    }
}
