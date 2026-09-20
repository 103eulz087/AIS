using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Akrho.Api.Features.ChapterRegistrations;
using Akrho.Infrastructure.Repositories;
using Dapper;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Akrho.Tests;

/*
 * Chapter-registration module — structural/reflection invariant checks (fast, no database)
 * plus two small, cheap DB-backed checks (status seed content, anti-enumeration). The big,
 * expensive scenarios (approval atomicity, two-person control, the bounded enrolment-issue
 * branch) each get their own file — this one is for invariants that are either provable by
 * reading types/source directly, or need only a trivial amount of database setup.
 *
 * CLAUDE.md invariants covered here:
 *   #4  — SubmitChapterTurnoverRequest / ChapterTurnoverOfficerInputDto never carry a
 *         chapterId anywhere (structural — there is no field to trust or not trust).
 *   #13 — a chapter turnover can only ever select officers from that SAME chapter's own
 *         member roster; a MemberId from a different chapter is rejected by the procedure
 *         itself, not merely by client-side UI.
 *   §7A.4 "always a route forward" — dbo.ChapterRegistrationStatus has exactly three rows,
 *         forever, and there is no /reject route anywhere in this feature.
 *   §2 invariant 16 / decision 18 — no password/credential field anywhere in this module's
 *         DTOs; only ever a show-once enrolment URL.
 *   ChapterAuditor — never appears in the argument list of any RequireRole(...) call in
 *         Program.cs (a general codebase-wide check, not just this module's own policies).
 *   usp_ChapterRegistration_GetByReference's anti-enumeration guarantee — a wrong reference
 *         and a wrong mobile number are indistinguishable.
 */

internal static class ChapterRegistrationTestDbConfig
{
    public static string? ConnectionString { get; } = Resolve();

    private static string? Resolve()
    {
        var fromEnv = Environment.GetEnvironmentVariable("ConnectionStrings__Akrho");
        if (!string.IsNullOrWhiteSpace(fromEnv)) return fromEnv;

        var repoRoot = FindRepoRoot(AppContext.BaseDirectory);
        if (repoRoot is null) return null;

        var localJson = Path.Combine(repoRoot, "src", "Akrho.Api", "appsettings.Development.local.json");
        if (!File.Exists(localJson)) return null;

        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(localJson));
            if (doc.RootElement.TryGetProperty("ConnectionStrings", out var cs) &&
                cs.TryGetProperty("Akrho", out var akrho))
                return akrho.GetString();
        }
        catch
        {
            // Malformed/unreadable local file — treated as "not configured", not a failure.
        }
        return null;
    }

    public static string? FindRepoRoot(string startDir)
    {
        var dir = new DirectoryInfo(startDir);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "Akrho.sln"))) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }
}

public class ChapterTurnoverRequest_never_carries_a_chapterId
{
    private static readonly string[] ForbiddenNameFragments = ["chapterid", "chapter_id"];

    private static void AssertNoChapterIdProperty(Type t)
    {
        foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var lower = p.Name.ToLowerInvariant();
            ForbiddenNameFragments.Should().NotContain(f => lower.Contains(f),
                $"{t.Name}.{p.Name} must never let a caller supply a chapter id — " +
                "the filer's own chapter is always re-derived server-side from his ChapterAdmin role (CLAUDE.md invariant #4)");
        }
    }

    [Fact]
    public void SubmitChapterTurnoverRequest_has_no_chapterId_field()
        => AssertNoChapterIdProperty(typeof(SubmitChapterTurnoverRequest));

    [Fact]
    public void ChapterTurnoverOfficerInputDto_has_no_chapterId_field()
        => AssertNoChapterIdProperty(typeof(ChapterTurnoverOfficerInputDto));

    /// <summary>
    /// Structural pin on the exact shape decision D requires: a turnover officer is a bare
    /// (office, existing member) pair — nothing else. If a future edit ever adds a typed-in
    /// name/mobile/etc. field here, this test fails immediately rather than relying on
    /// someone noticing during review.
    /// </summary>
    [Fact]
    public void ChapterTurnoverOfficerInputDto_carries_only_OfficeId_and_MemberId()
    {
        var names = typeof(ChapterTurnoverOfficerInputDto)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name)
            .ToArray();

        names.Should().BeEquivalentTo(["OfficeId", "MemberId"],
            "a turnover officer is ALWAYS selected from the chapter's existing roster by id — " +
            "never typed-in text (usp_ChapterRegistration_SubmitTurnover's own header comment)");
    }

    /// <summary>Same pin, one layer down — the Infrastructure-side record Dapper actually
    /// hands to the TVP must carry the identical, narrow shape.</summary>
    [Fact]
    public void ChapterTurnoverOfficerInput_domain_record_carries_only_OfficeId_and_MemberId()
    {
        var names = typeof(ChapterTurnoverOfficerInput)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name)
            .ToArray();

        names.Should().BeEquivalentTo(["OfficeId", "MemberId"]);
    }
}

