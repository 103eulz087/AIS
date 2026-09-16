using System.Security.Cryptography;
using Akrho.Infrastructure;
using Akrho.Infrastructure.Repositories;
using Dapper;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Akrho.Tests;

/*
 * usp_Enrolment_Issue's SECOND, bounded branch — added for the chapter-registration module
 * (see usp_Enrolment_Issue.sql's own header for the full reasoning): a council officer
 * holding a currently-seated Council-scoped role on an ANCESTOR council of a chapter may
 * issue that chapter's member his FIRST-EVER enrolment link, but only while that member has
 * no dbo.UserAccount row yet AND has never redeemed a link. This suite is entirely NEW and
 * lives in its own file/fixture/collection, deliberately separate from
 * EnrolmentIssueScopeTests.cs (branch 1 — the chapter's own ChapterAdmin), so it can never
 * share state with, or risk breaking, that suite. Run both together to confirm the three
 * original tests still pass unchanged alongside these.
 *
 * FIXTURE: reuses the real seeded chapter's OWN parent council (ChapterId=1, "Brgy. San
 * Isidro Chapter") as the jurisdiction under test — no new dbo.Council row is needed to
 * prove a council officer seated there has standing over a chapter parented under it.
 * Everything else is new and ZZTEST-prefixed, created and torn down entirely by this file:
 *   - ChapterC: a brand-new chapter parented under that SAME real council.
 *   - JurisdictionOfficerMemberId: a Council-scoped CouncilAdmin seated at that council —
 *     has standing over ChapterC.
 *   - An orphan dbo.Council row (ParentCouncilId = NULL, unrelated to any real tree) and
 *     NoJurisdictionOfficerMemberId seated there — has NO standing over ChapterC.
 * Both council-officer test doubles are Member rows via HomeCouncilId (CK_Member_Home),
 * never given a chapter of their own — they are never the TARGET of an issued link in this
 * suite, only ever the (accepted or rejected) ISSUER.
 */

public sealed class EnrolmentBoundedBranchDbFixture : IAsyncLifetime
{
    public string? ConnectionString { get; } = ChapterRegistrationTestDbConfig.ConnectionString;

    public int ChapterCId { get; private set; }
    public int JurisdictionCouncilId { get; private set; }
    public int JurisdictionOfficerMemberId { get; private set; }
    public int OrphanCouncilId { get; private set; }
    public int NoJurisdictionOfficerMemberId { get; private set; }

    public async Task InitializeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        JurisdictionCouncilId = await conn.ExecuteScalarAsync<int>(
            "SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = 1");
        JurisdictionCouncilId.Should().NotBe(0, "expected seed data (db/seed/02_demo_chapter.sql) not found");

        var councilAdminRoleId = await conn.ExecuteScalarAsync<int>(
            "SELECT RoleId FROM dbo.Role WHERE RoleName = N'CouncilAdmin'");
        var regionalLevelId = await conn.ExecuteScalarAsync<int>(
            "SELECT CouncilLevelId FROM dbo.CouncilLevel WHERE LevelName = N'Regional'");

