using System.Text.RegularExpressions;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/*
 * Phase 1 "dynamic council office permissions" (2026-10-17) — structural/reflection
 * invariant checks (fast, no database). Mirrors ChapterRegistrationStructuralInvariantTests'
 * own approach: these prove things by reading source/schema text directly rather than by
 * standing up data, so they run everywhere, including this sandbox with no DB connection.
 *
 * Covers:
 *   - The three action procs (VerifyOfficer/Return/Approve) no longer hardcode
 *     RoleName IN (...) — they gate on dbo.fn_MemberSeatPermissions over the correct key.
 *   - db/schema/28_council_permissions.sql's catalog seed carries no "Enrol" key and is
 *     protected by a CHECK constraint (CLAUDE.md invariant #13, enforced at the catalog
 *     level so a future developer cannot even seed the capability by mistake).
 *   - dbo.CouncilPermissionDefault's seed reproduces the pre-module hardcoded policy matrix
 *     byte for byte (the schema file's own stated goal).
 *   - IdCardExportEndpoints uses AuthorizationPolicies.NationalIdCardExport, and Program.cs
 *     registers that policy with EXACTLY CouncilSecretary + CouncilAdmin — proving the split
 *     that keeps the Phase 1 widening from also widening who may bulk-export member data.
 *   - dbo.fn_CouncilEffectivePermissions locks presiding/read-only-write AHEAD of any
 *     override/default lookup (textual CASE-branch ordering).
 *   - dbo.CouncilOfficePermissionHistory is guarded by an INSTEAD OF UPDATE, DELETE trigger
 *     that THROWs 51004 — append-only, same enforcement pattern as LedgerEntry/CorrectiveAction.
 */

public class Action_procs_gate_on_fn_MemberSeatPermissions_not_RoleName
{
    private static string ReadProc(string fileName)
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull("the repo root (Akrho.sln) must be discoverable from the test's own base directory");

        var path = Path.Combine(repoRoot!, "db", "procs", fileName);
        File.Exists(path).Should().BeTrue($"{fileName} is expected to exist under db/procs/");
        return File.ReadAllText(path);
    }

    [Theory]
    [InlineData("usp_ChapterRegistration_VerifyOfficer.sql", "ChapterRegistration.Verify")]
    [InlineData("usp_ChapterRegistration_Return.sql", "ChapterRegistration.Return")]
    [InlineData("usp_ChapterRegistration_Approve.sql", "ChapterRegistration.Approve")]
    public void Proc_contains_no_hardcoded_RoleName_IN_check(string fileName, string expectedKey)
    {
        var source = ReadProc(fileName);

        // Case-insensitive: SQL keywords/identifiers are not case-sensitive in this codebase's
        // own convention, and "RoleName IN" used to appear in exactly this family of procs
        // before this module existed.
        Regex.IsMatch(source, @"RoleName\s+IN", RegexOptions.IgnoreCase).Should().BeFalse(
            $"{fileName} must no longer gate on a hardcoded role list — the dynamic grid " +
            "(db/schema/28_council_permissions.sql) is the only authority now");

        source.Should().Contain("dbo.fn_MemberSeatPermissions",
            $"{fileName} must check the caller's own live seat permissions, not a role name");

        source.Should().Contain($"N'{expectedKey}'",
            $"{fileName} must gate on exactly the '{expectedKey}' key, not some other catalog entry");
    }
}

public class CouncilPermission_catalog_excludes_Enrol_and_is_CHECK_protected
{
    private static string ReadSchemaFile()
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();

