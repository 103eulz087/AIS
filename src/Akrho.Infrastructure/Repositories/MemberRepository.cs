using System.Data;
using Akrho.Infrastructure.Security;
using Dapper;

namespace Akrho.Infrastructure.Repositories;

public sealed record MemberListRow(
    int MemberId, string GiftName, string MemberNumber, int ChapterId, string ChapterName,
    string StatusName, DateTime? RenewedThrough,
    string? FirstName, string? MiddleName, string? LastName,
    string? MobileNo, string? Profession, string? BloodType, string? PhotoPath,
    bool IsSameChapter, int TotalCount);

public interface IMemberRepository
{
    Task<IReadOnlyList<MemberListRow>> SearchAsync(
        int requestingMemberId, int? chapterId, string? search, int? bloodTypeId,
        int? skillId, bool includeInactive, int skip, int take, CancellationToken ct);
}

public sealed class MemberRepository(ISqlConnectionFactory factory) : IMemberRepository
{
    public async Task<IReadOnlyList<MemberListRow>> SearchAsync(
        int requestingMemberId, int? chapterId, string? search, int? bloodTypeId,
        int? skillId, bool includeInactive, int skip, int take, CancellationToken ct)
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
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 200)
                },
                commandType: CommandType.StoredProcedure,
                cancellationToken: ct));

        return rows.ToList();
    }
}
