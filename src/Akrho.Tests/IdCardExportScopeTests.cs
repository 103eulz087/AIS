using System.Data;
using Akrho.Infrastructure;
using Akrho.Infrastructure.Repositories;
using Dapper;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Akrho.Tests;

/*
 * National ID card export — permission-boundary and idempotency suite for
 * usp_Member_ListForIdCardExport / usp_Credential_BulkIssueForExport, via the real
 * IdCardExportRepository (Dapper + stored procedures) — never mocked, per this project's own
 * rule ("the procedures are the logic; mocking them tests nothing").
 *
 * Follows EnrolmentIssueScopeTests.cs / ChapterRegistrationApprovalControlTests.cs to the
 * letter: no WebApplicationFactory/TestServer; straight Dapper + Microsoft.Data.SqlClient
 * against the shared dev DB (CLAUDE.md §10) for fixture plumbing; ChatDbTestConfig (internal,
 * same assembly) reused verbatim for connection-string resolution; [SkippableFact] + Skip.If
 * so a missing connection string reports genuinely Skipped, not silently Passed.
 *
 * SEED DATA REUSED, NOT DUPLICATED:
 *  - AKR-04-0117-002 (BAGWIS) — the real seeded, deliberately role-less ordinary member (see
 *    02_demo_chapter.sql's own comment: several other suites already depend on him staying
 *    role-less, so this suite only ever READS his id, never seats him with anything).
 *  - AKR-04-0117-004 (HIMAGSIK) — the real seeded CouncilAdmin of "Sta. Rosa City Council", a
 *    City/Municipal-level council, NOT National. This is the exact "seated CouncilAdmin
 *    somewhere, but not on the National Council" case the feature exists to reject — reusing
 *    the real seed rather than building a second council chain for it.
 *
 * WHAT THIS SUITE CREATES (and tears down in DisposeAsync): db/seed/02_demo_chapter.sql
 * deliberately leaves the National Council UNSEATED (see its own comment — a real,
 * documented environment gap other suites route around rather than depend on). A true
 * National CouncilAdmin does not exist in the shared dev DB, so this fixture seats one
 * itself: one ZZTEST, council-homed member (ChapterId NULL / HomeCouncilId = National,
 * CLAUDE.md invariant #14) with an open-ended CouncilAdmin MemberRole scoped to the National
 * council. It also creates one dedicated ZZTEST chapter with its own ZZTEST members, so the
 * bulk-issue/idempotency tests only ever mint dbo.MemberCredential rows for members this
 * suite owns — never touching the real seeded chapter's 5 members' credential state, which
 * other suites (Digital ID / Credential tests) may care about.
 */

public sealed class IdCardExportDbFixture : IAsyncLifetime
{
    public string? ConnectionString { get; } = ChatDbTestConfig.ConnectionString;

    public int NationalCouncilId { get; private set; }
    public int NationalAdminMemberId { get; private set; }   // ZZTEST-seated CouncilAdmin, scoped to National

    public int NonNationalCouncilAdminMemberId { get; private set; } // AKR-04-0117-004 / HIMAGSIK — Sta. Rosa City Council
    public int RolelessMemberId { get; private set; }               // AKR-04-0117-002 / BAGWIS — no MemberRole at all

    public int TestChapterId { get; private set; }
    public List<int> TestChapterMemberIds { get; } = [];

    public async Task InitializeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        NationalCouncilId = await conn.ExecuteScalarAsync<int>(
            "SELECT CouncilId FROM dbo.Council WHERE CouncilName = N'National Council'");
        NationalCouncilId.Should().NotBe(0, "expected seed data (db/seed/02_demo_chapter.sql) not found");

        NonNationalCouncilAdminMemberId = await conn.ExecuteScalarAsync<int>(
            "SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-004'");
        RolelessMemberId = await conn.ExecuteScalarAsync<int>(
            "SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-002'");

        if (NonNationalCouncilAdminMemberId == 0 || RolelessMemberId == 0)
            throw new InvalidOperationException(
                "Expected seed data (db/seed/02_demo_chapter.sql) not found in the configured database — " +
                "cannot run the ID card export scope suite against it.");

        var councilAdminRoleId = await conn.ExecuteScalarAsync<int>(
            "SELECT RoleId FROM dbo.Role WHERE RoleName = N'CouncilAdmin'");
        var activeStatusId = await conn.ExecuteScalarAsync<int>(
            "SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = N'Active'");

