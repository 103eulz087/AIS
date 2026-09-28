using System.Data;
using Akrho.Infrastructure.Security;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

public sealed record MemberListRow(
    int MemberId, string GiftName, string MemberNumber, int ChapterId, string ChapterName,
    string StatusName, DateTime? RenewedThrough,
    string? FirstName, string? MiddleName, string? LastName,
    string? MobileNo, string? Profession, string? BloodType, string? PhotoPath,
    string? OfficeName, bool? IsBlocked, byte[]? RowVersion,
    bool IsSameChapter, int TotalCount);

/// <summary>usp_Member_UpdateByOfficer's own result — the new RowVersion only.</summary>
public sealed record MemberIdentityUpdateResultRow(byte[] RowVersion);

/// <summary>usp_Member_SearchByJurisdiction's own row shape — full contact detail for
/// every result, by design (see that procedure's own header comment on why this is a
/// different visibility rule from MemberListRow's cross-chapter restriction).</summary>
public sealed record MemberJurisdictionSearchRow(
    int MemberId, string GiftName, string MemberNumber,
    string FirstName, string? MiddleName, string LastName,
    string? MobileNo, string? Email,
    int? ChapterId, string? ChapterName,
    int? HomeCouncilId, string? HomeCouncilName,
    string StatusName, DateTime? RenewedThrough, bool IsBlocked,
    string? RegionName, string? ProvinceName, string? CityName,
    int TotalCount);

public interface IMemberRepository
{
    /// <summary>
    /// <paramref name="statusId"/> is optional — NULL/omitted leaves behavior for every
    /// existing caller unchanged (a purely additive filter to one exact MemberStatus, added
    /// so a dashboard tile can drill into a filtered list; see usp_Member_Search.sql).
    /// </summary>
    Task<IReadOnlyList<MemberListRow>> SearchAsync(
        int requestingMemberId, int? chapterId, string? search, int? bloodTypeId,
        int? skillId, bool includeInactive, int? statusId, int skip, int take, CancellationToken ct);

    /// <summary>Throws <see cref="MemberIdentityException"/> (NotFound / Forbidden / Conflict / BadRequest).</summary>
    Task<MemberIdentityUpdateResultRow> UpdateIdentityByOfficerAsync(
        int requestingMemberId, int memberId, string firstName, string? middleName, string lastName,
        string mobileNo, byte[] rowVersion, CancellationToken ct);

    /// <summary>Council Portal's own global member search, scoped to the requesting
    /// officer's dbo.fn_MemberCouncilScope. Throws <see cref="MemberJurisdictionSearchException"/>
    /// (Forbidden: no seated council office / BadRequest: search text under 2 characters).</summary>
    Task<IReadOnlyList<MemberJurisdictionSearchRow>> SearchByJurisdictionAsync(
        int requestingMemberId, string search, int skip, int take, CancellationToken ct);
}

/// <summary>How the endpoint layer decides which HTTP status a rejected
/// usp_Member_UpdateByOfficer call becomes.</summary>
public enum MemberIdentityErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>Thrown when usp_Member_UpdateByOfficer rejects a call. Every message was
/// written in the procedure for the Chapter Admin reading the screen; surfaced
/// plainly, same convention as every other feature exception in this codebase.</summary>
public sealed class MemberIdentityException : Exception
{
    public MemberIdentityErrorCategory Category { get; }

    public MemberIdentityException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            51264 => MemberIdentityErrorCategory.NotFound,
            51267 => MemberIdentityErrorCategory.Conflict,
            51263 or 51265 => MemberIdentityErrorCategory.Forbidden,
            _ => MemberIdentityErrorCategory.BadRequest
        };
    }
}

internal static class MemberIdentityErrors
{
    private static readonly HashSet<int> Known = [51260, 51261, 51262, 51263, 51264, 51265, 51266, 51267];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>How the endpoint layer decides which HTTP status a rejected
/// usp_Member_SearchByJurisdiction call becomes.</summary>
public enum MemberJurisdictionSearchErrorCategory { Forbidden, BadRequest }

public sealed class MemberJurisdictionSearchException : Exception
{
    public MemberJurisdictionSearchErrorCategory Category { get; }

    public MemberJurisdictionSearchException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            51830 => MemberJurisdictionSearchErrorCategory.Forbidden,
            _ => MemberJurisdictionSearchErrorCategory.BadRequest   // 51831
        };
    }
}

internal static class MemberJurisdictionSearchErrors
{
    private static readonly HashSet<int> Known = [51830, 51831];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

public sealed class MemberRepository(ISqlConnectionFactory factory) : IMemberRepository
{
    public async Task<IReadOnlyList<MemberListRow>> SearchAsync(
        int requestingMemberId, int? chapterId, string? search, int? bloodTypeId,
        int? skillId, bool includeInactive, int? statusId, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);

        // All data access goes through a stored procedure. No inline SQL, ever.
        var rows = await conn.QueryAsync<MemberListRow>(
            new CommandDefinition(
                "dbo.usp_Member_Search",
                new
                {
                    RequestingMemberId = requestingMemberId,   // from the token, never the body
                    ChapterId = chapterId,
                    Search = search,
                    BloodTypeId = bloodTypeId,
                    SkillId = skillId,
                    IncludeInactive = includeInactive,
                    StatusId = statusId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 200)
                },
                commandType: CommandType.StoredProcedure,
                cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<MemberIdentityUpdateResultRow> UpdateIdentityByOfficerAsync(
        int requestingMemberId, int memberId, string firstName, string? middleName, string lastName,
        string mobileNo, byte[] rowVersion, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<MemberIdentityUpdateResultRow>(new CommandDefinition(
                "dbo.usp_Member_UpdateByOfficer",
                new
                {
                    RequestingMemberId = requestingMemberId, MemberId = memberId,
                    FirstName = firstName, MiddleName = middleName, LastName = lastName,
                    MobileNo = mobileNo, RowVersion = rowVersion,
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MemberIdentityErrors.IsKnown(ex.Number))
        {
            throw new MemberIdentityException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<MemberJurisdictionSearchRow>> SearchByJurisdictionAsync(
        int requestingMemberId, string search, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<MemberJurisdictionSearchRow>(new CommandDefinition(
                "dbo.usp_Member_SearchByJurisdiction",
                new
                {
                    RequestingMemberId = requestingMemberId,   // from the token, never the body
                    Search = search,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 200)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            return rows.ToList();
        }
        catch (SqlException ex) when (MemberJurisdictionSearchErrors.IsKnown(ex.Number))
        {
            throw new MemberJurisdictionSearchException(ex.Number, ex.Message);
        }
    }
}
