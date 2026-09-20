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
 * "Resend enrolment link" — chapter-scope enforcement suite.
 *
 * usp_Enrolment_Issue.sql was just given a chapter-scope check (THROW 51290): @IssuedBy must
 * currently hold the ChapterAdmin role, scoped to the SAME chapter as @MemberId, or the call is
 * rejected — CLAUDE.md invariant #4 ("never trust a chapterId from the request body", applied
 * here to "never trust that the caller is who he claims to be relative to the target member").
 * That change is a stored-procedure edit only, in db/procs/usp_Enrolment_Issue.sql — it has NOT
 * been deployed to the shared dev database (corex.itcoreapps.com,6601 / AISDB) as of this
 * writing. Tests 2 and 3 below are written against the NEW, intended behavior and are EXPECTED
 * TO FAIL (or, if the old proc happens to let the call through, to leave a real EnrolmentLink
 * row behind that the test itself cleans up) until that proc is deployed. Do not weaken either
 * test to pass against the old proc.
 *
 * This follows ChatModuleIntegrationTests.cs's own established pattern to the letter (read that
 * file's header first) rather than inventing a second one: no WebApplicationFactory/TestServer,
 * straight Dapper + Microsoft.Data.SqlClient against the shared dev DB for fixture plumbing, the
 * real EnrolmentRepository (via a real SqlConnectionFactory) for the calls actually under test —
 * because the stored procedure IS the authorization boundary here, and mocking it would test
 * nothing — [SkippableFact] + Skip.If so a missing connection string reports as genuinely
 * Skipped rather than silently Passed, and ChatDbTestConfig (internal, same assembly) is reused
 * verbatim for connection-string resolution rather than duplicated.
 *
 * SEED DATA: db/seed/02_demo_chapter.sql's chapter (ChapterId=1, "Brgy. San Isidro Chapter")
 * seeds AKR-04-0117-001 (TANGLAW) as ChapterAdmin, with a MobileNo, and AKR-04-0117-002 (BAGWIS)
 * as a plain member — but the seed script gives BAGWIS (and every other seeded member besides
 * TANGLAW) neither a MobileNo nor any MemberRole row at all. usp_Enrolment_Issue requires BOTH
 * on the TARGET member (THROW 51100 / 51101) for reasons that have nothing to do with the
 * chapter-scope check this suite exists to prove. Rather than assume the shared dev DB has since
 * been hand-mutated by manual testing of this exact feature, EnsureEnrolmentEligibleAsync below
 * checks and, if missing, temporarily supplies both, restoring the original state in the same
 * test's `finally`/`await using` — "seed it yourself, clean it up yourself", the same rule
 * ChatDbFixture and every per-test cleanup in this project already follows. It never touches
 * chapter 1's real member ROWS otherwise, and never leaves a temporary MobileNo or MemberRole
 * behind.
 *
 * A second chapter does not exist in the shared dev DB for a real cross-chapter admin to exist
 * in, so — exactly as ChatDbFixture does for "Chapter B" — this suite creates ONE dedicated,
 * unmistakably-named chapter and ChapterAdmin member for it ("ZZTEST-EnrolmentScope-ChapterB" /
 * member number prefixed "ZZTEST-") and deletes both, plus anything hung off them, in
 * DisposeAsync.
 */

/// <summary>
/// Chapter A is the real seeded chapter; nothing is created or torn down for it beyond the
/// scoped, restored mutations documented above. Chapter B does not exist in the shared dev DB
/// today, so this fixture creates one dedicated ChapterAdmin-scoped chapter+member for it.
/// </summary>
public sealed class EnrolmentDbFixture : IAsyncLifetime
{
    public string? ConnectionString { get; } = ChatDbTestConfig.ConnectionString;

    public int ChapterAId { get; private set; }
    public int ChapterAAdminId { get; private set; }   // AKR-04-0117-001 / TANGLAW / ChapterAdmin
    public int ChapterAMemberId { get; private set; }  // AKR-04-0117-002 / BAGWIS / plain member