public class No_password_or_credential_field_anywhere_in_ChapterRegistrationDtos
{
    private static readonly string[] ForbiddenFragments = ["password", "credential", "secret", "passwd", "pwd"];

    /// <summary>
    /// Reflects over every public record/type declared in ChapterRegistrationDtos.cs (the
    /// whole Akrho.Api.Features.ChapterRegistrations namespace) and asserts NO property name
    /// contains "password"/"credential"/"secret" in any form. The only thing this module ever
    /// hands back that lets someone in is an EnrolmentUrl carrying an opaque, one-time token —
    /// never a password, never anything the server itself generated as a login secret in a
    /// reusable form (CLAUDE.md invariant #16).
    /// </summary>
    [Fact]
    public void No_DTO_in_the_ChapterRegistrations_feature_carries_a_password_or_credential_field()
    {
        var types = typeof(SubmitChapterRegistrationRequest).Assembly.GetTypes()
            .Where(t => t.Namespace == "Akrho.Api.Features.ChapterRegistrations")
            .ToList();

        types.Should().NotBeEmpty("the ChapterRegistrations DTO namespace should be discoverable via reflection");

        foreach (var t in types)
        {
            foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var lower = p.Name.ToLowerInvariant();
                ForbiddenFragments.Should().NotContain(f => lower.Contains(f),
                    $"{t.Name}.{p.Name} looks like a password/credential field — this module must never carry one; " +
                    "the only thing it ever returns is a show-once EnrolmentUrl");
            }
        }
    }

    /// <summary>The one field that DOES carry a login-granting value is named and shaped
    /// exactly as the show-once URL the UI is built around — pinned here so nobody quietly
    /// renames it into something that reads like a raw secret being persisted.</summary>
    [Fact]
    public void The_only_login_granting_field_is_the_show_once_EnrolmentUrl()
    {
        typeof(ChapterCharterApprovalResultDto).GetProperty("EnrolmentUrl").Should().NotBeNull();
        typeof(ChapterCharterApprovalResultDto).GetProperty("EnrolmentUrl")!.PropertyType.Should().Be(typeof(string));

        typeof(ChapterTurnoverOfficerEnrolmentDto).GetProperty("EnrolmentUrl").Should().NotBeNull();
    }
}

public class ChapterAuditor_is_never_granted_a_write_policy_anywhere
{
    /// <summary>
    /// Grep-based, codebase-wide (not just this module's own two council policies): reads
    /// Program.cs's own source text and asserts NO RequireRole(...) call's argument list
    /// contains "ChapterAuditor" anywhere. This is deliberately structural rather than a
    /// runtime authorization test, so it also catches a FUTURE, unrelated policy that
    /// accidentally adds ChapterAuditor — exactly the failure mode AuthorizationPolicies.cs's
    /// own comments warn about twice.
    /// </summary>
    [Fact]
    public void No_RequireRole_call_in_Program_cs_lists_ChapterAuditor()
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull("the repo root (Akrho.sln) must be discoverable from the test's own base directory");

        var programCsPath = Path.Combine(repoRoot!, "src", "Akrho.Api", "Program.cs");
        File.Exists(programCsPath).Should().BeTrue();

        var source = File.ReadAllText(programCsPath);

        var calls = Regex.Matches(source, @"RequireRole\(([^)]*)\)");
        calls.Count.Should().BeGreaterThan(0, "Program.cs is expected to declare authorization policies via RequireRole(...)");

        foreach (Match call in calls)
        {
            call.Groups[1].Value.Should().NotContain("ChapterAuditor",
                "ChapterAuditor is deliberately read-only (§7A.4: \"an auditor who can edit what he audits is not an auditor\") " +
                "and must never be added to ANY write-granting policy");
        }
    }
}