        // --- The National CouncilAdmin this suite needs and the real seed data does not have. ---
        var nationalAdminMemberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        NationalAdminMemberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, HomeCouncilId, AttachReason, MemberNumber, FirstName, LastName, GiftName, StatusId)
            OUTPUT INSERTED.MemberId
            VALUES (NULL, @NationalCouncilId, N'ZZTEST fixture — National CouncilAdmin test double',
                    @nationalAdminMemberNumber, N'ZZTEST', N'ZZTEST', N'ZZTEST-NationalAdmin', @activeStatusId)
            """,
            new { NationalCouncilId, nationalAdminMemberNumber, activeStatusId });

        await conn.ExecuteAsync(
            """
            INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd)
            VALUES (@NationalAdminMemberId, @councilAdminRoleId, 'Council', @NationalCouncilId, '2020-01-01', NULL)
            """,
            new { NationalAdminMemberId, councilAdminRoleId, NationalCouncilId });

        // --- A dedicated chapter+members this suite fully owns, so bulk-issue tests never
        //     touch the real seeded chapter's own member credentials. ---
        TestChapterId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Chapter (ParentCouncilId, ChapterName, Barangay, SuggestedContribution)
            OUTPUT INSERTED.ChapterId
            VALUES (@NationalCouncilId, N'ZZTEST-IdCardExport-Chapter', N'ZZTEST', 0)
            """,
            new { NationalCouncilId });

        for (var i = 0; i < 2; i++)
        {
            var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
            var memberId = await conn.ExecuteScalarAsync<int>(
                """
                INSERT dbo.Member (ChapterId, MemberNumber, FirstName, LastName, GiftName, StatusId)
                OUTPUT INSERTED.MemberId
                VALUES (@TestChapterId, @memberNumber, N'ZZTEST', N'ZZTEST', @giftName, @activeStatusId)
                """,
                new { TestChapterId, memberNumber, giftName = $"ZZTEST-IdCardExport-{i}", activeStatusId });
            TestChapterMemberIds.Add(memberId);
        }
    }

    public async Task DisposeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        await conn.ExecuteAsync(
            """
            DELETE al FROM dbo.AuditLog al
             WHERE al.TableName = 'MemberCredential'
               AND al.RecordId IN (
                   SELECT CAST(CredentialId AS NVARCHAR(40)) FROM dbo.MemberCredential
                   WHERE MemberId IN @AllMemberIds
               );
            DELETE FROM dbo.MemberCredential WHERE MemberId IN @AllMemberIds;
            DELETE FROM dbo.MemberRole WHERE MemberId IN @AllMemberIds;
            DELETE FROM dbo.Member WHERE MemberId IN @AllMemberIds;
            """,
            new { AllMemberIds = TestChapterMemberIds.Append(NationalAdminMemberId).ToArray() });

        await conn.ExecuteAsync("DELETE FROM dbo.Chapter WHERE ChapterId = @TestChapterId", new { TestChapterId });
    }
}

[CollectionDefinition("IdCardExportDb")]
public sealed class IdCardExportDbCollection : ICollectionFixture<IdCardExportDbFixture>;

