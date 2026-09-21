using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum CouncilSeatingErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when any usp_Council_* seating/registry procedure rejects a call. Every
/// message was written in the procedure for a council officer reading the screen;
/// surfaced plainly, same convention as every other feature exception in this codebase.
/// </summary>
public sealed class CouncilSeatingException : Exception
{
    public CouncilSeatingErrorCategory Category { get; }

    public CouncilSeatingException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            51670 or 51672 or 51681 => CouncilSeatingErrorCategory.NotFound,
            51674 => CouncilSeatingErrorCategory.Conflict,
            51650 or 51651 or 51662 or 51671 or 51682 or 51690 or 51691 or 51692
                => CouncilSeatingErrorCategory.Forbidden,
            _ => CouncilSeatingErrorCategory.BadRequest
        };
    }
}

internal static class CouncilSeatingErrors
{
    private static readonly HashSet<int> Known =
    [
        51650, 51651, 51660, 51661, 51662, 51663, 51664,
        51670, 51671, 51672, 51673, 51674, 51675, 51676,
        51680, 51681, 51682, 51690, 51691, 51692
    ];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>One row of usp_Council_EligibleOfficers — an in-jurisdiction candidate for a
/// council seat. Never contact details, blood type or any field outside invariant #7's
/// cross-chapter shape.</summary>
public sealed record CouncilOfficerCandidateRow(
    int MemberId, string GiftName, string MemberNumber, string FullName,
    int ChapterId, string ChapterName, DateTime? RenewedThrough,
    bool IsCurrent, bool IsLapsed, bool NoMobileNumber);

/// <summary>One row of usp_Council_MemberLookup — a DIFFERENT shape from
/// <see cref="CouncilOfficerCandidateRow"/> (no FullName/ChapterId, adds StatusName) —
/// kept as its own record rather than sharing one, so Dapper's constructor-based record
/// mapping never has to guess at a column neither procedure actually returns (the same
/// class of silent-500 risk CLAUDE.md §8.7 documents for BIT columns).</summary>
public sealed record CouncilMemberLookupRow(
    int MemberId, string GiftName, string MemberNumber, string? ChapterName, string StatusName,
    DateTime? RenewedThrough, bool IsCurrent, bool IsLapsed, bool NoMobileNumber);

public sealed record CouncilCreatedRow(int CouncilId, bool WasCreated);

public sealed record CouncilSeatResultRow(int MemberRoleId, bool WasInJurisdiction, int? LinkId, DateTime? ExpiresOn);

/// <summary>One row of usp_Council_GetRegistry — a council in the subtree, with enough
/// to distinguish "never constituted" from "dormant" from "seated" from "dissolved" in
/// plain language rather than a bare officer count.</summary>
public sealed record CouncilRegistryRow(
    int CouncilId, string CouncilName, string LevelName, int? ParentCouncilId, int Depth,
    bool IsActive, bool IsDissolved, bool HasSeatedOfficers, bool NeverConstituted, bool IsDormant,
    int SeatedOfficerCount, int DirectChildCouncilCount, int DirectChapterCount, int DirectMemberCount);

/// <summary>One row of usp_Council_GetRoster's Set 1 — a seat, current or ended.</summary>
public sealed record CouncilRosterSeatRow(
    int MemberRoleId, int? CouncilOfficeId, string? OfficeName, string RoleName,
    int MemberId, string GiftName, string MemberNumber, string FullName, string? HomeChapterName,
    DateTime TermStart, DateTime? TermEnd, bool IsCurrent, DateTime? RenewedThrough, bool HasAccount);

/// <summary>One row of usp_Council_GetRoster's Set 2 — a permanent SeatOverride record.</summary>
public sealed record CouncilSeatOverrideRow(
    int SeatOverrideId, int MemberRoleId, string GiftName, string MemberNumber,
    string? HomeChapterName, string Reason, DateTime SeatedOn, string SeatedByGiftName);

public sealed record CouncilRosterResult(
    IReadOnlyList<CouncilRosterSeatRow> Seats, IReadOnlyList<CouncilSeatOverrideRow> Overrides);

public interface ICouncilSeatingRepository
{
    /// <summary>CouncilAdmin at the resolved seating authority only. Throws
    /// <see cref="CouncilSeatingException"/> (Forbidden).</summary>
    Task<IReadOnlyList<CouncilOfficerCandidateRow>> EligibleOfficersAsync(
        int requestingMemberId, int councilId, string? search, CancellationToken ct);

    /// <summary>CouncilAdmin at the resolved seating authority only. Throws
    /// <see cref="CouncilSeatingException"/> (Forbidden). Returns null if no match.</summary>
    Task<CouncilMemberLookupRow?> MemberLookupAsync(
        int requestingMemberId, int councilId, string memberNumber, CancellationToken ct);

    /// <summary>Throws <see cref="CouncilSeatingException"/> (Forbidden / BadRequest).</summary>
    Task<CouncilCreatedRow> CreateAsync(
        int requestingMemberId, int parentCouncilId, string councilName,
        int? regionId, int? provinceId, int? municipalityId, CancellationToken ct);