public class ChapterRegistration_has_no_reject_action_ever
{
    /// <summary>
    /// dbo.ChapterRegistrationStatus must contain EXACTLY these three rows, forever — no
    /// 'Rejected' row. §7A.4: "a chapter that has organized and petitioned must always have
    /// a route forward." A live DB check (SkippableFact — see the other DB-backed suites in
    /// this project for why a missing connection string must report Skipped, not Passed).
    /// </summary>
    [SkippableFact]
    public async Task ChapterRegistrationStatus_seed_contains_exactly_three_rows_and_never_Rejected()
    {
        Skip.If(ChapterRegistrationTestDbConfig.ConnectionString is null,
            "no shared dev DB connection string configured");

        using var conn = new SqlConnection(ChapterRegistrationTestDbConfig.ConnectionString);
        await conn.OpenAsync();

        var names = (await conn.QueryAsync<string>("SELECT StatusName FROM dbo.ChapterRegistrationStatus")).ToList();

        names.Should().BeEquivalentTo(["Submitted", "ReturnedForCorrection", "Approved"]);
        names.Should().NotContain("Rejected");
    }

    /// <summary>
    /// Structural: reads ChapterRegistrationsEndpoints.cs's own source text and asserts no
    /// MapPost/MapPut/MapDelete route mentions "reject" anywhere in its own path — NOT a bare
    /// substring search for "/reject" (the file's own header comment legitimately contains
    /// that exact text, explaining why no such route exists), but a search restricted to the
    /// argument of an actual route-mapping call.
    /// </summary>
    [Fact]
    public void ChapterRegistrationsEndpoints_declares_no_reject_route()
    {
        var repoRoot = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        repoRoot.Should().NotBeNull();

        var endpointsPath = Path.Combine(
            repoRoot!, "src", "Akrho.Api", "Features", "ChapterRegistrations", "ChapterRegistrationsEndpoints.cs");
        File.Exists(endpointsPath).Should().BeTrue();

        var source = File.ReadAllText(endpointsPath);

        var mapCalls = Regex.Matches(source, @"\.Map(Get|Post|Put|Delete)\(([^)]*)\)");
        mapCalls.Count.Should().BeGreaterThan(0, "the endpoints file is expected to declare routes via MapGet/MapPost/etc.");

        foreach (Match call in mapCalls)
        {
            call.Groups[2].Value.ToLowerInvariant().Should().NotContain("reject",
                "there is deliberately NO /reject endpoint anywhere in this feature — " +
                "a registration that cannot yet be approved is returned for correction, never killed");
        }
    }
}

public class ChapterRegistration_GetByReference_anti_enumeration
{
    /// <summary>
    /// Creates one throwaway Charter registration (a direct INSERT — see
    /// InsertCharterRegistrationDirectAsync's own comment for why this test does not go
    /// through usp_ChapterRegistration_Submit) and confirms a wrong reference number and a
    /// wrong mobile number against the RIGHT reference are both the identical "not found"
    /// (null), and that the right pair together do resolve — proving the two failure cases are
    /// genuinely indistinguishable rather than merely returning the same HTTP status for two
    /// different underlying reasons.
    /// </summary>
    [SkippableFact]
    public async Task Wrong_reference_and_wrong_mobile_are_indistinguishable()
    {
        Skip.If(ChapterRegistrationTestDbConfig.ConnectionString is null,
            "no shared dev DB connection string configured");

        var connectionString = ChapterRegistrationTestDbConfig.ConnectionString!;
        using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync();

        var actingCouncilId = await conn.ExecuteScalarAsync<int>("SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = 1");
        actingCouncilId.Should().NotBe(0, "expected seed data (db/seed/02_demo_chapter.sql) not found");

        var (_, referenceNo, marker, presidentMobile) =
            await ChapterRegistrationTestHelpers.InsertCharterRegistrationDirectAsync(conn, actingCouncilId, verifiedCount: 0, verifiedBy: null);

        var repo = new ChapterRegistrationRepository(new Akrho.Infrastructure.SqlConnectionFactory(connectionString));
        try
        {
            // Sanity: the right pair resolves to something.
            var ok = await repo.GetByReferenceAsync(referenceNo, presidentMobile, CancellationToken.None);
            ok.Should().NotBeNull();

            // Wrong reference, right mobile.
            (await repo.GetByReferenceAsync("CHR-2099-9999", presidentMobile, CancellationToken.None)).Should().BeNull();

            // Right reference, wrong mobile.
            (await repo.GetByReferenceAsync(referenceNo, "09000000000", CancellationToken.None)).Should().BeNull();

            // Wrong reference AND wrong mobile — same null result as either case above.
            (await repo.GetByReferenceAsync("CHR-2099-9999", "09000000000", CancellationToken.None)).Should().BeNull();
        }
        finally
        {
            await ChapterRegistrationTestHelpers.DeleteCharterByMarkerAsync(conn, marker);
        }
    }
}

