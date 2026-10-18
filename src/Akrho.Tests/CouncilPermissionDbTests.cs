using System.Data;
using Dapper;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Akrho.Tests;

/*
 * Phase 1 "dynamic council office permissions" — DB-backed suite. WRITTEN BUT NOT RUN in
 * this sandbox (CLAUDE.md §10: the shared dev DB at corex.itcoreapps.com is also staging's
 * LIVE database, and db/schema/28_council_permissions.sql is not deployed there yet — the
 * agent that produced this file was explicitly forbidden from running anything that opens a
 * database connection). They follow ChapterRegistrationApprovalControlTests' own fixture
 * idiom exactly: no transaction wrapping, every test seeds its own ZZTEST-marked rows
 * through the REAL stored procedures wherever the proc under test allows it, and cleans up
 * in a finally block / the shared fixture's DisposeAsync. SkippableFact reports a real
 * "Skipped" result (not a false "Passed") when no connection string is configured — the same
 * posture every other DB-backed suite in this project already uses.
 *
 * Deliberate exception to invariant #15 ("councils are never deleted"): that invariant
 * protects real governance history. The two ZZTEST councils created by this fixture never
 * carry a real renewal/receipt/membership record — they exist only for the lifetime of a
 * test run, exactly like ChapterRegistrationStructuralInvariantTests' own throwaway ZZTEST
 * chapter/member rows, and this fixture hard-deletes them in DisposeAsync for the same
 * reason those tests hard-delete their own fixtures: leaving a permanent ZZTEST council
 * behind on a SHARED dev database after every test run is a worse outcome than relaxing the
 * no-delete rule for data that was never real in the first place.
 */

public sealed class CouncilPermissionDbFixture : IAsyncLifetime
{
    public string? ConnectionString { get; } = ChapterRegistrationTestDbConfig.ConnectionString;

    /// <summary>A throwaway Provincial-level council, parented under the real seeded
    /// "Region IV-A CALABARZON" council (db/seed/02_demo_chapter.sql) — stands in as "the
    /// parent" for the parent-cannot-edit-child and scope-escapes-upward tests.</summary>
    public int TestProvinceCouncilId { get; private set; }

    /// <summary>Two sibling City/Municipal-level councils under <see cref="TestProvinceCouncilId"/> —
    /// A is where most single-council scenarios run; B exists purely as "outside A's own
    /// subtree" for the scope tests.</summary>
    public int TestCityACouncilId { get; private set; }
    public int TestCityBCouncilId { get; private set; }

    public int PresidentOfficeId { get; private set; }
    public int SecretaryOfficeId { get; private set; }
    public int TreasurerOfficeId { get; private set; }
    public int VicePresidentOfficeId { get; private set; }
    public int AuditorOfficeId { get; private set; }
    public int PioOfficeId { get; private set; }

    public int CouncilAdminRoleId { get; private set; }
    public int CouncilSecretaryRoleId { get; private set; }
    public int CouncilTreasurerRoleId { get; private set; }
    public int CouncilOfficerRoleId { get; private set; } // Vice President
    public int CouncilAuditorRoleId { get; private set; }
    public int CouncilPioRoleId { get; private set; }

    private readonly List<int> _createdMemberIds = [];

    public async Task InitializeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        var regionCouncilId = await conn.ExecuteScalarAsync<int>(
            "SELECT CouncilId FROM dbo.Council WHERE CouncilName = N'Region IV-A CALABARZON'");
        regionCouncilId.Should().NotBe(0, "expected seed data (db/seed/02_demo_chapter.sql) not found");

        var provincialLevelId = await conn.ExecuteScalarAsync<int>(
            "SELECT CouncilLevelId FROM dbo.CouncilLevel WHERE LevelName = N'Provincial'");
        var cityLevelId = await conn.ExecuteScalarAsync<int>(
            "SELECT CouncilLevelId FROM dbo.CouncilLevel WHERE LevelName = N'City/Municipal'");

        var marker = "ZZTEST-CouncilPermission-" + Guid.NewGuid().ToString("N")[..8];