    /// <summary>Throws <see cref="CouncilSeatingException"/> (NotFound / Forbidden / Conflict / BadRequest).</summary>
    Task<CouncilSeatResultRow> SeatOfficerAsync(
        int requestingMemberId, int councilId, int memberId, int councilOfficeId,
        DateOnly termStart, DateOnly? termEnd, string? outsideJurisdictionReason,
        byte[]? tokenHash, CancellationToken ct);

    /// <summary>Throws <see cref="CouncilSeatingException"/> (NotFound / Forbidden / BadRequest).</summary>
    Task UnseatOfficerAsync(int requestingMemberId, int memberRoleId, string reason, CancellationToken ct);

    /// <summary>Throws <see cref="CouncilSeatingException"/> (Forbidden).</summary>
    Task<IReadOnlyList<CouncilRegistryRow>> GetRegistryAsync(int requestingMemberId, int? councilId, CancellationToken ct);

    /// <summary>Throws <see cref="CouncilSeatingException"/> (Forbidden).</summary>
    Task<CouncilRosterResult> GetRosterAsync(int requestingMemberId, int councilId, CancellationToken ct);
}

public sealed class CouncilSeatingRepository(ISqlConnectionFactory factory) : ICouncilSeatingRepository
{
    public async Task<IReadOnlyList<CouncilOfficerCandidateRow>> EligibleOfficersAsync(
        int requestingMemberId, int councilId, string? search, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<CouncilOfficerCandidateRow>(new CommandDefinition(
                "dbo.usp_Council_EligibleOfficers",
                new { RequestingMemberId = requestingMemberId, CouncilId = councilId, Search = search },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.AsList();
        }
        catch (SqlException ex) when (CouncilSeatingErrors.IsKnown(ex.Number))
        {
            throw new CouncilSeatingException(ex.Number, ex.Message);
        }
    }

    public async Task<CouncilMemberLookupRow?> MemberLookupAsync(
        int requestingMemberId, int councilId, string memberNumber, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleOrDefaultAsync<CouncilMemberLookupRow?>(new CommandDefinition(
                "dbo.usp_Council_MemberLookup",
                new { RequestingMemberId = requestingMemberId, CouncilId = councilId, MemberNumber = memberNumber },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CouncilSeatingErrors.IsKnown(ex.Number))
        {
            throw new CouncilSeatingException(ex.Number, ex.Message);
        }
    }

    public async Task<CouncilCreatedRow> CreateAsync(
        int requestingMemberId, int parentCouncilId, string councilName,
        int? regionId, int? provinceId, int? municipalityId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<CouncilCreatedRow>(new CommandDefinition(
                "dbo.usp_Council_Create",
                new
                {
                    RequestingMemberId = requestingMemberId, ParentCouncilId = parentCouncilId, CouncilName = councilName,
                    RegionId = regionId, ProvinceId = provinceId, MunicipalityId = municipalityId,
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CouncilSeatingErrors.IsKnown(ex.Number))
        {
            throw new CouncilSeatingException(ex.Number, ex.Message);
        }
    }

    public async Task<CouncilSeatResultRow> SeatOfficerAsync(
        int requestingMemberId, int councilId, int memberId, int councilOfficeId,
        DateOnly termStart, DateOnly? termEnd, string? outsideJurisdictionReason,
        byte[]? tokenHash, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<CouncilSeatResultRow>(new CommandDefinition(
                "dbo.usp_Council_SeatOfficer",
                new
                {
                    RequestingMemberId = requestingMemberId, CouncilId = councilId, MemberId = memberId,
                    CouncilOfficeId = councilOfficeId, TermStart = termStart.ToDateTime(TimeOnly.MinValue),
                    TermEnd = termEnd?.ToDateTime(TimeOnly.MinValue),
                    OutsideJurisdictionReason = outsideJurisdictionReason, TokenHash = tokenHash,
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CouncilSeatingErrors.IsKnown(ex.Number))
        {
            throw new CouncilSeatingException(ex.Number, ex.Message);
        }
    }

    public async Task UnseatOfficerAsync(int requestingMemberId, int memberRoleId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Council_UnseatOfficer",
                new { RequestingMemberId = requestingMemberId, MemberRoleId = memberRoleId, Reason = reason },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CouncilSeatingErrors.IsKnown(ex.Number))
        {
            throw new CouncilSeatingException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<CouncilRegistryRow>> GetRegistryAsync(int requestingMemberId, int? councilId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<CouncilRegistryRow>(new CommandDefinition(
                "dbo.usp_Council_GetRegistry",
                new { RequestingMemberId = requestingMemberId, CouncilId = councilId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.AsList();
        }
        catch (SqlException ex) when (CouncilSeatingErrors.IsKnown(ex.Number))
        {
            throw new CouncilSeatingException(ex.Number, ex.Message);
        }
    }

    public async Task<CouncilRosterResult> GetRosterAsync(int requestingMemberId, int councilId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_Council_GetRoster",
                new { RequestingMemberId = requestingMemberId, CouncilId = councilId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var seats = (await multi.ReadAsync<CouncilRosterSeatRow>()).AsList();
            var overrides = (await multi.ReadAsync<CouncilSeatOverrideRow>()).AsList();
            return new CouncilRosterResult(seats, overrides);
        }
        catch (SqlException ex) when (CouncilSeatingErrors.IsKnown(ex.Number))
        {
            throw new CouncilSeatingException(ex.Number, ex.Message);
        }
    }
}