public class Turnover_officer_must_be_an_existing_member_of_the_SAME_chapter
{
    /// <summary>
    /// Invariant #13 / decision D, proven against the real procedure: a turnover filing whose
    /// officer roster includes a MemberId belonging to a DIFFERENT chapter is rejected (51513)
    /// — never silently accepted, and never a code path that could create a brand-new member.
    /// Uses the real seeded chapter (ChapterId=1, "Brgy. San Isidro Chapter") as chapter A and
    /// a dedicated, unmistakably-named ZZTEST chapter+member as chapter B, created and torn
    /// down entirely by this test.
    /// </summary>
    [SkippableFact]
    public async Task SubmitTurnover_rejects_a_MemberId_from_a_different_chapter()
    {
        Skip.If(ChapterRegistrationTestDbConfig.ConnectionString is null,
            "no shared dev DB connection string configured");

        var connectionString = ChapterRegistrationTestDbConfig.ConnectionString!;
        using var conn = new SqlConnection(connectionString);
        await conn.OpenAsync();

        var chapterAAdminId = await conn.ExecuteScalarAsync<int>(
            "SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-001'");
        chapterAAdminId.Should().NotBe(0, "expected seed data (db/seed/02_demo_chapter.sql) not found");

        var activeStatusId = await conn.ExecuteScalarAsync<int>(
            "SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = N'Active'");
        var anyChapterAsHome = await conn.ExecuteScalarAsync<int>(
            "SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = 1");

        var chapterBName = "ZZTEST-CrossChapterTurnover-" + Guid.NewGuid().ToString("N")[..8];
        var chapterBId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Chapter (ParentCouncilId, ChapterName, Barangay, SuggestedContribution)
            OUTPUT INSERTED.ChapterId
            VALUES (@anyChapterAsHome, @chapterBName, N'ZZTEST', 0)
            """, new { anyChapterAsHome, chapterBName });

        var chapterBMemberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        var chapterBMemberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, MemberNumber, FirstName, LastName, GiftName, StatusId)
            OUTPUT INSERTED.MemberId
            VALUES (@chapterBId, @chapterBMemberNumber, N'ZZTEST', N'ZZTEST', N'ZZTEST-ChapterB-Officer', @activeStatusId)
            """, new { chapterBId, chapterBMemberNumber, activeStatusId });

        var offices = await ChapterRegistrationTestHelpers.GetOfficesAsync(conn);
        offices.Should().HaveCount(8);

        // 7 offices filled by chapter A's own real, active ChapterAdmin (repetition across
        // offices is not blocked by UQ_ChapterRegistrationOfficer — that constraint is only
        // (RegistrationId, OfficeId) — and is irrelevant to this negative test, which only
        // needs ONE bad row to prove the rejection); the 8th is the cross-chapter member.
        var table = new System.Data.DataTable();
        table.Columns.Add("OfficeId", typeof(int));
        table.Columns.Add("MemberId", typeof(int));
        for (var i = 0; i < offices.Count - 1; i++) table.Rows.Add(offices[i].OfficeId, chapterAAdminId);
        table.Rows.Add(offices[^1].OfficeId, chapterBMemberId);

        try
        {
            var act = async () => await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
                "dbo.usp_ChapterRegistration_SubmitTurnover",
                new { RequestingMemberId = chapterAAdminId, Officers = table.AsTableValuedParameter("dbo.ChapterTurnoverOfficerRow") },
                commandType: System.Data.CommandType.StoredProcedure));

            var assertion = await act.Should().ThrowAsync<SqlException>();
            assertion.Which.Number.Should().Be(51513);
            assertion.Which.Message.Should().Contain("existing, approved or active member of this same chapter");
        }
        finally
        {
            // The procedure rejects before BEGIN TRAN — nothing was written for chapter A to
            // clean up. Only chapter B's own throwaway fixture needs removing.
            await conn.ExecuteAsync(
                "DELETE FROM dbo.Member WHERE MemberId = @chapterBMemberId; DELETE FROM dbo.Chapter WHERE ChapterId = @chapterBId;",
                new { chapterBMemberId, chapterBId });
        }
    }
}