        TestProvinceCouncilId = await conn.ExecuteScalarAsync<int>(
            "INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName) OUTPUT INSERTED.CouncilId " +
            "VALUES (@regionCouncilId, @provincialLevelId, @name)",
            new { regionCouncilId, provincialLevelId, name = $"{marker}-Province" });

        TestCityACouncilId = await conn.ExecuteScalarAsync<int>(
            "INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName) OUTPUT INSERTED.CouncilId " +
            "VALUES (@p, @cityLevelId, @name)",
            new { p = TestProvinceCouncilId, cityLevelId, name = $"{marker}-CityA" });

        TestCityBCouncilId = await conn.ExecuteScalarAsync<int>(
            "INSERT dbo.Council (ParentCouncilId, CouncilLevelId, CouncilName) OUTPUT INSERTED.CouncilId " +
            "VALUES (@p, @cityLevelId, @name)",
            new { p = TestProvinceCouncilId, cityLevelId, name = $"{marker}-CityB" });

        var offices = (await conn.QueryAsync<(int CouncilOfficeId, string OfficeName, int RoleId)>(
            "SELECT CouncilOfficeId, OfficeName, RoleId FROM dbo.CouncilOffice")).ToList();

        PresidentOfficeId = offices.Single(o => o.OfficeName == "President").CouncilOfficeId;
        SecretaryOfficeId = offices.Single(o => o.OfficeName == "Secretary").CouncilOfficeId;
        TreasurerOfficeId = offices.Single(o => o.OfficeName == "Treasurer").CouncilOfficeId;
        VicePresidentOfficeId = offices.Single(o => o.OfficeName == "Vice President").CouncilOfficeId;
        AuditorOfficeId = offices.Single(o => o.OfficeName == "Auditor").CouncilOfficeId;
        PioOfficeId = offices.Single(o => o.OfficeName == "Public Information Officer").CouncilOfficeId;