[Collection("IdCardExportDb")]
public class IdCardExportScopeTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly IdCardExportDbFixture _fx;

    public IdCardExportScopeTests(IdCardExportDbFixture fx) => _fx = fx;

    private static IIdCardExportRepository BuildRepository(string connectionString) =>
        new IdCardExportRepository(new SqlConnectionFactory(connectionString));

    // ---- 1. No CouncilAdmin role at all. ----

    [SkippableFact]
    public async Task Member_with_no_council_role_at_all_cannot_list_the_export()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = BuildRepository(_fx.ConnectionString!);

        var act = async () => await repo.ListForExportAsync(_fx.RolelessMemberId, null, CancellationToken.None);

        var assertion = await act.Should().ThrowAsync<IdCardExportException>(
            "an ordinary member with no CouncilAdmin seat anywhere must never see a single row of " +
            "cross-chapter member data, let alone the full national export");
        assertion.Which.Category.Should().Be(IdCardExportErrorCategory.Forbidden);
    }

    [SkippableFact]
    public async Task Member_with_no_council_role_at_all_cannot_trigger_bulk_credential_issuance()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = BuildRepository(_fx.ConnectionString!);

        var act = async () => await repo.BulkIssueCredentialsAsync(_fx.RolelessMemberId, null, null, CancellationToken.None);

        var assertion = await act.Should().ThrowAsync<IdCardExportException>();
        assertion.Which.Category.Should().Be(IdCardExportErrorCategory.Forbidden);
    }

    // ---- 2. CouncilAdmin, but not seated on the National Council — the actual point of the
    //         feature, the case most likely to regress silently. ----

    [SkippableFact]
    public async Task CouncilAdmin_of_a_non_National_council_cannot_list_the_export()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = BuildRepository(_fx.ConnectionString!);

        // AKR-04-0117-004 genuinely holds CouncilAdmin — just on Sta. Rosa City Council, a
        // City/Municipal-level council, not the National one. A name/role check alone (no
        // ParentCouncilId IS NULL + CouncilLevel.LevelName='National' check) would wrongly let
        // this through.
        var act = async () => await repo.ListForExportAsync(_fx.NonNationalCouncilAdminMemberId, null, CancellationToken.None);

        var assertion = await act.Should().ThrowAsync<IdCardExportException>(
            "a CouncilAdmin seated on any council OTHER than National must be refused — CouncilAdmin " +
            "alone is not the bar this export uses");
        assertion.Which.Category.Should().Be(IdCardExportErrorCategory.Forbidden);
        assertion.Which.Message.Should().Contain("National Council Admin");
    }

    [SkippableFact]
    public async Task CouncilAdmin_of_a_non_National_council_cannot_trigger_bulk_credential_issuance()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = BuildRepository(_fx.ConnectionString!);

        var act = async () => await repo.BulkIssueCredentialsAsync(
            _fx.NonNationalCouncilAdminMemberId, null, null, CancellationToken.None);

        var assertion = await act.Should().ThrowAsync<IdCardExportException>();
        assertion.Which.Category.Should().Be(IdCardExportErrorCategory.Forbidden);
    }

    // ---- 3 & 4. The National CouncilAdmin succeeds, and a repeat call is idempotent. ----

    /// <summary>
    /// The real National CouncilAdmin: bulk-issue then list, scoped to this suite's own
    /// dedicated chapter only. Proves the happy path actually returns real member rows (the
    /// data an endpoint caller would zip up) — and proves idempotency at both the repository's
    /// own return value AND the underlying table, so a bug that returns "0 issued" while
    /// silently inserting a duplicate row could never hide behind the repository's own count.
    /// </summary>
    [SkippableFact]
    public async Task National_CouncilAdmin_bulk_issues_once_then_a_repeat_call_issues_nothing_new()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();
        var repo = BuildRepository(_fx.ConnectionString!);

        // Before any bulk-issue: no credential exists yet, so TokenSubject must come back null.
        var before = await repo.ListForExportAsync(_fx.NationalAdminMemberId, _fx.TestChapterId, CancellationToken.None);
        before.Should().HaveCount(_fx.TestChapterMemberIds.Count);
        before.Should().OnlyContain(m => m.TokenSubject == null);

        var firstIssued = await repo.BulkIssueCredentialsAsync(
            _fx.NationalAdminMemberId, _fx.TestChapterId, null, CancellationToken.None);
        firstIssued.Should().Be(_fx.TestChapterMemberIds.Count,
            "every in-scope member started with no live credential, so all of them should get one");

        var afterFirst = await repo.ListForExportAsync(_fx.NationalAdminMemberId, _fx.TestChapterId, CancellationToken.None);
        afterFirst.Should().OnlyContain(m => m.TokenSubject != null,
            "the caller is required to bulk-issue before listing — every row must now carry a live TokenSubject");

        var secondIssued = await repo.BulkIssueCredentialsAsync(
            _fx.NationalAdminMemberId, _fx.TestChapterId, null, CancellationToken.None);
        secondIssued.Should().Be(0, "a repeat call for members already covered must issue nothing new");

        // Not just the repository's own return value — the table itself must not have grown.
        var rowCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.MemberCredential WHERE MemberId IN @ids",
            new { ids = _fx.TestChapterMemberIds });
        rowCount.Should().Be(_fx.TestChapterMemberIds.Count,
            "exactly one credential per member — a second bulk-issue call must not have minted a competing one");

        // And the TokenSubject a second List call returns must be the SAME one issued the
        // first time — no member's card-facing QR silently changed underneath him.
        var afterSecond = await repo.ListForExportAsync(_fx.NationalAdminMemberId, _fx.TestChapterId, CancellationToken.None);
        afterSecond.OrderBy(m => m.MemberId).Select(m => m.TokenSubject)
            .Should().Equal(afterFirst.OrderBy(m => m.MemberId).Select(m => m.TokenSubject));
    }

    /// <summary>
    /// FIXED, not just flagged, as of UX_MemberCredential_Member_Live
    /// (db/schema/05_identity_renewal.sql) — a filtered unique index on
    /// MemberCredential(MemberId) WHERE RevokedDate IS NULL. Originally this test proved the
    /// opposite (two live rows for one member silently fanning out through the export's LEFT
    /// JOIN); now it proves the database itself refuses to get into that state at all, even
    /// when something bypasses both issuing procs' own UPDLOCK/HOLDLOCK checks entirely —
    /// a stronger guarantee than "the two procs we know about are careful."
    ///
    /// This also means every path that mints a MemberCredential row must first revoke any
    /// existing RevokedDate-IS-NULL row for that member, expired-but-never-revoked ones
    /// included — see usp_Credential_GetOrIssueForSelf's and
    /// usp_Credential_BulkIssueForExport's own "supersede a stale row" comments for why
    /// "not yet revoked" and "not yet expired" had to be reconciled into one rule for this
    /// index to be correct rather than a footgun (it would otherwise block re-issuance
    /// forever after a credential's first natural expiry).
    /// </summary>
    [SkippableFact]
    public async Task SecondLiveCredentialForSameMember_IsRejectedByTheDatabase()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var targetMemberId = _fx.TestChapterMemberIds[0];
        var expiry = DateTime.UtcNow.AddYears(1);

        // Other tests sharing this fixture may or may not have already issued this member a
        // credential (xUnit gives no ordering guarantee within the class) — capture whatever
        // the count is now rather than assuming zero, so this test is order-independent.
        const string LiveCountSql =
            "SELECT COUNT(*) FROM dbo.MemberCredential WHERE MemberId = @targetMemberId AND RevokedDate IS NULL";
        var liveCountBefore = await conn.ExecuteScalarAsync<int>(LiveCountSql, new { targetMemberId });

        // Same bypass-both-procs attempt the old (pre-fix) version of this test used to prove
        // the bug with — now it must fail at the INSERT itself, not quietly succeed.
        Func<Task> secondLiveInsert = async () => await conn.ExecuteAsync(
            """
            INSERT dbo.MemberCredential (MemberId, ExpiryDate)
            VALUES (@targetMemberId, @expiry), (@targetMemberId, @expiry)
            """,
            new { targetMemberId, expiry });

        await secondLiveInsert.Should().ThrowAsync<SqlException>(
            "UX_MemberCredential_Member_Live must reject a second RevokedDate-IS-NULL row " +
            "for the same member, regardless of which code path attempted it");

        // The failed batch must not have left a partial row behind, nor changed anything else.
        var liveCountAfter = await conn.ExecuteScalarAsync<int>(LiveCountSql, new { targetMemberId });
        liveCountAfter.Should().Be(liveCountBefore,
            "a rejected batch insert must not partially apply — the live-row count for this " +
            "member should be exactly what it was before the attempt");
    }

    /// <summary>
    /// A member with no uploaded photo (every ZZTEST member this suite creates — none are
    /// given a PhotoPath) comes back with PhotoPath/PhotoContentType both null, not an
    /// exception and not an empty string standing in for "no photo". This is the repository/DTO
    /// half of "a member with no photo doesn't break the export"; IdCardExportZipBuildingTests
    /// covers the other half (the resulting ZIP has no file, and no error, for that row).
    /// </summary>
    [SkippableFact]
    public async Task Member_with_no_uploaded_photo_lists_cleanly_with_a_null_PhotoPath()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = BuildRepository(_fx.ConnectionString!);

        var rows = await repo.ListForExportAsync(_fx.NationalAdminMemberId, _fx.TestChapterId, CancellationToken.None);

        rows.Should().HaveCount(_fx.TestChapterMemberIds.Count);
        rows.Should().OnlyContain(m => m.PhotoPath == null && m.PhotoContentType == null);
    }

    [SkippableFact]
    public async Task National_CouncilAdmin_list_is_scoped_by_chapterId_when_one_is_supplied()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = BuildRepository(_fx.ConnectionString!);

        var rows = await repo.ListForExportAsync(_fx.NationalAdminMemberId, _fx.TestChapterId, CancellationToken.None);

        rows.Should().NotBeEmpty();
        rows.Should().OnlyContain(m => m.ChapterId == _fx.TestChapterId,
            "an explicit chapterId filter must exclude every other chapter's members, even for a " +
            "National CouncilAdmin whose seat itself covers the whole tree");
    }
}