        var path = Path.Combine(repoRoot!, "db", "schema", "28_council_permissions.sql");
        File.Exists(path).Should().BeTrue();
        return File.ReadAllText(path);
    }

    [Fact]
    public void CK_CouncilPermission_NoEnrol_constraint_exists_and_rejects_Enrol_in_the_key()
    {
        var source = ReadSchemaFile();

        source.Should().Contain("CK_CouncilPermission_NoEnrol",
            "CLAUDE.md invariant #13 ('no council may enrol anybody') must be enforced at the catalog level, not just by code review");
        source.Should().Contain("PermissionKey NOT LIKE N'%Enrol%'");
    }

    [Fact]
    public void The_six_seeded_catalog_keys_contain_no_Enrol_fragment()
    {
        var source = ReadSchemaFile();

        var insertBlockStart = source.IndexOf("INSERT dbo.CouncilPermission (PermissionKey", StringComparison.Ordinal);
        insertBlockStart.Should().BeGreaterThan(-1, "the catalog seed INSERT should be present");
        var insertBlockEnd = source.IndexOf("END", insertBlockStart, StringComparison.Ordinal);
        var block = source[insertBlockStart..insertBlockEnd];

        var keys = Regex.Matches(block, @"N'([A-Za-z]+\.[A-Za-z]+)'")
            .Select(m => m.Groups[1].Value)
            .Distinct()
            .ToList();

        keys.Should().HaveCount(6, "the catalog seed is documented as exactly six phase-1 capabilities");
        keys.Should().OnlyContain(k => !k.Contains("Enrol", StringComparison.OrdinalIgnoreCase));
        keys.Should().BeEquivalentTo([
            "ChapterRegistration.Review", "ChapterRegistration.Verify", "ChapterRegistration.Approve",
            "ChapterRegistration.Return", "CouncilStatistics.Read", "CouncilMemberSearch.Read"
        ]);
    }
}

public class CouncilPermissionDefault_seed_matches_the_legacy_hardcoded_matrix
{
    [Fact]
    public void Default_grant_by_office_reproduces_the_pre_module_policy_matrix_exactly()
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();

        var path = Path.Combine(repoRoot!, "db", "schema", "28_council_permissions.sql");
        var source = File.ReadAllText(path);

        var start = source.IndexOf("INSERT dbo.CouncilPermissionDefault (CouncilOfficeId, PermissionKey)", StringComparison.Ordinal);
        start.Should().BeGreaterThan(-1);
        var end = source.IndexOf(") AS v(OfficeName, PermissionKey)", start, StringComparison.Ordinal);
        end.Should().BeGreaterThan(start);
        var block = source[start..end];

        var pairs = Regex.Matches(block, @"\(N'([^']*)',\s*N'([^']*)'\)")
            .Select(m => (Office: m.Groups[1].Value, Key: m.Groups[2].Value))
            .ToList();

        pairs.Should().NotBeEmpty();

        var byOffice = pairs.GroupBy(p => p.Office).ToDictionary(g => g.Key, g => g.Select(p => p.Key).ToHashSet());

        // President and Secretary: all six keys (Program.cs's own AuthorizationPolicies
        // comment — "CouncilChapterRegistrationVerify/Approve, CouncilStatisticsRead =
        // CouncilSecretary + CouncilAdmin i.e. Secretary + President").
        string[] fullGrant = [
            "ChapterRegistration.Review", "ChapterRegistration.Verify", "ChapterRegistration.Approve",
            "ChapterRegistration.Return", "CouncilStatistics.Read", "CouncilMemberSearch.Read"
        ];
        byOffice["President"].Should().BeEquivalentTo(fullGrant);
        byOffice["Secretary"].Should().BeEquivalentTo(fullGrant);

        // Treasurer, Vice President, PIO: member search only ("CouncilMemberSearchRead =
        // ... CouncilTreasurer + CouncilOfficer + CouncilPIO i.e. ... Treasurer + Vice
        // President + PIO").
        byOffice["Treasurer"].Should().BeEquivalentTo(["CouncilMemberSearch.Read"]);
        byOffice["Vice President"].Should().BeEquivalentTo(["CouncilMemberSearch.Read"]);
        byOffice["Public Information Officer"].Should().BeEquivalentTo(["CouncilMemberSearch.Read"]);

        // Auditor: no row at all — a read-only office that defaults to nothing.
        byOffice.Should().NotContainKey("Auditor");

        // No stray office name sneaked into the seed.
        byOffice.Keys.Should().BeEquivalentTo(["President", "Secretary", "Treasurer", "Vice President", "Public Information Officer"]);
    }
}

public class NationalIdCardExport_policy_is_split_from_the_Phase1_widening
{
    [Fact]
    public void IdCardExportEndpoints_requires_NationalIdCardExport_on_both_routes()
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();

        var path = Path.Combine(repoRoot!, "src", "Akrho.Api", "Features", "IdCardExport", "IdCardExportEndpoints.cs");
        File.Exists(path).Should().BeTrue();
        var source = File.ReadAllText(path);