        CouncilAdminRoleId = offices.Single(o => o.OfficeName == "President").RoleId;
        CouncilSecretaryRoleId = offices.Single(o => o.OfficeName == "Secretary").RoleId;
        CouncilTreasurerRoleId = offices.Single(o => o.OfficeName == "Treasurer").RoleId;
        CouncilOfficerRoleId = offices.Single(o => o.OfficeName == "Vice President").RoleId;
        CouncilAuditorRoleId = offices.Single(o => o.OfficeName == "Auditor").RoleId;
        CouncilPioRoleId = offices.Single(o => o.OfficeName == "Public Information Officer").RoleId;
    }

    /// <summary>Seats a brand-new ZZTEST member on <paramref name="councilId"/> in
    /// <paramref name="officeId"/>, dated from 2020-01-01 with no TermEnd (live). When
    /// <paramref name="setCouncilOfficeId"/> is false, MemberRole.CouncilOfficeId is left
    /// NULL deliberately — exercising fn_MemberSeatPermissions' own RoleId fallback
    /// resolution, the same path every seat seeded before this module existed relies on.</summary>
    public async Task<int> SeatOfficerAsync(
        SqlConnection conn, int councilId, int officeId, int roleId, string giftNameSuffix, bool setCouncilOfficeId = true)
    {
        var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        var memberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, HomeCouncilId, AttachReason, MemberNumber, FirstName, LastName, GiftName, StatusId)
            OUTPUT INSERTED.MemberId
            SELECT NULL, @councilId, N'ZZTEST fixture — CouncilPermission test double', @memberNumber,
                   N'ZZTEST', N'ZZTEST', @giftName, StatusId
            FROM dbo.MemberStatus WHERE StatusName = N'Active'
            """,
            new { councilId, memberNumber, giftName = "ZZTEST-CouncilPermission-" + giftNameSuffix });

        await conn.ExecuteAsync(
            """
            INSERT dbo.MemberRole (MemberId, RoleId, ScopeType, ScopeId, TermStart, TermEnd, CouncilOfficeId)
            VALUES (@memberId, @roleId, 'Council', @councilId, '2020-01-01', NULL, @councilOfficeId)
            """,
            new { memberId, roleId, councilId, councilOfficeId = setCouncilOfficeId ? officeId : (int?)null });

        _createdMemberIds.Add(memberId);
        return memberId;
    }

    public async Task DisposeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        var councilIds = new[] { TestCityACouncilId, TestCityBCouncilId, TestProvinceCouncilId };

        await conn.ExecuteAsync(
            "DELETE FROM dbo.CouncilOfficePermissionHistory WHERE CouncilId IN @councilIds;" +
            "DELETE FROM dbo.CouncilOfficePermission WHERE CouncilId IN @councilIds;" +
            "DELETE FROM dbo.AuditLog WHERE TableName = 'CouncilOfficePermission' AND " +
            "   (RecordId LIKE @cityAPrefix OR RecordId LIKE @cityBPrefix OR RecordId LIKE @provincePrefix);",
            new
            {
                councilIds,
                cityAPrefix = $"{TestCityACouncilId}:%",
                cityBPrefix = $"{TestCityBCouncilId}:%",
                provincePrefix = $"{TestProvinceCouncilId}:%",
            });

        if (_createdMemberIds.Count > 0)
        {
            await conn.ExecuteAsync(
                "DELETE FROM dbo.MemberRole WHERE MemberId IN @ids; DELETE FROM dbo.Member WHERE MemberId IN @ids;",
                new { ids = _createdMemberIds });
        }

        await conn.ExecuteAsync(
            "DELETE FROM dbo.Council WHERE CouncilId IN @councilIds",
            new { councilIds });
    }
}

[CollectionDefinition("CouncilPermission")]
public sealed class CouncilPermissionDbCollection : ICollectionFixture<CouncilPermissionDbFixture>;

/// <summary>Defaults parity: a council with zero override rows must behave IDENTICALLY to
/// dbo.CouncilPermissionDefault's own seed, for every (office, key) pair — and a seat whose
/// MemberRole.CouncilOfficeId is NULL must resolve through dbo.CouncilOffice.RoleId.</summary>
[Collection("CouncilPermission")]
public class CouncilPermissionDefaultsDbTests(CouncilPermissionDbFixture fx)
{
    private const string NoDbSkipReason = "no shared dev DB connection string configured";

    [SkippableFact]
    public async Task Fresh_council_with_zero_overrides_matches_CouncilPermissionDefault_exactly()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var effective = (await conn.QueryAsync<(int CouncilOfficeId, string PermissionKey, bool IsGranted, bool IsDefault)>(
            "SELECT CouncilOfficeId, PermissionKey, IsGranted, IsDefault FROM dbo.fn_CouncilEffectivePermissions(@councilId)",
            new { councilId = fx.TestCityACouncilId })).ToList();

        // Every cell must report IsDefault=1 — nothing has been overridden yet.
        effective.Should().OnlyContain(c => c.IsDefault);

        var expectedDefaults = (await conn.QueryAsync<(int CouncilOfficeId, string PermissionKey)>(
            "SELECT CouncilOfficeId, PermissionKey FROM dbo.CouncilPermissionDefault")).ToHashSet();

        foreach (var cell in effective)
        {
            var expectedGranted = expectedDefaults.Contains((cell.CouncilOfficeId, cell.PermissionKey))
                                   || cell.CouncilOfficeId == fx.PresidentOfficeId; // presiding lock always wins
            cell.IsGranted.Should().Be(expectedGranted,
                $"office {cell.CouncilOfficeId} / key {cell.PermissionKey} should reproduce the catalog default exactly");
        }
    }

    [SkippableFact]
    public async Task NULL_CouncilOfficeId_seat_resolves_the_offices_permissions_via_RoleId()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        // Seat a Secretary with NO CouncilOfficeId set — exactly the shape every pre-module
        // seat (and several xUnit fixtures) leaves behind.
        var secretaryMemberId = await fx.SeatOfficerAsync(
            conn, fx.TestCityACouncilId, fx.SecretaryOfficeId, fx.CouncilSecretaryRoleId, "NullOfficeIdSecretary", setCouncilOfficeId: false);

        var keys = (await conn.QueryAsync<string>(
            "SELECT PermissionKey FROM dbo.fn_MemberSeatPermissions(@memberId) WHERE CouncilId = @councilId",
            new { memberId = secretaryMemberId, councilId = fx.TestCityACouncilId })).ToHashSet();

        keys.Should().BeEquivalentTo([
            "ChapterRegistration.Review", "ChapterRegistration.Verify", "ChapterRegistration.Approve",
            "ChapterRegistration.Return", "CouncilStatistics.Read", "CouncilMemberSearch.Read"
        ], "the NULL-CouncilOfficeId fallback must resolve this seat to the Secretary office by RoleId alone");
    }
}

/// <summary>An office seeded IsReadOnly=1 can never actually hold a write permission — not
/// through usp_CouncilPermission_Set (rejected, 51934), and not even through a hand-inserted
/// override row that bypasses the procedure entirely (fn_CouncilEffectivePermissions' own
/// lock still wins).</summary>
[Collection("CouncilPermission")]
public class CouncilPermissionAuditorGuardrailDbTests(CouncilPermissionDbFixture fx)
{
    private const string NoDbSkipReason = "no shared dev DB connection string configured";

    private static DataTable ChangeTable(params (int OfficeId, string Key, bool Granted)[] changes)
    {
        var table = new DataTable();
        table.Columns.Add("CouncilOfficeId", typeof(int));
        table.Columns.Add("PermissionKey", typeof(string));
        table.Columns.Add("IsGranted", typeof(bool));
        foreach (var c in changes) table.Rows.Add(c.OfficeId, c.Key, c.Granted);
        return table;
    }

    [SkippableFact]
    public async Task Set_rejects_granting_a_write_key_to_the_read_only_Auditor_office()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var presidentId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "AuditorGuardPresident");

        var act = async () => await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_CouncilPermission_Set",
            new
            {
                RequestingMemberId = presidentId,
                CouncilId = fx.TestCityACouncilId,
                Changes = ChangeTable((fx.AuditorOfficeId, "ChapterRegistration.Approve", true))
                    .AsTableValuedParameter("dbo.CouncilPermissionChangeRow"),
                Reason = (string?)null,
            },
            commandType: CommandType.StoredProcedure));

        var assertion = await act.Should().ThrowAsync<SqlException>();
        assertion.Which.Number.Should().Be(51934);
    }

    [SkippableFact]
    public async Task Hand_inserted_override_granting_Auditor_Approve_still_resolves_to_0_and_Approve_still_rejects_him()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var presidentId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "AuditorGuardPresident2");
        var auditorId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.AuditorOfficeId, fx.CouncilAuditorRoleId, "AuditorGuardAuditor");

        try
        {
            // Bypass usp_CouncilPermission_Set entirely — a direct INSERT, exactly the kind of
            // "what if someone writes around the procedure" scenario fn_CouncilEffectivePermissions'
            // own lock exists to defend against.
            await conn.ExecuteAsync(
                """
                INSERT dbo.CouncilOfficePermission (CouncilId, CouncilOfficeId, PermissionKey, IsGranted, ChangedBy)
                VALUES (@councilId, @officeId, N'ChapterRegistration.Approve', 1, @presidentId)
                """,
                new { councilId = fx.TestCityACouncilId, officeId = fx.AuditorOfficeId, presidentId });

            var isGranted = await conn.ExecuteScalarAsync<bool>(
                "SELECT IsGranted FROM dbo.fn_CouncilEffectivePermissions(@councilId) WHERE CouncilOfficeId = @officeId AND PermissionKey = N'ChapterRegistration.Approve'",
                new { councilId = fx.TestCityACouncilId, officeId = fx.AuditorOfficeId });
            isGranted.Should().BeFalse("the read-only/write lock must outrank even a hand-inserted override row");

            var holdsIt = await conn.ExecuteScalarAsync<bool>(
                "SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.fn_MemberSeatPermissions(@memberId) WHERE CouncilId = @councilId AND PermissionKey = N'ChapterRegistration.Approve') THEN 1 ELSE 0 END AS BIT)",
                new { memberId = auditorId, councilId = fx.TestCityACouncilId });
            holdsIt.Should().BeFalse("the auditor must never actually hold Approve, override row notwithstanding");
        }
        finally
        {
            await conn.ExecuteAsync(
                "DELETE FROM dbo.CouncilOfficePermission WHERE CouncilId = @councilId AND CouncilOfficeId = @officeId AND PermissionKey = N'ChapterRegistration.Approve'",
                new { councilId = fx.TestCityACouncilId, officeId = fx.AuditorOfficeId });
        }
    }
}

/// <summary>Only a council's own currently-seated President may edit ITS OWN grid — never a
/// parent's President, never any other office, and never the presiding office's own row.</summary>
[Collection("CouncilPermission")]
public class CouncilPermissionEditAuthorityDbTests(CouncilPermissionDbFixture fx)
{
    private const string NoDbSkipReason = "no shared dev DB connection string configured";

    private static DataTable ChangeTable(params (int OfficeId, string Key, bool Granted)[] changes)
    {
        var table = new DataTable();
        table.Columns.Add("CouncilOfficeId", typeof(int));
        table.Columns.Add("PermissionKey", typeof(string));
        table.Columns.Add("IsGranted", typeof(bool));
        foreach (var c in changes) table.Rows.Add(c.OfficeId, c.Key, c.Granted);
        return table;
    }

    private static Task<int> SetAsync(SqlConnection conn, int requestingMemberId, int councilId, DataTable changes) =>
        conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "dbo.usp_CouncilPermission_Set",
            new
            {
                RequestingMemberId = requestingMemberId,
                CouncilId = councilId,
                Changes = changes.AsTableValuedParameter("dbo.CouncilPermissionChangeRow"),
                Reason = (string?)null,
            },
            commandType: CommandType.StoredProcedure));

    [SkippableFact]
    public async Task Secretary_cannot_edit_the_grid_51931()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var secretaryId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.SecretaryOfficeId, fx.CouncilSecretaryRoleId, "EditAuthoritySecretary");

        var act = async () => await SetAsync(conn, secretaryId, fx.TestCityACouncilId,
            ChangeTable((fx.TreasurerOfficeId, "CouncilStatistics.Read", true)));

        var assertion = await act.Should().ThrowAsync<SqlException>();
        assertion.Which.Number.Should().Be(51931);
    }

    [SkippableFact]
    public async Task Parent_councils_President_cannot_edit_a_childs_grid_51931()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var parentPresidentId = await fx.SeatOfficerAsync(conn, fx.TestProvinceCouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "EditAuthorityParentPresident");

        var act = async () => await SetAsync(conn, parentPresidentId, fx.TestCityACouncilId,
            ChangeTable((fx.TreasurerOfficeId, "CouncilStatistics.Read", true)));

        var assertion = await act.Should().ThrowAsync<SqlException>();
        assertion.Which.Number.Should().Be(51931,
            "a parent council's own President has no standing seat on the CHILD council itself");
    }

    [SkippableFact]
    public async Task Targeting_the_presiding_office_row_is_rejected_51933()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var presidentId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "EditAuthorityPresident1");

        var act = async () => await SetAsync(conn, presidentId, fx.TestCityACouncilId,
            ChangeTable((fx.PresidentOfficeId, "CouncilStatistics.Read", false)));

        var assertion = await act.Should().ThrowAsync<SqlException>();
        assertion.Which.Number.Should().Be(51933);
    }

    [SkippableFact]
    public async Task Granting_Approve_without_Review_in_the_same_batch_is_rejected_51936()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var presidentId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "EditAuthorityPresident2");

        // Treasurer holds no ChapterRegistration.* key by default — granting Approve alone,
        // with Review left ungranted, must fail the resulting-state RequiresKey check.
        var act = async () => await SetAsync(conn, presidentId, fx.TestCityACouncilId,
            ChangeTable((fx.TreasurerOfficeId, "ChapterRegistration.Approve", true)));

        var assertion = await act.Should().ThrowAsync<SqlException>();
        assertion.Which.Number.Should().Be(51936);
    }

    [SkippableFact]
    public async Task A_rejected_batch_writes_no_history_and_no_audit_row_even_for_the_valid_change_in_it()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var presidentId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "EditAuthorityPresident3");

        var historyCountBefore = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.CouncilOfficePermissionHistory WHERE CouncilId = @councilId",
            new { councilId = fx.TestCityACouncilId });

        // One perfectly valid change (Treasurer gaining CouncilStatistics.Read, which has no
        // RequiresKey dependency) bundled with one invalid change (Approve without Review) in
        // the SAME @Changes TVP — the whole batch must be rejected together, atomically.
        var act = async () => await SetAsync(conn, presidentId, fx.TestCityACouncilId,
            ChangeTable(
                (fx.TreasurerOfficeId, "CouncilStatistics.Read", true),
                (fx.TreasurerOfficeId, "ChapterRegistration.Approve", true)));

        await act.Should().ThrowAsync<SqlException>();

        var historyCountAfter = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.CouncilOfficePermissionHistory WHERE CouncilId = @councilId",
            new { councilId = fx.TestCityACouncilId });
        historyCountAfter.Should().Be(historyCountBefore, "no history row may be written for ANY cell in a batch that ultimately fails");

        var stillDefault = await conn.ExecuteScalarAsync<bool>(
            "SELECT IsDefault FROM dbo.fn_CouncilEffectivePermissions(@councilId) WHERE CouncilOfficeId = @officeId AND PermissionKey = N'CouncilStatistics.Read'",
            new { councilId = fx.TestCityACouncilId, officeId = fx.TreasurerOfficeId });
        stillDefault.Should().BeTrue("the valid half of a rejected batch must not have been applied either");
    }
}

/// <summary>A permission granted on one council only ever widens that council's OWN subtree
/// visibility — never a sibling's, never an ancestor's.</summary>
[Collection("CouncilPermission")]
public class CouncilPermissionScopeDbTests(CouncilPermissionDbFixture fx)
{
    private const string NoDbSkipReason = "no shared dev DB connection string configured";

    [SkippableFact]
    public async Task VP_granted_Statistics_Read_on_CityA_sees_CityAs_own_subtree_but_not_CityB_or_the_parent_Province()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var presidentId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "ScopePresident");
        var vpId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.VicePresidentOfficeId, fx.CouncilOfficerRoleId, "ScopeVP");

        var table = new DataTable();
        table.Columns.Add("CouncilOfficeId", typeof(int));
        table.Columns.Add("PermissionKey", typeof(string));
        table.Columns.Add("IsGranted", typeof(bool));
        table.Rows.Add(fx.VicePresidentOfficeId, "CouncilStatistics.Read", true);

        // Vice President already grants CouncilMemberSearch.Read by default, but NOT
        // CouncilStatistics.Read — this is a genuine override, not a no-op.
        await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_CouncilPermission_Set",
            new
            {
                RequestingMemberId = presidentId,
                CouncilId = fx.TestCityACouncilId,
                Changes = table.AsTableValuedParameter("dbo.CouncilPermissionChangeRow"),
                Reason = (string?)null,
            },
            commandType: CommandType.StoredProcedure));

        var today = DateTime.UtcNow.Date;

        // Own subtree: succeeds.
        var ownAct = async () => await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_CouncilStatistics_Get",
            new { RequestingMemberId = vpId, FocusCouncilId = fx.TestCityACouncilId, FromDate = today.AddDays(-30), ToDate = today },
            commandType: CommandType.StoredProcedure));
        await ownAct.Should().NotThrowAsync();

        // Sibling council: outside scope.
        var siblingAct = async () => await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_CouncilStatistics_Get",
            new { RequestingMemberId = vpId, FocusCouncilId = fx.TestCityBCouncilId, FromDate = today.AddDays(-30), ToDate = today },
            commandType: CommandType.StoredProcedure));
        var siblingAssertion = await siblingAct.Should().ThrowAsync<SqlException>();
        siblingAssertion.Which.Number.Should().Be(51621);

        // Parent council: also outside scope — a grant on CityA never reaches upward.
        var parentAct = async () => await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_CouncilStatistics_Get",
            new { RequestingMemberId = vpId, FocusCouncilId = fx.TestProvinceCouncilId, FromDate = today.AddDays(-30), ToDate = today },
            commandType: CommandType.StoredProcedure));
        var parentAssertion = await parentAct.Should().ThrowAsync<SqlException>();
        parentAssertion.Which.Number.Should().Be(51621);
    }
}

/// <summary>A revoked permission takes effect on the very next call — there is no cache,
/// no session-lifetime grant, nothing to invalidate.</summary>
[Collection("CouncilPermission")]
public class CouncilPermissionImmediacyDbTests(CouncilPermissionDbFixture fx)
{
    private const string NoDbSkipReason = "no shared dev DB connection string configured";

    [SkippableFact]
    public async Task Revoking_Secretarys_Verify_makes_the_very_next_VerifyOfficer_call_throw_51542()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var presidentId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "ImmediacyPresident");
        var secretaryId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.SecretaryOfficeId, fx.CouncilSecretaryRoleId, "ImmediacySecretary");

        var (registrationId, _, marker, _) = await ChapterRegistrationTestHelpers.InsertCharterRegistrationDirectAsync(
            conn, fx.TestCityACouncilId, verifiedCount: 0, verifiedBy: null);
        var officerRowId = await conn.ExecuteScalarAsync<int>(
            "SELECT TOP (1) RegistrationOfficerId FROM dbo.ChapterRegistrationOfficer WHERE RegistrationId = @registrationId",
            new { registrationId });

        try
        {
            // Sanity: the Secretary CAN verify right now (default grid).
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_ChapterRegistration_VerifyOfficer",
                new { RegistrationOfficerId = officerRowId, RequestingMemberId = secretaryId, Verified = true, Note = (string?)null },
                commandType: CommandType.StoredProcedure));

            // Revoke Secretary's ChapterRegistration.Verify.
            var table = new DataTable();
            table.Columns.Add("CouncilOfficeId", typeof(int));
            table.Columns.Add("PermissionKey", typeof(string));
            table.Columns.Add("IsGranted", typeof(bool));
            table.Rows.Add(fx.SecretaryOfficeId, "ChapterRegistration.Verify", false);

            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_CouncilPermission_Set",
                new
                {
                    RequestingMemberId = presidentId,
                    CouncilId = fx.TestCityACouncilId,
                    Changes = table.AsTableValuedParameter("dbo.CouncilPermissionChangeRow"),
                    Reason = (string?)null,
                },
                commandType: CommandType.StoredProcedure));

            // Immediately — same connection, no delay, no cache to expire — the Secretary must
            // already be rejected.
            var act = async () => await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_ChapterRegistration_VerifyOfficer",
                new { RegistrationOfficerId = officerRowId, RequestingMemberId = secretaryId, Verified = true, Note = (string?)null },
                commandType: CommandType.StoredProcedure));

            var assertion = await act.Should().ThrowAsync<SqlException>();
            assertion.Which.Number.Should().Be(51542);
        }
        finally
        {
            await ChapterRegistrationTestHelpers.DeleteCharterByMarkerAsync(conn, marker);
        }
    }
}

/// <summary>Every actual change writes exactly one history row and one AuditLog row; a
/// no-op batch (resubmitting the current state) writes neither.</summary>
[Collection("CouncilPermission")]
public class CouncilPermissionAuditDbTests(CouncilPermissionDbFixture fx)
{
    private const string NoDbSkipReason = "no shared dev DB connection string configured";

    [SkippableFact]
    public async Task One_history_row_and_one_AuditLog_row_per_changed_cell_none_for_a_repeat_noop_submission()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var presidentId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "AuditPresident");

        var table = new DataTable();
        table.Columns.Add("CouncilOfficeId", typeof(int));
        table.Columns.Add("PermissionKey", typeof(string));
        table.Columns.Add("IsGranted", typeof(bool));
        // Vice President does not hold ChapterRegistration.Review by default — a real change.
        table.Rows.Add(fx.VicePresidentOfficeId, "ChapterRegistration.Review", true);

        var changedCount = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "dbo.usp_CouncilPermission_Set",
            new
            {
                RequestingMemberId = presidentId,
                CouncilId = fx.TestCityACouncilId,
                Changes = table.AsTableValuedParameter("dbo.CouncilPermissionChangeRow"),
                Reason = "ZZTEST audit coverage",
            },
            commandType: CommandType.StoredProcedure));
        changedCount.Should().Be(1);

        var historyRows = (await conn.QueryAsync<(bool WasGranted, bool IsGranted, string Reason)>(
            "SELECT WasGranted, IsGranted, Reason FROM dbo.CouncilOfficePermissionHistory " +
            "WHERE CouncilId = @councilId AND CouncilOfficeId = @officeId AND PermissionKey = N'ChapterRegistration.Review'",
            new { councilId = fx.TestCityACouncilId, officeId = fx.VicePresidentOfficeId })).ToList();
        historyRows.Should().HaveCount(1);
        historyRows[0].WasGranted.Should().BeFalse();
        historyRows[0].IsGranted.Should().BeTrue();
        historyRows[0].Reason.Should().Be("ZZTEST audit coverage");

        var auditRows = (await conn.QueryAsync<(string Action, string RecordId)>(
            "SELECT [Action], RecordId FROM dbo.AuditLog WHERE TableName = 'CouncilOfficePermission' " +
            "AND RecordId = @recordId",
            new { recordId = $"{fx.TestCityACouncilId}:{fx.VicePresidentOfficeId}:ChapterRegistration.Review" })).ToList();
        auditRows.Should().HaveCount(1);
        auditRows[0].Action.Should().Be("Grant");

        // Resubmitting the EXACT same state must be a true no-op: ChangedCount=0, no second
        // history row, no second audit row.
        var repeatChangedCount = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "dbo.usp_CouncilPermission_Set",
            new
            {
                RequestingMemberId = presidentId,
                CouncilId = fx.TestCityACouncilId,
                Changes = table.AsTableValuedParameter("dbo.CouncilPermissionChangeRow"),
                Reason = (string?)null,
            },
            commandType: CommandType.StoredProcedure));
        repeatChangedCount.Should().Be(0);

        var historyCountAfterRepeat = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.CouncilOfficePermissionHistory WHERE CouncilId = @councilId AND CouncilOfficeId = @officeId AND PermissionKey = N'ChapterRegistration.Review'",
            new { councilId = fx.TestCityACouncilId, officeId = fx.VicePresidentOfficeId });
        historyCountAfterRepeat.Should().Be(1, "re-submitting the current state must write no new history row");
    }

    [SkippableFact]
    public async Task The_history_table_rejects_a_direct_UPDATE_and_a_direct_DELETE_with_51004()
    {
        Skip.If(fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(fx.ConnectionString);
        await conn.OpenAsync();

        var presidentId = await fx.SeatOfficerAsync(conn, fx.TestCityACouncilId, fx.PresidentOfficeId, fx.CouncilAdminRoleId, "AuditTriggerPresident");

        var table = new DataTable();
        table.Columns.Add("CouncilOfficeId", typeof(int));
        table.Columns.Add("PermissionKey", typeof(string));
        table.Columns.Add("IsGranted", typeof(bool));
        table.Rows.Add(fx.TreasurerOfficeId, "ChapterRegistration.Review", true);

        await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_CouncilPermission_Set",
            new
            {
                RequestingMemberId = presidentId,
                CouncilId = fx.TestCityACouncilId,
                Changes = table.AsTableValuedParameter("dbo.CouncilPermissionChangeRow"),
                Reason = (string?)null,
            },
            commandType: CommandType.StoredProcedure));

        var historyId = await conn.ExecuteScalarAsync<long>(
            "SELECT TOP (1) HistoryId FROM dbo.CouncilOfficePermissionHistory " +
            "WHERE CouncilId = @councilId AND CouncilOfficeId = @officeId AND PermissionKey = N'ChapterRegistration.Review' " +
            "ORDER BY HistoryId DESC",
            new { councilId = fx.TestCityACouncilId, officeId = fx.TreasurerOfficeId });

        var updateAct = async () => await conn.ExecuteAsync(
            "UPDATE dbo.CouncilOfficePermissionHistory SET Reason = N'tampered' WHERE HistoryId = @historyId",
            new { historyId });
        var updateAssertion = await updateAct.Should().ThrowAsync<SqlException>();
        updateAssertion.Which.Number.Should().Be(51004);

        var deleteAct = async () => await conn.ExecuteAsync(
            "DELETE FROM dbo.CouncilOfficePermissionHistory WHERE HistoryId = @historyId",
            new { historyId });
        var deleteAssertion = await deleteAct.Should().ThrowAsync<SqlException>();
        deleteAssertion.Which.Number.Should().Be(51004);
    }
}