    public int ChapterBId { get; private set; }
    public int ChapterBAdminId { get; private set; }   // ZZTEST- / ChapterAdmin of chapter B only

    public async Task InitializeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        ChapterAId = await conn.ExecuteScalarAsync<int>(
            "SELECT ChapterId FROM dbo.Chapter WHERE ChapterName = N'Brgy. San Isidro Chapter'");
        ChapterAAdminId = await conn.ExecuteScalarAsync<int>(
            "SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-001'");
        ChapterAMemberId = await conn.ExecuteScalarAsync<int>(
            "SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-002'");

        if (ChapterAId == 0 || ChapterAAdminId == 0 || ChapterAMemberId == 0)
            throw new InvalidOperationException(
                "Expected seed data (db/seed/02_demo_chapter.sql) not found in the configured database — " +
                "cannot run the enrolment-issue chapter-scope suite against it.");

        var parentCouncilId = await conn.ExecuteScalarAsync<int>(
            "SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterAId", new { ChapterAId });
        var activeStatusId = await conn.ExecuteScalarAsync<int>(
            "SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = N'Active'");
        var chapterAdminRoleId = await conn.ExecuteScalarAsync<int>(
            "SELECT RoleId FROM dbo.Role WHERE RoleName = N'ChapterAdmin'");

        ChapterBId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Chapter (ParentCouncilId, ChapterName, Barangay, SuggestedContribution)
            OUTPUT INSERTED.ChapterId
            VALUES (@parentCouncilId, N'ZZTEST-EnrolmentScope-ChapterB', N'ZZTEST', 0)
            """,
            new { parentCouncilId });

        var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        ChapterBAdminId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, MemberNumber, FirstName, LastName, GiftName, StatusId, MobileNo)
            OUTPUT INSERTED.MemberId
            VALUES (@ChapterBId, @memberNumber, N'ZZTEST', N'ZZTEST', N'ZZTEST-ChapterB-Admin', @activeStatusId, N'09170000000')
            """,
            new { ChapterBId, memberNumber, activeStatusId });

        await conn.ExecuteAsync(
            """
            INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)
            VALUES (@ChapterBAdminId, @chapterAdminRoleId, 'Chapter', @ChapterBId, '2020-01-01', NULL)
            """,
            new { ChapterBAdminId, chapterAdminRoleId, ChapterBId });
    }

    public async Task DisposeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        // Deletion order respects FK dependencies: EnrolmentLink (references Member) -> its
        // AuditLog rows -> MemberRole -> the member -> the chapter. Scoped entirely to
        // ChapterBAdminId/ChapterBId; chapter A (real seed data) is never touched here. No test
        // in this suite is expected to leave an EnrolmentLink for the chapter-B admin himself —
        // he is only ever used as the (rejected) ISSUER, never the target — but this cleans up
        // defensively in case a regression ever lets that call succeed.
        await conn.ExecuteAsync(
            """
            DELETE al FROM dbo.AuditLog al
             WHERE al.TableName = 'EnrolmentLink'
               AND al.RecordId IN (SELECT CAST(LinkId AS NVARCHAR(40)) FROM dbo.EnrolmentLink WHERE MemberId = @ChapterBAdminId);

            DELETE FROM dbo.EnrolmentLink WHERE MemberId = @ChapterBAdminId;
            DELETE FROM dbo.MemberRole WHERE MemberId = @ChapterBAdminId;
            DELETE FROM dbo.Member WHERE MemberId = @ChapterBAdminId;
            DELETE FROM dbo.Chapter WHERE ChapterId = @ChapterBId;
            """,
            new { ChapterBAdminId, ChapterBId });
    }
}

[CollectionDefinition("EnrolmentDb")]
public sealed class EnrolmentDbCollection : ICollectionFixture<EnrolmentDbFixture>;