/// <summary>Small helpers shared by the DB-backed tests in this file.</summary>
internal static class ChapterRegistrationTestHelpers
{
    /// <summary>
    /// Resolves geography that matches <paramref name="actingCouncilId"/>'s OWN branch —
    /// reading that council's own RegionId/ProvinceId/MunicipalityId columns (set directly
    /// on whichever level owns them; see 17_chapter_registration.sql's own backfill
    /// comment) rather than an arbitrary geography row. usp_ChapterRegistration_Approve
    /// now derives a Charter's new chapter's parent FROM the registration's OWN chosen
    /// geography (auto-creating any missing council level in that chain), not from
    /// ActingCouncilId directly — so a mismatched pick would silently build an unrelated
    /// council chain that the test's own council officer (seated on actingCouncilId, and
    /// nowhere else) has no jurisdiction over, exactly the failure this once produced.
    /// </summary>
    public static async Task<(int RegionId, int ProvinceId, int MunicipalityId)> PickGeographyAsync(
        SqlConnection conn, int actingCouncilId)
    {
        var council = await conn.QuerySingleAsync<(int? RegionId, int? ProvinceId, int? MunicipalityId)>(
            "SELECT RegionId, ProvinceId, MunicipalityId FROM dbo.Council WHERE CouncilId = @actingCouncilId",
            new { actingCouncilId });

        if (council.MunicipalityId is { } municipalityId)
        {
            var (regionId, provinceId) = await conn.QuerySingleAsync<(int, int)>(
                """
                SELECT p.RegionId, m.ProvinceId
                FROM   dbo.Municipality m JOIN dbo.Province p ON p.ProvinceId = m.ProvinceId
                WHERE  m.MunicipalityId = @municipalityId
                """,
                new { municipalityId });
            return (regionId, provinceId, municipalityId);
        }

        // No current caller passes a council above City/Municipal level (one with no
        // MunicipalityId of its own) — kept only so this helper degrades to something
        // sensible instead of throwing, if a future caller ever does.
        var row = await conn.QuerySingleAsync<(int RegionId, int ProvinceId, int MunicipalityId)>(
            """
            SELECT TOP (1) pr.RegionId, pr.ProvinceId, mu.MunicipalityId
            FROM   dbo.Municipality mu JOIN dbo.Province pr ON pr.ProvinceId = mu.ProvinceId
            ORDER BY mu.MunicipalityId
            """);
        return row;
    }

    public static async Task<List<(int OfficeId, string OfficeName)>> GetOfficesAsync(SqlConnection conn) =>
        (await conn.QueryAsync<(int OfficeId, string OfficeName)>(
            "SELECT OfficeId, OfficeName FROM dbo.ChapterOffice ORDER BY SortOrder")).ToList();

    public static List<ChapterCharterOfficerInput> BuildCharterOfficers(
        List<(int OfficeId, string OfficeName)> offices, string marker, out string presidentMobile)
    {
        var officers = new List<ChapterCharterOfficerInput>();
        string? president = null;

        for (var i = 0; i < offices.Count; i++)
        {
            var mobile = $"0917{i:D3}0000";
            if (offices[i].OfficeName == "President") president = mobile;

            officers.Add(new ChapterCharterOfficerInput(
                offices[i].OfficeId, "ZZTEST", null, "Officer", $"{marker}-{i}",
                new DateOnly(1990, 1, 1), mobile, null, null, null, null));
        }

        presidentMobile = president ?? throw new InvalidOperationException("No 'President' office found in dbo.ChapterOffice.");
        return officers;
    }

    public static Task DeleteCharterByMarkerAsync(SqlConnection conn, string marker) =>
        conn.ExecuteAsync(
            """
            DECLARE @regId INT = (SELECT RegistrationId FROM dbo.ChapterRegistration WHERE ProposedChapterName = @marker);
            IF @regId IS NOT NULL
            BEGIN
                DELETE FROM dbo.AuditLog WHERE NewValues LIKE '%"RegistrationId":' + CAST(@regId AS NVARCHAR(20)) + '%';
                DELETE FROM dbo.ApprovalRouting WHERE SubjectType = 'Chapter' AND SubjectId = @regId;
                DELETE FROM dbo.ChapterRegistrationOfficer WHERE RegistrationId = @regId;
                DELETE FROM dbo.ChapterRegistrationUpdate WHERE RegistrationId = @regId;
                DELETE FROM dbo.ChapterRegistration WHERE RegistrationId = @regId;
            END
            """,
            new { marker });