        ChapterCId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Chapter (ParentCouncilId, ChapterName, Barangay, SuggestedContribution)
            OUTPUT INSERTED.ChapterId
            VALUES (@JurisdictionCouncilId, N'ZZTEST-EnrolBounded-ChapterC', N'ZZTEST', 0)
            """, new { JurisdictionCouncilId });

        JurisdictionOfficerMemberId = await CreateCouncilOfficerAsync(
            conn, "ZZTEST-EnrolBounded-JurisdictionOfficer", JurisdictionCouncilId, councilAdminRoleId);

        OrphanCouncilId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName)
            OUTPUT INSERTED.CouncilId
            VALUES (NULL, @regionalLevelId, N'ZZTEST-EnrolBounded-OrphanCouncil')
            """, new { regionalLevelId });

        NoJurisdictionOfficerMemberId = await CreateCouncilOfficerAsync(
            conn, "ZZTEST-EnrolBounded-NoJurisdictionOfficer", OrphanCouncilId, councilAdminRoleId);
    }

    private static async Task<int> CreateCouncilOfficerAsync(SqlConnection conn, string giftName, int councilId, int roleId)
    {
        var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        var memberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, HomeCouncilId, AttachReason, MemberNumber, FirstName, LastName, GiftName, StatusId)
            OUTPUT INSERTED.MemberId
            SELECT NULL, @councilId, N'ZZTEST fixture — council-officer test double', @memberNumber,
                   N'ZZTEST', N'ZZTEST', @giftName, StatusId
            FROM dbo.MemberStatus WHERE StatusName = N'Active'
            """,
            new { councilId, memberNumber, giftName });

        await conn.ExecuteAsync(
            "INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd) VALUES (@memberId, @roleId, 'Council', @councilId, '2020-01-01', NULL)",
            new { memberId, roleId, councilId });

        return memberId;
    }

    public async Task DisposeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        // Defensive: sweep up anything left behind by a failed test (its own EnrolmentLink,
        // UserAccount, MemberRole) for any member ever created under ChapterC, before removing
        // ChapterC itself and the two council-officer test doubles.
        await conn.ExecuteAsync(
            """
            DELETE al FROM dbo.AuditLog al
                JOIN dbo.Member m ON al.TableName = 'EnrolmentLink'
                    AND al.RecordId IN (SELECT CAST(LinkId AS NVARCHAR(40)) FROM dbo.EnrolmentLink WHERE MemberId = m.MemberId)
             WHERE m.ChapterId = @ChapterCId;
            DELETE el FROM dbo.EnrolmentLink el JOIN dbo.Member m ON m.MemberId = el.MemberId WHERE m.ChapterId = @ChapterCId;
            DELETE ua FROM dbo.UserAccount ua JOIN dbo.Member m ON m.MemberId = ua.MemberId WHERE m.ChapterId = @ChapterCId;
            DELETE mr FROM dbo.MemberRole mr JOIN dbo.Member m ON m.MemberId = mr.MemberId WHERE m.ChapterId = @ChapterCId;
            DELETE FROM dbo.Member WHERE ChapterId = @ChapterCId;
            DELETE FROM dbo.Chapter WHERE ChapterId = @ChapterCId;

            DELETE FROM dbo.MemberRole WHERE MemberId IN (@JurisdictionOfficerMemberId, @NoJurisdictionOfficerMemberId);
            DELETE FROM dbo.Member WHERE MemberId IN (@JurisdictionOfficerMemberId, @NoJurisdictionOfficerMemberId);
            DELETE FROM dbo.Council WHERE CouncilId = @OrphanCouncilId;
            """,
            new { ChapterCId, JurisdictionOfficerMemberId, NoJurisdictionOfficerMemberId, OrphanCouncilId });
    }
}

[CollectionDefinition("EnrolmentBoundedBranch")]
public sealed class EnrolmentBoundedBranchDbCollection : ICollectionFixture<EnrolmentBoundedBranchDbFixture>;

[Collection("EnrolmentBoundedBranch")]
public class EnrolmentIssueBoundedCouncilBranchTests
{
    private const string NoDbSkipReason = "no shared dev DB connection string configured";

    private readonly EnrolmentBoundedBranchDbFixture _fx;

    public EnrolmentIssueBoundedCouncilBranchTests(EnrolmentBoundedBranchDbFixture fx) => _fx = fx;

    private static IEnrolmentRepository BuildRepository(string connectionString) =>
        new EnrolmentRepository(new SqlConnectionFactory(connectionString));

    private static byte[] RandomHash() => RandomNumberGenerator.GetBytes(32);

    /// <summary>A brand-new member of ChapterC — mobile number and an active plain 'Member'
    /// role (both required by usp_Enrolment_Issue's OWN checks, independent of the
    /// chapter-scope predicate this suite is about) — but deliberately NO dbo.UserAccount row
    /// and NO EnrolmentLink history, so he is eligible for the bounded branch.</summary>
    private async Task<int> CreateFreshTargetMemberAsync(SqlConnection conn)
    {
        var memberRoleId = await conn.ExecuteScalarAsync<int>("SELECT RoleId FROM dbo.Role WHERE RoleName = N'Member'");
        var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];

        var memberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, MemberNumber, FirstName, LastName, GiftName, StatusId, MobileNo)
            OUTPUT INSERTED.MemberId
            SELECT @ChapterCId, @memberNumber, N'ZZTEST', N'ZZTEST', N'ZZTEST-Target', StatusId, N'09170000001'
            FROM dbo.MemberStatus WHERE StatusName = N'Active'
            """,
            new { _fx.ChapterCId, memberNumber });

        await conn.ExecuteAsync(
            "INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd) VALUES (@memberId, @memberRoleId, 'Chapter', @ChapterCId, '2020-01-01', NULL)",
            new { memberId, memberRoleId, _fx.ChapterCId });

        return memberId;
    }

    private static Task DeleteMemberAsync(SqlConnection conn, int memberId) =>
        conn.ExecuteAsync(
            """
            DELETE al FROM dbo.AuditLog al WHERE al.TableName = 'EnrolmentLink'
                AND al.RecordId IN (SELECT CAST(LinkId AS NVARCHAR(40)) FROM dbo.EnrolmentLink WHERE MemberId = @memberId);
            DELETE FROM dbo.EnrolmentLink WHERE MemberId = @memberId;
            DELETE FROM dbo.UserAccount WHERE MemberId = @memberId;
            DELETE FROM dbo.MemberRole WHERE MemberId = @memberId;
            DELETE FROM dbo.Member WHERE MemberId = @memberId;
            """,
            new { memberId });

    /// <summary>(a) A council officer over the chapter's jurisdiction CAN issue a first link to
    /// a brand-new member with no account.</summary>
    [SkippableFact]
    public async Task Council_officer_with_jurisdiction_can_issue_a_first_link_for_a_brand_new_member()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var targetMemberId = await CreateFreshTargetMemberAsync(conn);
        var repo = BuildRepository(_fx.ConnectionString!);

        try
        {
            var before = DateTime.UtcNow;
            var result = await repo.IssueAsync(targetMemberId, _fx.JurisdictionOfficerMemberId, RandomHash(), CancellationToken.None);

            result.LinkId.Should().BePositive();
            result.ExpiresOn.Should().BeCloseTo(before.AddHours(72), TimeSpan.FromMinutes(5));
        }
        finally
        {
            await DeleteMemberAsync(conn, targetMemberId);
        }
    }

    /// <summary>(b, account) Once the member has a dbo.UserAccount row, the SAME council
    /// officer can no longer issue for him — the bounded branch is first-credential-only, and
    /// he holds no chapter role over ChapterC to fall back on (branch 1).</summary>
    [SkippableFact]
    public async Task Council_officer_cannot_issue_a_second_link_once_the_member_has_an_account()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var targetMemberId = await CreateFreshTargetMemberAsync(conn);
        await conn.ExecuteAsync(
            "INSERT dbo.UserAccount (MemberId, PasswordHash) VALUES (@targetMemberId, N'ZZTEST-not-a-real-hash')",
            new { targetMemberId });

        var repo = BuildRepository(_fx.ConnectionString!);
        try
        {
            var act = async () => await repo.IssueAsync(targetMemberId, _fx.JurisdictionOfficerMemberId, RandomHash(), CancellationToken.None);

            var assertion = await act.Should().ThrowAsync<EnrolmentIssueException>(
                "the bounded council-issuer branch is FIRST-CREDENTIAL-ONLY — once an account exists, only the chapter's own admin may touch it");
            assertion.Which.Reason.Should().Be(EnrolmentIssueFailureReason.NotPermitted);
        }
        finally
        {
            await DeleteMemberAsync(conn, targetMemberId);
        }
    }

    /// <summary>(b, redeemed) Once the member has ever redeemed a link — even if his account
    /// were somehow removed afterward — the SAME council officer can no longer issue for him
    /// either; "never redeemed" is checked independently of "has an account".</summary>
    [SkippableFact]
    public async Task Council_officer_cannot_issue_a_second_link_once_the_member_has_ever_redeemed_one()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var targetMemberId = await CreateFreshTargetMemberAsync(conn);
        var repo = BuildRepository(_fx.ConnectionString!);

        try
        {
            var firstLink = await repo.IssueAsync(targetMemberId, _fx.JurisdictionOfficerMemberId, RandomHash(), CancellationToken.None);

            // Simulate redemption directly (this suite is about usp_Enrolment_Issue's own
            // predicate, not usp_Enrolment_Redeem's) — mark the link redeemed without creating
            // a real UserAccount, to prove the "ever redeemed" check is independent of "has an
            // account today".
            await conn.ExecuteAsync(
                "UPDATE dbo.EnrolmentLink SET RedeemedOn = SYSUTCDATETIME() WHERE LinkId = @linkId",
                new { linkId = firstLink.LinkId });

            var act = async () => await repo.IssueAsync(targetMemberId, _fx.JurisdictionOfficerMemberId, RandomHash(), CancellationToken.None);

            var assertion = await act.Should().ThrowAsync<EnrolmentIssueException>();
            assertion.Which.Reason.Should().Be(EnrolmentIssueFailureReason.NotPermitted);
        }
        finally
        {
            await DeleteMemberAsync(conn, targetMemberId);
        }
    }

    /// <summary>(c) A council officer with NO jurisdiction over the chapter cannot issue
    /// anything for one of its members, even a brand-new one who would otherwise qualify.</summary>
    [SkippableFact]
    public async Task Council_officer_with_no_jurisdiction_cannot_issue_anything()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var targetMemberId = await CreateFreshTargetMemberAsync(conn);
        var repo = BuildRepository(_fx.ConnectionString!);

        EnrolmentIssueResultRow? created = null;
        try
        {
            var act = async () =>
                created = await repo.IssueAsync(targetMemberId, _fx.NoJurisdictionOfficerMemberId, RandomHash(), CancellationToken.None);

            var assertion = await act.Should().ThrowAsync<EnrolmentIssueException>(
                "a council officer with no jurisdiction over this chapter must never be able to issue its members a link — CLAUDE.md invariant #4");
            assertion.Which.Reason.Should().Be(EnrolmentIssueFailureReason.NotPermitted);
        }
        finally
        {
            await DeleteMemberAsync(conn, targetMemberId);
            _ = created; // never expected to be set; nothing extra to clean up if it somehow were (DeleteMemberAsync already covers it)
        }
    }
}
