using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum MemberProfileErrorCategory { NotFound, Conflict, BadRequest }

/// <summary>
/// Thrown when a Member self-profile stored procedure rejects a call. Same pattern as
/// <see cref="MeetingException"/>/<see cref="ExpenseException"/> — every message was written
/// in the procedure to reach the member reading the screen; surface it plainly.
/// </summary>
public sealed class MemberProfileException : Exception
{
    public MemberProfileErrorCategory Category { get; }

    public MemberProfileException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Member not found" (usp_Member_GetOwnProfile / usp_Member_UpdateOwnProfile) and
            // "Photo not found" (usp_Member_GetPhoto) — the latter covers a nonexistent member
            // id, a wrong-chapter caller, AND a member with no photo set, all identically.
            51240 or 51242 or 51247 => MemberProfileErrorCategory.NotFound,

            // The row moved since the client loaded it (usp_Member_UpdateOwnProfile's
            // RowVersion match) — the resource's own state changed, nothing about the
            // request itself was invalid. 409, not 400.
            51245 => MemberProfileErrorCategory.Conflict,

            // A blank mobile number, an unrecognised blood type, an inactive/unknown skill
            // id, a staged photo that is missing/not-owned/already-consumed, a blank gift
            // name, or a mobile number already registered to another member.
            51241 or 51243 or 51244 or 51246 or 51248 or 51259 => MemberProfileErrorCategory.BadRequest,

            _ => MemberProfileErrorCategory.BadRequest
        };
    }
}

internal static class MemberProfileErrors
{
    private static readonly HashSet<int> Known = [51240, 51241, 51242, 51243, 51244, 51245, 51246, 51247, 51248, 51259];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// Result set 1 of usp_Member_GetOwnProfile — the THIRD read shape (see the header comment on
/// the procedure itself and the note in MemberDtos.cs next to MemberDto/MemberCrossChapterDto):
/// a member reading his OWN record sees fields neither of the other two shapes ever return to
/// anyone else. FilePath-style columns (PhotoPath) stay in this layer only for as long as it
/// takes the endpoint to build a URL from them — never handed back raw past MemberProfileDto.
/// </summary>
public sealed record MemberOwnProfileRow(
    int MemberId, string MemberNumber,
    string FirstName, string? MiddleName, string LastName, string GiftName,
    DateTime? Birthdate,
    DateTime? DateSurvive, string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    int? ChapterId, string? ChapterName,
    int? HomeCouncilId, string? CouncilName,
    string? ChapterOfRecord,
    int StatusId, string StatusName,
    DateTime? RenewedThrough,
    int? SeconderMemberId, int? ApprovedBy, DateTime? ApprovedDate,
    string? Address,
    int? BloodTypeId, string? BloodTypeName, DateTime? BloodTypeConfirmedDate,
    string? Profession,
    string? PhotoPath, string? PhotoContentType,
    string? MobileNo, string? Email,
    byte[] RowVersion);

public sealed record MemberOwnProfileResult(MemberOwnProfileRow Profile, IReadOnlyList<int> SkillIds);

/// <summary>Dapper's return shape for the single RowVersion column usp_Member_UpdateOwnProfile hands back.</summary>
public sealed record MemberProfileRowVersionRow(byte[] RowVersion);

/// <summary>
/// The photo path/content-type pair, however either usp_Member_SetPhoto or usp_Member_GetPhoto
/// happened to name its two output columns — normalised to one shape here so the endpoint layer
/// never needs to know the two procs spell "content type" differently.
/// </summary>
public sealed record MemberPhotoRow(string PhotoPath, string? ContentType);

/// <summary>Dapper's return shape for usp_Member_SetPhoto's own column names — "PhotoContentType",
/// not "ContentType" like usp_Member_GetPhoto. Mapped into <see cref="MemberPhotoRow"/> by hand
/// in <see cref="MemberProfileRepository.SetPhotoAsync"/>, never merged into one ambiguous shape.</summary>
public sealed record MemberPhotoSetRow(string PhotoPath, string? PhotoContentType);

public interface IMemberProfileRepository
{
    /// <summary>Throws <see cref="MemberProfileException"/> (NotFound) — unreachable in the
    /// normal case (the caller IS the row), defence in depth only.</summary>
    Task<MemberOwnProfileResult> GetOwnProfileAsync(int requestingMemberId, CancellationToken ct);

    /// <summary>Throws <see cref="MemberProfileException"/> (NotFound / Conflict / BadRequest).
    /// Returns the new RowVersion so the caller can keep editing without a refetch.</summary>
    Task<byte[]> UpdateOwnProfileAsync(
        int requestingMemberId, string giftName, DateOnly? birthDate, DateOnly? dateSurvive,
        string? presidentDuringSurvive, string? masterInitiatorDuringSurvive,
        string mobileNo, string? email, string? address,
        int? bloodTypeId, bool bloodTypeConfirmed, string? profession,
        IReadOnlyList<int> skillIds, byte[] rowVersion, CancellationToken ct);