        var occurrences = Regex.Matches(source, @"RequireAuthorization\(AuthorizationPolicies\.NationalIdCardExport\)").Count;
        occurrences.Should().Be(2, "both the spreadsheet export and the digital-ID export must require NationalIdCardExport");

        source.Should().NotContain("AuthorizationPolicies.CouncilChapterRegistrationApprove",
            "this policy was split OUT of CouncilChapterRegistrationApprove specifically so widening the latter " +
            "to all six council roles would not also widen who may bulk-export member photo/credential data");
    }

    [Fact]
    public void Program_cs_registers_NationalIdCardExport_with_exactly_CouncilSecretary_and_CouncilAdmin()
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();

        var path = Path.Combine(repoRoot!, "src", "Akrho.Api", "Program.cs");
        var source = File.ReadAllText(path);

        var match = Regex.Match(source,
            @"AuthorizationPolicies\.NationalIdCardExport,\s*p\s*=>\s*\r?\n\s*p\.RequireRole\(([^)]*)\)");
        match.Success.Should().BeTrue("Program.cs is expected to register NationalIdCardExport via AddPolicy(...RequireRole(...))");

        var roles = Regex.Matches(match.Groups[1].Value, @"""([^""]+)""").Select(m => m.Groups[1].Value).ToList();
        roles.Should().BeEquivalentTo(["CouncilSecretary", "CouncilAdmin"],
            "this must stay EXACTLY the pre-widening role set — not the six-role Phase 1 list used by " +
            "CouncilChapterRegistrationVerify/Approve/CouncilStatisticsRead/CouncilMemberSearchRead");
    }

    [Theory]
    [InlineData("CouncilChapterRegistrationVerify")]
    [InlineData("CouncilChapterRegistrationApprove")]
    [InlineData("CouncilStatisticsRead")]
    [InlineData("CouncilMemberSearchRead")]
    [InlineData("CouncilPermissionsRead")]
    public void Phase1_read_policies_are_widened_to_all_six_council_roles_including_Auditor(string policyName)
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();

        var path = Path.Combine(repoRoot!, "src", "Akrho.Api", "Program.cs");
        var source = File.ReadAllText(path);

        var match = Regex.Match(source,
            $@"AuthorizationPolicies\.{policyName},\s*p\s*=>\s*\r?\n\s*p\.RequireRole\(([^)]*)\)");
        match.Success.Should().BeTrue($"Program.cs is expected to register {policyName} via AddPolicy(...RequireRole(...))");

        var roles = Regex.Matches(match.Groups[1].Value, @"""([^""]+)""").Select(m => m.Groups[1].Value).ToList();
        roles.Should().BeEquivalentTo(
            ["CouncilAdmin", "CouncilOfficer", "CouncilSecretary", "CouncilTreasurer", "CouncilPIO", "CouncilAuditor"]);
    }

    [Fact]
    public void CouncilPermissionsManage_is_deliberately_NOT_widened_CouncilAdmin_only()
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();

        var path = Path.Combine(repoRoot!, "src", "Akrho.Api", "Program.cs");
        var source = File.ReadAllText(path);

        var match = Regex.Match(source,
            @"AuthorizationPolicies\.CouncilPermissionsManage,\s*p\s*=>\s*\r?\n\s*p\.RequireRole\(([^)]*)\)");
        match.Success.Should().BeTrue();

        var roles = Regex.Matches(match.Groups[1].Value, @"""([^""]+)""").Select(m => m.Groups[1].Value).ToList();
        roles.Should().BeEquivalentTo(["CouncilAdmin"],
            "the one capability that decides every other council capability must stay reserved for a seated President " +
            "(enforced for real by usp_CouncilPermission_Set's own 51931) — never widened to every council role");
    }
}

public class fn_CouncilEffectivePermissions_locks_outrank_overrides_textually
{
    [Fact]
    public void National_only_then_presiding_then_read_only_write_are_tested_before_the_override_default_fallback()
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();

        var path = Path.Combine(repoRoot!, "db", "schema", "28_council_permissions.sql");
        var source = File.ReadAllText(path);

        var fnStart = source.IndexOf("CREATE OR ALTER FUNCTION dbo.fn_CouncilEffectivePermissions", StringComparison.Ordinal);
        fnStart.Should().BeGreaterThan(-1);
        var fnEnd = source.IndexOf("\nGO", fnStart, StringComparison.Ordinal);
        fnEnd.Should().BeGreaterThan(fnStart);
        var body = source[fnStart..fnEnd];

