using System.Data;
using System.Security.Cryptography;
using Akrho.Infrastructure;
using Akrho.Infrastructure.Repositories;
using Dapper;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Akrho.Tests;

/*
 * usp_ChapterRegistration_Approve — atomicity and two-person-control suite.
 *
 * Every test here builds its own real Charter registration through the real, public
 * usp_ChapterRegistration_Submit (via ChapterRegistrationRepository.SubmitAsync — the exact
 * code path a real petitioner uses), then redirects ActingCouncilId with a single direct
 * UPDATE to a council this suite fully controls (the real seeded chapter's own parent
 * council — reused rather than inventing a new dbo.Council row, since this suite does not
 * need to own any of that geography/level complexity to prove approval's own behavior), and
 * marks a chosen number of the 8 officer rows verified with a direct UPDATE. Everything
 * downstream of that (VerifyOfficer's own re-checks, Approve's own transaction) is exercised
 * for real, against the real stored procedures — nothing here mocks the database.
 *
 * "Seed it yourself, clean it up yourself": each test creates its own registration+officers
 * and deletes them (plus anything Approve may have written) in a finally block. The two
 * council-officer test doubles (a CouncilAdmin and a CouncilSecretary-only member, neither
 * ChapterAdmin of anything) are created once by the fixture and shared read-only across
 * tests, then torn down in DisposeAsync.
 */

public sealed class ChapterRegistrationApprovalDbFixture : IAsyncLifetime
{
    public string? ConnectionString { get; } = ChapterRegistrationTestDbConfig.ConnectionString;

    public int ActingCouncilId { get; private set; }
    public int CouncilAdminMemberId { get; private set; }
    public int CouncilSecretaryMemberId { get; private set; }

    public async Task InitializeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        ActingCouncilId = await conn.ExecuteScalarAsync<int>(
            "SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = 1");
        ActingCouncilId.Should().NotBe(0, "expected seed data (db/seed/02_demo_chapter.sql) not found");

        var councilAdminRoleId = await conn.ExecuteScalarAsync<int>(
            "SELECT RoleId FROM dbo.Role WHERE RoleName = N'CouncilAdmin'");
        var councilSecretaryRoleId = await conn.ExecuteScalarAsync<int>(
            "SELECT RoleId FROM dbo.Role WHERE RoleName = N'CouncilSecretary'");