    /// <summary>
    /// Inserts a Charter ChapterRegistration row (+ its 8 officer rows) DIRECTLY, bypassing
    /// usp_ChapterRegistration_Submit entirely.
    ///
    /// WHY: the shared dev database (CLAUDE.md §10) currently has NO council anywhere — not
    /// even National — with a seated officer. usp_Approval_ResolveApprover (db/procs/
    /// usp_Approval_Routing.sql) walks up from whatever jurisdiction Submit resolves and
    /// unconditionally THROWs 51090 ("No ancestor with seated officers. Seed the National
    /// Council and seat its officers first.") when that walk finds nobody — which today it
    /// always does, for ANY geography. That is a real environment gap worth fixing (seat at
    /// least the National Council in the seed data) so Submit itself can be exercised
    /// end-to-end here too — flagged in this suite's own test report rather than silently
    /// routed around. It is orthogonal to what THESE tests are actually about (GetByReference's
    /// anti-enumeration guarantee; Approve's atomicity and two-person control), which only
    /// need a row already sitting in dbo.ChapterRegistration in a chosen state — exactly what
    /// EnrolmentDbFixture already does elsewhere in this project when it needs a chapter/member
    /// to exist without exercising the endpoint that would normally create one. Approve/
    /// VerifyOfficer/GetByReference read this row's CURRENT state; they do not care how it
    /// arrived.
    /// </summary>
    public static async Task<(int RegistrationId, string ReferenceNo, string Marker, string PresidentMobile)>
        InsertCharterRegistrationDirectAsync(SqlConnection conn, int actingCouncilId, int verifiedCount, int? verifiedBy)
    {
        var (regionId, provinceId, municipalityId) = await PickGeographyAsync(conn, actingCouncilId);
        var offices = await GetOfficesAsync(conn);
        offices.Should().HaveCount(8);

        var marker = "ZZTEST-" + Guid.NewGuid().ToString("N")[..14];
        var referenceNo = "ZZTEST-CHR-" + Guid.NewGuid().ToString("N")[..8];
        var submittedId = await conn.ExecuteScalarAsync<int>(
            "SELECT StatusId FROM dbo.ChapterRegistrationStatus WHERE StatusName = N'Submitted'");

        var registrationId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.ChapterRegistration (
                ReferenceNo, RegistrationType, ProposedChapterName, Barangay,
                RegionId, ProvinceId, MunicipalityId, MarkAccentId,
                IntendedCouncilId, ActingCouncilId, RoutingReason,
                SubmittedByMemberId, SubmittedDate, StatusId, IsOpen)
            OUTPUT INSERTED.RegistrationId
            VALUES (
                @referenceNo, 'Charter', @marker, NULL,
                @regionId, @provinceId, @municipalityId, NULL,
                NULL, @actingCouncilId, N'Parent',
                NULL, SYSUTCDATETIME(), @submittedId, 1)
            """,
            new { referenceNo, marker, regionId, provinceId, municipalityId, actingCouncilId, submittedId });

        var officers = BuildCharterOfficers(offices, marker, out var presidentMobile);
        var i = 0;
        foreach (var o in officers)
        {
            var verified = i < verifiedCount;
            await conn.ExecuteAsync(
                """
                INSERT dbo.ChapterRegistrationOfficer (
                    RegistrationId, OfficeId, FirstName, MiddleName, LastName, GiftName, BirthDate,
                    MobileNo, Email, DateSurvive, PresidentDuringSurvive, MasterInitiatorDuringSurvive,
                    VerifiedBy, VerifiedDate)
                VALUES (
                    @registrationId, @officeId, @firstName, NULL, @lastName, @giftName, @birthDate,
                    @mobileNo, NULL, NULL, NULL, NULL,
                    @verifiedBy, @verifiedDate)
                """,
                new
                {
                    registrationId, officeId = o.OfficeId, firstName = o.FirstName, lastName = o.LastName,
                    giftName = o.GiftName, birthDate = o.BirthDate.ToDateTime(TimeOnly.MinValue), mobileNo = o.MobileNo,
                    verifiedBy = verified ? verifiedBy : null,
                    verifiedDate = verified ? DateTime.UtcNow : (DateTime?)null,
                });
            i++;
        }

        return (registrationId, referenceNo, marker, presidentMobile);
    }
}