        // Only the FIRST IsGranted CASE expression matters for precedence — find its four
        // tested conditions in textual order, which is also evaluation order for a SQL CASE.
        var nationalIdx = body.IndexOf("cp.IsNationalOnly = 1 AND c.ParentCouncilId IS NOT NULL THEN 0", StringComparison.Ordinal);
        var presidingIdx = body.IndexOf("co.IsPresiding = 1 THEN 1", StringComparison.Ordinal);
        var readOnlyWriteIdx = body.IndexOf("cp.IsWrite = 1 AND co.IsReadOnly = 1 THEN 0", StringComparison.Ordinal);
        var fallbackIdx = body.IndexOf("COALESCE(ovr.IsGranted,", StringComparison.Ordinal);

        nationalIdx.Should().BeGreaterThan(-1);
        presidingIdx.Should().BeGreaterThan(-1);
        readOnlyWriteIdx.Should().BeGreaterThan(-1);
        fallbackIdx.Should().BeGreaterThan(-1);

        nationalIdx.Should().BeLessThan(presidingIdx,
            "a national-only key off National must lock to 0 before the presiding-office lock is even considered");
        presidingIdx.Should().BeLessThan(readOnlyWriteIdx,
            "the presiding office's fixed grant must be locked ahead of the read-only/write lock");
        readOnlyWriteIdx.Should().BeLessThan(fallbackIdx,
            "a write key on a read-only office must lock to 0 BEFORE any override/default is ever consulted — " +
            "an override can never unlock what this clause has already forbidden");
    }
}

public class CouncilOfficePermissionHistory_is_append_only
{
    [Fact]
    public void INSTEAD_OF_UPDATE_DELETE_trigger_THROWs_51004()
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();

        var path = Path.Combine(repoRoot!, "db", "schema", "28_council_permissions.sql");
        var source = File.ReadAllText(path);

        source.Should().Contain("TR_CouncilOfficePermissionHistory_NoUpdateDelete");
        source.Should().Contain("INSTEAD OF UPDATE, DELETE");
        source.Should().Contain("THROW 51004,");
        source.Should().Contain("append-only and is never corrected or removed");
    }
}

/*
 * Regression (found live 2026-10-17): a member seated in two offices on ONE council (e.g.
 * President and Secretary of Region 7) holds the same key twice in fn_MemberSeatPermissions.
 * usp_ChapterRegistration_GetQueue/_Get copied that into a PRIMARY KEY table variable without
 * DISTINCT; the duplicate-key insert failed as a statement-level error, the proc carried on
 * with an empty table and threw 51520 "no permission" at a council President. Every insert
 * from the permission functions into a keyed table variable must de-duplicate first.
 */
public class Permission_function_inserts_into_keyed_table_variables_are_distinct
{
    [Theory]
    [InlineData("usp_ChapterRegistration_GetQueue.sql")]
    [InlineData("usp_ChapterRegistration_Get.sql")]
    public void MyPerms_insert_selects_DISTINCT(string fileName)
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();
        var source = File.ReadAllText(Path.Combine(repoRoot!, "db", "procs", fileName));

        Regex.IsMatch(source, @"INSERT\s+INTO\s+@MyPerms\s*\([^)]*\)\s*SELECT\s+DISTINCT\b", RegexOptions.IgnoreCase)
            .Should().BeTrue($"{fileName}'s @MyPerms has a PRIMARY KEY, and fn_MemberSeatPermissions returns " +
                             "one row per seat — two offices on one council would collide without DISTINCT");
    }
}

/*
 * Regression (found live 2026-10-17): dbo.CouncilOfficePermissionHistory.HistoryId is BIGINT,
 * but the Dapper record declared it int. Dapper matches the positional constructor against
 * the result set's column types even when the set is EMPTY, so every grid load 500'd before
 * a single change had ever been saved (CLAUDE.md §8.7's failure mode, for INT vs BIGINT).
 */
public class CouncilPermission_history_row_types_match_the_schema
{
    [Fact]
    public void HistoryId_is_long_to_match_BIGINT()
    {
        var p = typeof(Akrho.Infrastructure.Repositories.CouncilPermissionHistoryRow)
            .GetConstructors().Single().GetParameters();
        p.Single(x => x.Name == "HistoryId").ParameterType.Should().Be(typeof(long));
    }
}
