using Akrho.Infrastructure;
using Akrho.Infrastructure.Repositories;
using Dapper;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Akrho.Tests;

/*
 * Regression coverage for the usp_Member_Search fix (Council Statistics module, task 6):
 * a detached member (Member.HomeCouncilId set, ChapterId NULL — CLAUDE.md invariant #14,
 * e.g. a council officer whose own chapter went dormant) is a real, expected caller. Before
 * the fix, the procedure's opening "SELECT @CallerChapterId ... IF @CallerChapterId IS NULL
 * THROW 51010" treated that NULL exactly like a nonexistent member, so this caller got an
 * unhandled SqlException (surfaced to the client as a bare 500) the moment he tried the new
 * statistics screen's chapter-to-member drill-down. Only a genuinely unknown
 * @RequestingMemberId (no Member row at all) should still throw 51010.
 *
 * DB-backed, same connection-resolution/skip convention as ChatModuleIntegrationTests.cs's
 * own header comment — reuses that file's ChatDbTestConfig instead of duplicating it. Goes
 * through the real IMemberRepository/MemberRepository, never mocked, because the procedure
 * IS the boundary being fixed here.
 */
public sealed class MemberSearchDetachedCallerFixture : IAsyncLifetime
{
    public string? ConnectionString { get; } = ChatDbTestConfig.ConnectionString;

    public int ChapterAId { get; private set; }
    public int ChapterAOfficerId { get; private set; }   // AKR-04-0117-001 (TANGLAW) — ordinary same-chapter caller
    public int DetachedMemberId { get; private set; }    // ZZTEST-, HomeCouncilId set, ChapterId NULL

    public async Task InitializeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        ChapterAId = await conn.ExecuteScalarAsync<int>(
            "SELECT ChapterId FROM dbo.Chapter WHERE ChapterName = N'Brgy. San Isidro Chapter'");
        ChapterAOfficerId = await conn.ExecuteScalarAsync<int>(
            "SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-001'");

        if (ChapterAId == 0 || ChapterAOfficerId == 0)
            throw new InvalidOperationException(
                "Expected seed data (db/seed/02_demo_chapter.sql) not found in the configured database — " +
                "cannot run the detached-caller regression test against it.");

        var parentCouncilId = await conn.ExecuteScalarAsync<int>(
            "SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterAId", new { ChapterAId });
        var activeStatusId = await conn.ExecuteScalarAsync<int>(
            "SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = N'Active'");

        var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        DetachedMemberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, HomeCouncilId, AttachReason, MemberNumber, FirstName, LastName, GiftName, StatusId)
            OUTPUT INSERTED.MemberId
            VALUES (NULL, @parentCouncilId, N'ZZTEST-detached-for-regression', @memberNumber, N'ZZTEST', N'ZZTEST', N'ZZTEST-Detached', @activeStatusId)
            """,
            new { parentCouncilId, memberNumber, activeStatusId });
    }

    public async Task DisposeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();
        await conn.ExecuteAsync("DELETE FROM dbo.Member WHERE MemberId = @DetachedMemberId", new { DetachedMemberId });
    }
}

[CollectionDefinition("MemberSearchDetachedCallerDb")]
public sealed class MemberSearchDetachedCallerCollection : ICollectionFixture<MemberSearchDetachedCallerFixture>;

[Collection("MemberSearchDetachedCallerDb")]
public class MemberSearchDetachedCallerTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly MemberSearchDetachedCallerFixture _fx;

    public MemberSearchDetachedCallerTests(MemberSearchDetachedCallerFixture fx)
    {
        _fx = fx;
    }

    /// <summary>(a) Existing same-chapter behavior must be byte-identical to before the fix —
    /// the change only touches how a NULL @CallerChapterId is handled, never the
    /// @CallerChapterId IS NOT NULL path.</summary>
    [SkippableFact]
    public async Task Ordinary_same_chapter_caller_behavior_is_unchanged()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);

        var repo = new MemberRepository(new SqlConnectionFactory(_fx.ConnectionString!));
        var rows = await repo.SearchAsync(
            _fx.ChapterAOfficerId, _fx.ChapterAId, search: null, bloodTypeId: null,
            skillId: null, includeInactive: true, statusId: null, skip: 0, take: 50, CancellationToken.None);

        rows.Should().NotBeEmpty();
        rows.Should().OnlyContain(r => r.IsSameChapter);
        // Same-chapter shape still carries the restricted fields — proves the fix did not
        // touch @SameChapter = 1 behavior at all.
        rows.Should().OnlyContain(r => r.FirstName != null && r.LastName != null);
    }

    /// <summary>(b) A detached member (council-homed, no chapter) calling this now gets the
    /// restricted cross-chapter shape instead of a 500.</summary>
    [SkippableFact]
    public async Task Detached_council_homed_caller_gets_restricted_shape_not_a_500()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);

        var repo = new MemberRepository(new SqlConnectionFactory(_fx.ConnectionString!));

        // Before the fix this threw 51010 ("Unknown requesting member") for a detached
        // caller purely because his own ChapterId is NULL — the old code conflated "no
        // chapter of his own" with "no such member." A real, existing detached member must
        // now succeed, with @SameChapter = 0 for every row (CLAUDE.md invariant #14: he is
        // never "same chapter" as anything, having none of his own).
        var act = async () => await repo.SearchAsync(
            _fx.DetachedMemberId, _fx.ChapterAId, search: null, bloodTypeId: null,
            skillId: null, includeInactive: true, statusId: null, skip: 0, take: 50, CancellationToken.None);

        var result = await act.Should().NotThrowAsync();
        result.Subject.Should().NotBeEmpty();
        result.Subject.Should().OnlyContain(r => !r.IsSameChapter);
        // Restricted (cross-chapter) shape — name/contact fields NULL, only gift name/
        // chapter/status ever exposed (CLAUDE.md invariant #7).
        result.Subject.Should().OnlyContain(r => r.FirstName == null && r.LastName == null && r.MobileNo == null);
    }

    /// <summary>A genuinely unknown/nonexistent @RequestingMemberId must still throw 51010 —
    /// the fix narrows the THROW condition, it does not remove it.</summary>
    [SkippableFact]
    public async Task Genuinely_unknown_requesting_member_still_throws_51010()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);

        var repo = new MemberRepository(new SqlConnectionFactory(_fx.ConnectionString!));

        var act = async () => await repo.SearchAsync(
            requestingMemberId: -999999, _fx.ChapterAId, search: null, bloodTypeId: null,
            skillId: null, includeInactive: true, statusId: null, skip: 0, take: 50, CancellationToken.None);

        (await act.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(51010);
    }
}