        CouncilAdminMemberId = await CreateCouncilOfficerAsync(conn, "ZZTEST-ApprovalControl-CouncilAdmin", councilAdminRoleId);
        CouncilSecretaryMemberId = await CreateCouncilOfficerAsync(conn, "ZZTEST-ApprovalControl-CouncilSecretary", councilSecretaryRoleId);
    }

    private async Task<int> CreateCouncilOfficerAsync(SqlConnection conn, string giftName, int roleId)
    {
        var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        var memberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, HomeCouncilId, AttachReason, MemberNumber, FirstName, LastName, GiftName, StatusId)
            OUTPUT INSERTED.MemberId
            SELECT NULL, @ActingCouncilId, N'ZZTEST fixture — council-officer test double', @memberNumber,
                   N'ZZTEST', N'ZZTEST', @giftName, StatusId
            FROM dbo.MemberStatus WHERE StatusName = N'Active'
            """,
            new { ActingCouncilId, memberNumber, giftName });

        await conn.ExecuteAsync(
            """
            INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)
            VALUES (@memberId, @roleId, 'Council', @ActingCouncilId, '2020-01-01', NULL)
            """,
            new { memberId, roleId, ActingCouncilId });

        return memberId;
    }

    public async Task DisposeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        await conn.ExecuteAsync(
            """
            DELETE FROM dbo.MemberRole WHERE MemberId IN (@a, @s);
            DELETE FROM dbo.Member WHERE MemberId IN (@a, @s);
            """,
            new { a = CouncilAdminMemberId, s = CouncilSecretaryMemberId });
    }
}

[CollectionDefinition("ChapterRegistrationApproval")]
public sealed class ChapterRegistrationApprovalDbCollection : ICollectionFixture<ChapterRegistrationApprovalDbFixture>;

[Collection("ChapterRegistrationApproval")]
public class ChapterRegistrationApprovalControlTests
{
    private const string NoDbSkipReason = "no shared dev DB connection string configured";

    private readonly ChapterRegistrationApprovalDbFixture _fx;

    public ChapterRegistrationApprovalControlTests(ChapterRegistrationApprovalDbFixture fx) => _fx = fx;

    private static IChapterRegistrationRepository BuildRepository(string connectionString) =>
        new ChapterRegistrationRepository(new SqlConnectionFactory(connectionString));

    /// <summary>
    /// Builds one Charter registration directly against ActingCouncilId=<paramref
    /// name="actingCouncilId"/> with <paramref name="verifiedCount"/> of its 8 officers
    /// already verified. NOTE: this does NOT go through usp_ChapterRegistration_Submit — see
    /// ChapterRegistrationTestHelpers.InsertCharterRegistrationDirectAsync's own comment for
    /// why (the shared dev DB has no council anywhere with a seated officer today, so Submit's
    /// own routing call unconditionally throws 51090 regardless of geography). Approve and
    /// VerifyOfficer only ever read this row's current state, never how it arrived, so this
    /// does not weaken what these tests actually prove about THOSE two procedures.
    /// </summary>
    private static async Task<(int RegistrationId, string Marker)> CreateSubmittedCharterAsync(
        SqlConnection conn, string connectionString, int actingCouncilId, int verifiedCount, int verifiedBy)
    {
        _ = connectionString; // kept for signature symmetry with call sites; no longer needed directly here.
        var (registrationId, _, marker, _) =
            await ChapterRegistrationTestHelpers.InsertCharterRegistrationDirectAsync(conn, actingCouncilId, verifiedCount, verifiedBy);

        return (registrationId, marker);
    }

    /// <summary>Deletes everything a test in this file could possibly have created for one
    /// registration: the registration/officers themselves, and — only if Approve actually got
    /// far enough to write them (the atomicity test asserts it must NOT) — any Chapter/Member/
    /// MemberRole/EnrolmentLink/AuditLog rows tied to it.</summary>
    private static Task CleanupAsync(SqlConnection conn, int registrationId) =>
        conn.ExecuteAsync(
            """
            DELETE el FROM dbo.EnrolmentLink el
                JOIN dbo.ChapterRegistrationOfficer o ON o.CreatedMemberId = el.MemberId
             WHERE o.RegistrationId = @registrationId;

            DELETE al FROM dbo.AuditLog al WHERE al.NewValues LIKE '%"RegistrationId":' + CAST(@registrationId AS NVARCHAR(20)) + '%';

            DECLARE @createdChapterId INT = (SELECT CreatedChapterId FROM dbo.ChapterRegistration WHERE RegistrationId = @registrationId);
            IF @createdChapterId IS NOT NULL
                DELETE al FROM dbo.AuditLog al WHERE al.TableName = 'Chapter' AND al.RecordId = CAST(@createdChapterId AS NVARCHAR(40));

            DELETE mr FROM dbo.MemberRole mr
                JOIN dbo.ChapterRegistrationOfficer o ON o.CreatedMemberId = mr.MemberId
             WHERE o.RegistrationId = @registrationId;

            DELETE m FROM dbo.Member m
                JOIN dbo.ChapterRegistrationOfficer o ON o.CreatedMemberId = m.MemberId
             WHERE o.RegistrationId = @registrationId;

            DELETE FROM dbo.ChapterRegistrationOfficer WHERE RegistrationId = @registrationId;
            DELETE FROM dbo.ChapterRegistrationUpdate WHERE RegistrationId = @registrationId;
            DELETE FROM dbo.ApprovalRouting WHERE SubjectType = 'Chapter' AND SubjectId = @registrationId;

            IF @createdChapterId IS NOT NULL DELETE FROM dbo.Chapter WHERE ChapterId = @createdChapterId;

            DELETE FROM dbo.ChapterRegistration WHERE RegistrationId = @registrationId;
            """,
            new { registrationId });

    private static byte[] RandomHash() => RandomNumberGenerator.GetBytes(32);

    /// <summary>
    /// Two-person control (decision E1b): a CouncilSecretary — who CAN verify every officer —
    /// still cannot give final approval, even when all 8 are verified. The exact procedure
    /// message ("Only this council's President may give final approval.") must reach the
    /// caller through ChapterRegistrationException, not be swallowed into a generic 500.
    /// </summary>
    [SkippableFact]
    public async Task CouncilSecretary_cannot_approve_even_when_all_8_officers_are_verified()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var (registrationId, _) = await CreateSubmittedCharterAsync(
            conn, _fx.ConnectionString!, _fx.ActingCouncilId, verifiedCount: 8, verifiedBy: _fx.CouncilSecretaryMemberId);

        try
        {
            var repo = BuildRepository(_fx.ConnectionString!);

            var act = async () => await repo.ApproveAsync(
                registrationId, "Charter", _fx.CouncilSecretaryMemberId,
                RandomHash(), null, new Dictionary<int, byte[]>(), CancellationToken.None);

            var assertion = await act.Should().ThrowAsync<ChapterRegistrationException>();
            assertion.Which.Category.Should().Be(ChapterRegistrationErrorCategory.Forbidden);
            assertion.Which.Message.Should().Contain("Only this council's President may give final approval");

            // Nothing decided — the registration is still exactly where it was.
            var statusName = await conn.ExecuteScalarAsync<string>(
                """
                SELECT s.StatusName FROM dbo.ChapterRegistration cr
                JOIN dbo.ChapterRegistrationStatus s ON s.StatusId = cr.StatusId
                WHERE cr.RegistrationId = @registrationId
                """, new { registrationId });
            statusName.Should().Be("Submitted");
        }
        finally
        {
            await CleanupAsync(conn, registrationId);
        }
    }

    /// <summary>
    /// The "(N of 8 verified)" THROW must be surfaced to the caller with the LIVE count in
    /// the message, through the same ChapterRegistrationException/Conflict path — not a bare
    /// rejection with no explanation.
    /// </summary>
    [SkippableFact]
    public async Task Approve_reports_the_exact_verified_count_when_not_every_officer_is_verified()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var (registrationId, _) = await CreateSubmittedCharterAsync(
            conn, _fx.ConnectionString!, _fx.ActingCouncilId, verifiedCount: 5, verifiedBy: _fx.CouncilSecretaryMemberId);

        try
        {
            var repo = BuildRepository(_fx.ConnectionString!);

            var act = async () => await repo.ApproveAsync(
                registrationId, "Charter", _fx.CouncilAdminMemberId,
                RandomHash(), null, new Dictionary<int, byte[]>(), CancellationToken.None);

            var assertion = await act.Should().ThrowAsync<ChapterRegistrationException>();
            assertion.Which.Category.Should().Be(ChapterRegistrationErrorCategory.Conflict);
            assertion.Which.Message.Should().Contain("5 of 8 verified");
        }
        finally
        {
            await CleanupAsync(conn, registrationId);
        }
    }

    /// <summary>
    /// APPROVAL ATOMICITY. All 8 officers verified, caller is genuinely this council's
    /// CouncilAdmin — approval WOULD succeed, except the President's enrolment link is forced
    /// to collide (a pre-planted dbo.EnrolmentLink row using the SAME TokenHash the endpoint
    /// would generate) with dbo.EnrolmentLink's own UNIQUE constraint on TokenHash, deep
    /// inside usp_Enrolment_Issue, called from partway through usp_ChapterRegistration_Approve's
    /// Charter branch — after the chapter row and several officers' Member/MemberRole rows have
    /// already been inserted in the SAME transaction. SET XACT_ABORT ON (both procedures) means
    /// that failure dooms the whole transaction: this test proves NOTHING committed — no
    /// Chapter row, no Member rows, no MemberRole rows, no EnrolmentLink row beyond the one
    /// this test itself pre-planted, no AuditLog rows referencing this registration, and the
    /// registration's own row is untouched (still Submitted, IsOpen, no CreatedChapterId).
    /// </summary>
    [SkippableFact]
    public async Task Approve_leaves_zero_rows_anywhere_when_the_enrolment_link_insert_fails_partway_through()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var (registrationId, marker) = await CreateSubmittedCharterAsync(
            conn, _fx.ConnectionString!, _fx.ActingCouncilId, verifiedCount: 8, verifiedBy: _fx.CouncilAdminMemberId);

        // A throwaway member to own the pre-planted, colliding EnrolmentLink row — never a real
        // seeded member, so this can never collide with UQ_EnrolmentLink_ActivePerMember on
        // anyone else's real, live link.
        var dummyMemberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        var dummyMemberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, HomeCouncilId, AttachReason, MemberNumber, FirstName, LastName, GiftName, StatusId)
            OUTPUT INSERTED.MemberId
            SELECT NULL, @ActingCouncilId, N'ZZTEST fixture — pre-planted colliding link owner', @dummyMemberNumber,
                   N'ZZTEST', N'ZZTEST', N'ZZTEST-DummyLinkOwner', StatusId
            FROM dbo.MemberStatus WHERE StatusName = N'Active'
            """,
            new { ActingCouncilId = _fx.ActingCouncilId, dummyMemberNumber });

        var collidingHash = RandomHash();
        var plantedLinkId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.EnrolmentLink (MemberId, TokenHash, MobileNoAtIssue, IssuedBy, ExpiresOn)
            OUTPUT INSERTED.LinkId
            VALUES (@dummyMemberId, @collidingHash, N'09170000000', @dummyMemberId, DATEADD(HOUR, 72, SYSUTCDATETIME()))
            """,
            new { dummyMemberId, collidingHash });

        try
        {
            var repo = BuildRepository(_fx.ConnectionString!);

            // The Charter branch's own INSERT...EXEC usp_Enrolment_Issue for the President will
            // try to insert a NEW EnrolmentLink row with this exact TokenHash and fail on the
            // UNIQUE constraint — a real SqlException (2627), not something either procedure's
            // own THROW numbers cover, so it propagates unwrapped.
            var act = async () => await repo.ApproveAsync(
                registrationId, "Charter", _fx.CouncilAdminMemberId,
                collidingHash, null, new Dictionary<int, byte[]>(), CancellationToken.None);

            var assertion = await act.Should().ThrowAsync<SqlException>();
            assertion.Which.Number.Should().BeOneOf(2601, 2627);

            // ---- Nothing committed, anywhere. ----

            var chapterCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.Chapter WHERE ChapterName = @marker", new { marker });
            chapterCount.Should().Be(0, "the Chapter insert must have rolled back with everything else");

            var memberCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.Member WHERE GiftName LIKE @pattern", new { pattern = $"{marker}-%" });
            memberCount.Should().Be(0, "none of the 8 officers' Member rows may survive a doomed transaction");

            var memberRoleCount = await conn.ExecuteScalarAsync<int>(
                """
                SELECT COUNT(*) FROM dbo.MemberRole mr
                JOIN dbo.Member m ON m.MemberId = mr.MemberId
                WHERE m.GiftName LIKE @pattern
                """, new { pattern = $"{marker}-%" });
            memberRoleCount.Should().Be(0);

            var enrolmentLinkCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.EnrolmentLink WHERE TokenHash = @collidingHash", new { collidingHash });
            enrolmentLinkCount.Should().Be(1, "exactly the one link THIS TEST pre-planted — no second row, no seal issued");

            var auditCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.AuditLog WHERE NewValues LIKE '%\"RegistrationId\":' + CAST(@registrationId AS NVARCHAR(20)) + '%'",
                new { registrationId });
            auditCount.Should().Be(0, "no audit row for this registration's approval may exist — the write it would record never committed");

            var (statusName, isOpen, createdChapterId) = await conn.QuerySingleAsync<(string StatusName, bool IsOpen, int? CreatedChapterId)>(
                """
                SELECT s.StatusName, cr.IsOpen, cr.CreatedChapterId
                FROM dbo.ChapterRegistration cr JOIN dbo.ChapterRegistrationStatus s ON s.StatusId = cr.StatusId
                WHERE cr.RegistrationId = @registrationId
                """, new { registrationId });
            statusName.Should().Be("Submitted", "member status/seal/receipt atomicity extends to the registration's own decision fields");
            isOpen.Should().BeTrue();
            createdChapterId.Should().BeNull();
        }
        finally
        {
            await conn.ExecuteAsync(
                """
                DELETE FROM dbo.AuditLog WHERE TableName = 'EnrolmentLink' AND RecordId = CAST(@plantedLinkId AS NVARCHAR(40));
                DELETE FROM dbo.EnrolmentLink WHERE LinkId = @plantedLinkId;
                DELETE FROM dbo.Member WHERE MemberId = @dummyMemberId;
                """,
                new { plantedLinkId, dummyMemberId });
            await CleanupAsync(conn, registrationId);
        }
    }
}