[Collection("EnrolmentDb")]
public class EnrolmentIssueScopeTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly EnrolmentDbFixture _fx;

    public EnrolmentIssueScopeTests(EnrolmentDbFixture fx)
    {
        _fx = fx;
    }

    private static IEnrolmentRepository BuildRepository(string connectionString) =>
        new EnrolmentRepository(new SqlConnectionFactory(connectionString));

    private static byte[] RandomTokenHash() => RandomNumberGenerator.GetBytes(32);

    /// <summary>
    /// Deletes exactly the one EnrolmentLink row (and its AuditLog row) a test itself created —
    /// never every link for the member, which would also erase real, pre-existing history that
    /// has nothing to do with this test run. Safe to call whether or not IssueAsync ever
    /// actually returned a row.
    /// </summary>
    private static Task CleanupIssuedLinkAsync(SqlConnection conn, int linkId) =>
        conn.ExecuteAsync(
            """
            DELETE FROM dbo.AuditLog WHERE TableName = 'EnrolmentLink' AND RecordId = @recordId;
            DELETE FROM dbo.EnrolmentLink WHERE LinkId = @linkId;
            """,
            new { linkId, recordId = linkId.ToString() });

    /// <summary>
    /// See this file's header ("SEED DATA") for why this exists. Ensures the given member has a
    /// MobileNo and at least one currently-active MemberRole — both required by
    /// usp_Enrolment_Issue's existing checks (51100/51101), independent of the new chapter-scope
    /// check this suite is actually about — restoring exactly what it changed, and nothing else,
    /// when the returned handle is disposed.
    /// </summary>
    private static async Task<IAsyncDisposable> EnsureEnrolmentEligibleAsync(SqlConnection conn, int memberId, int chapterId)
    {
        var originalMobile = await conn.ExecuteScalarAsync<string?>(
            "SELECT MobileNo FROM dbo.Member WHERE MemberId = @memberId", new { memberId });

        var mobileWasNull = originalMobile is null;
        if (mobileWasNull)
        {
            await conn.ExecuteAsync(
                "UPDATE dbo.Member SET MobileNo = N'09170000099' WHERE MemberId = @memberId",
                new { memberId });
        }

        var today = DateTime.UtcNow.Date;
        var hasActiveRole = await conn.ExecuteScalarAsync<bool>(
            """
            SELECT CASE WHEN EXISTS (
                SELECT 1 FROM dbo.MemberRole
                WHERE MemberId = @memberId
                  AND TermStart <= @today
                  AND (TermEnd IS NULL OR TermEnd >= @today)
            ) THEN 1 ELSE 0 END
            """,
            new { memberId, today });

        int? tempMemberRoleId = null;
        if (!hasActiveRole)
        {
            tempMemberRoleId = await conn.ExecuteScalarAsync<int>(
                """
                INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)
                OUTPUT INSERTED.MemberRoleId
                SELECT @memberId, RoleId, 'Chapter', @chapterId, '2020-01-01', NULL
                FROM dbo.Role WHERE RoleName = N'Member'
                """,
                new { memberId, chapterId });
        }

        return new EligibilityRestorer(conn, memberId, mobileWasNull, tempMemberRoleId);
    }

    private sealed class EligibilityRestorer(SqlConnection conn, int memberId, bool mobileWasNull, int? tempMemberRoleId)
        : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            if (tempMemberRoleId is { } id)
                await conn.ExecuteAsync("DELETE FROM dbo.MemberRole WHERE MemberRoleId = @id", new { id });

            if (mobileWasNull)
                await conn.ExecuteAsync(
                    "UPDATE dbo.Member SET MobileNo = NULL WHERE MemberId = @memberId", new { memberId });
        }
    }

    /// <summary>
    /// The core "resend enrolment link" happy path: a chapter's own ChapterAdmin re-issuing a
    /// fresh link for an ordinary member of that SAME chapter. This must succeed both before and
    /// after the new 51290 check is deployed — the check only ever rejects a MISMATCHED chapter,
    /// never same-chapter admin issuing for his own member.
    /// </summary>
    [SkippableFact]
    public async Task ChapterAdmin_can_issue_a_fresh_link_for_an_ordinary_member_of_the_same_chapter()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        await using var eligibility = await EnsureEnrolmentEligibleAsync(conn, _fx.ChapterAMemberId, _fx.ChapterAId);
        var repo = BuildRepository(_fx.ConnectionString!);

        var before = DateTime.UtcNow;
        var result = await repo.IssueAsync(_fx.ChapterAMemberId, _fx.ChapterAAdminId, RandomTokenHash(), null, CancellationToken.None);

        try
        {
            result.LinkId.Should().BePositive();
            result.ExpiresOn.Should().BeCloseTo(before.AddHours(72), TimeSpan.FromMinutes(5),
                "usp_Enrolment_Issue defaults @ExpiresOn to 72 hours from now when the caller supplies none");
        }
        finally
        {
            await CleanupIssuedLinkAsync(conn, result.LinkId);
        }
    }

    /// <summary>
    /// The regression this proc change exists to close: a ChapterAdmin of one chapter must not
    /// be able to issue an enrolment link for a member of a DIFFERENT chapter, even by supplying
    /// that member's real id directly to the repository (no scope guard above this layer to rely
    /// on — the procedure itself is the boundary, CLAUDE.md invariant #4).
    ///
    /// EXPECTED TO FAIL against the currently-deployed usp_Enrolment_Issue.sql, which has no
    /// 51290 check yet — see this file's header. If the old proc lets the call through, this
    /// test's own `finally` cleans up whatever EnrolmentLink row that created; the assertion
    /// itself is left as-is so the failure is visible, not silently accommodated.
    /// </summary>
    [SkippableFact]
    public async Task Admin_of_a_different_chapter_cannot_issue_a_link_for_another_chapters_member()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        await using var eligibility = await EnsureEnrolmentEligibleAsync(conn, _fx.ChapterAMemberId, _fx.ChapterAId);
        var repo = BuildRepository(_fx.ConnectionString!);

        EnrolmentIssueResultRow? created = null;
        try
        {
            var act = async () =>
                created = await repo.IssueAsync(_fx.ChapterAMemberId, _fx.ChapterBAdminId, RandomTokenHash(), null, CancellationToken.None);

            var assertion = await act.Should().ThrowAsync<EnrolmentIssueException>(
                "a chapter admin from a different chapter must never be able to issue an enrolment link " +
                "for another chapter's member — CLAUDE.md invariant #4");
            assertion.Which.Reason.Should().Be(EnrolmentIssueFailureReason.NotPermitted);
        }
        finally
        {
            if (created is { } row)
                await CleanupIssuedLinkAsync(conn, row.LinkId);
        }
    }

    /// <summary>
    /// The proc requires ChapterAdmin specifically — same-chapter membership alone is not
    /// enough. An ordinary member (AKR-04-0117-002 / BAGWIS) may not issue a link for a fellow
    /// member of his own chapter (AKR-04-0117-003 / LAKANDULA).
    ///
    /// EXPECTED TO FAIL against the currently-deployed proc, same reasoning as the cross-chapter
    /// test above.
    /// </summary>
    [SkippableFact]
    public async Task Ordinary_member_cannot_issue_a_link_for_a_fellow_member_of_the_same_chapter()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var targetMemberId = await conn.ExecuteScalarAsync<int>(
            "SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-003'");
        targetMemberId.Should().NotBe(0, "expected seed data (AKR-04-0117-003 / LAKANDULA) not found in the configured database");

        await using var eligibility = await EnsureEnrolmentEligibleAsync(conn, targetMemberId, _fx.ChapterAId);
        var repo = BuildRepository(_fx.ConnectionString!);

        EnrolmentIssueResultRow? created = null;
        try
        {
            var act = async () =>
                created = await repo.IssueAsync(targetMemberId, _fx.ChapterAMemberId, RandomTokenHash(), null, CancellationToken.None);

            var assertion = await act.Should().ThrowAsync<EnrolmentIssueException>(
                "only a ChapterAdmin may issue an enrolment link — an ordinary same-chapter member has no standing to");
            assertion.Which.Reason.Should().Be(EnrolmentIssueFailureReason.NotPermitted);
        }
        finally
        {
            if (created is { } row)
                await CleanupIssuedLinkAsync(conn, row.LinkId);
        }
    }
}