    /// <summary>Throws <see cref="MemberProfileException"/> (BadRequest) — a staged upload
    /// that is missing, not owned by this member, or already consumed. Same generic message
    /// for all three, on purpose (usp_Member_SetPhoto's own header comment).</summary>
    Task<MemberPhotoRow> SetPhotoAsync(int requestingMemberId, int attachmentStagingId, CancellationToken ct);

    /// <summary>Throws <see cref="MemberProfileException"/> (NotFound) — a nonexistent member,
    /// a wrong-chapter caller, and a member with no photo all collapse to the same message.</summary>
    Task<MemberPhotoRow> GetPhotoAsync(int memberId, int requestingMemberId, CancellationToken ct);
}

public sealed class MemberProfileRepository(ISqlConnectionFactory factory) : IMemberProfileRepository
{
    public async Task<MemberOwnProfileResult> GetOwnProfileAsync(int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_Member_GetOwnProfile",
                new { RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var profile = await multi.ReadSingleAsync<MemberOwnProfileRow>();
            var skillIds = (await multi.ReadAsync<int>()).ToList();

            return new MemberOwnProfileResult(profile, skillIds);
        }
        catch (SqlException ex) when (MemberProfileErrors.IsKnown(ex.Number))
        {
            throw new MemberProfileException(ex.Number, ex.Message);
        }
    }

    public async Task<byte[]> UpdateOwnProfileAsync(
        int requestingMemberId, string giftName, DateOnly? birthDate, DateOnly? dateSurvive,
        string? presidentDuringSurvive, string? masterInitiatorDuringSurvive,
        string mobileNo, string? email, string? address,
        int? bloodTypeId, bool bloodTypeConfirmed, string? profession,
        IReadOnlyList<int> skillIds, byte[] rowVersion, CancellationToken ct)
    {
        var table = new DataTable();
        table.Columns.Add("Value", typeof(int));
        foreach (var id in skillIds) table.Rows.Add(id);

        using var conn = await factory.OpenAsync(ct);
        try
        {
            var result = await conn.QuerySingleAsync<MemberProfileRowVersionRow>(new CommandDefinition(
                "dbo.usp_Member_UpdateOwnProfile",
                new
                {
                    RequestingMemberId = requestingMemberId,
                    GiftName = giftName,
                    BirthDate = birthDate?.ToDateTime(TimeOnly.MinValue),
                    DateSurvive = dateSurvive?.ToDateTime(TimeOnly.MinValue),
                    PresidentDuringSurvive = presidentDuringSurvive,
                    MasterInitiatorDuringSurvive = masterInitiatorDuringSurvive,
                    MobileNo = mobileNo,
                    Email = email,
                    Address = address,
                    BloodTypeId = bloodTypeId,
                    BloodTypeConfirmed = bloodTypeConfirmed,
                    Profession = profession,
                    SkillIds = table.AsTableValuedParameter("dbo.IntList"),
                    RowVersion = rowVersion
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            return result.RowVersion;
        }
        catch (SqlException ex) when (MemberProfileErrors.IsKnown(ex.Number))
        {
            throw new MemberProfileException(ex.Number, ex.Message);
        }
    }

    public async Task<MemberPhotoRow> SetPhotoAsync(int requestingMemberId, int attachmentStagingId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            // usp_Member_SetPhoto's own columns are PhotoPath / PhotoContentType — read into
            // MemberPhotoSetRow, then mapped by hand into the normalised MemberPhotoRow
            // shape GetPhotoAsync below uses, rather than relying on Dapper to match
            // "ContentType" against "PhotoContentType" (it will not).
            var row = await conn.QuerySingleAsync<MemberPhotoSetRow>(new CommandDefinition(
                "dbo.usp_Member_SetPhoto",
                new { RequestingMemberId = requestingMemberId, AttachmentStagingId = attachmentStagingId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            return new MemberPhotoRow(row.PhotoPath, row.PhotoContentType);
        }
        catch (SqlException ex) when (MemberProfileErrors.IsKnown(ex.Number))
        {
            throw new MemberProfileException(ex.Number, ex.Message);
        }
    }

    public async Task<MemberPhotoRow> GetPhotoAsync(int memberId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<MemberPhotoRow>(new CommandDefinition(
                "dbo.usp_Member_GetPhoto",
                new { MemberId = memberId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MemberProfileErrors.IsKnown(ex.Number))
        {
            throw new MemberProfileException(ex.Number, ex.Message);
        }
    }
}
