using System.Data;
using Akrho.Infrastructure;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Storage;
using Dapper;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Akrho.Tests;

/*
 * Credential scan/verify module, slice A (online-only) — scope-leak suite for
 * usp_Credential_VerifyForMember / usp_ScanLog_ListForSelf, via the real
 * CredentialRepository / ScanLogRepository / PublicVerificationRepository (Dapper +
 * stored procedures) — never mocked, per this project's own rule ("the procedures are
 * the logic; mocking them tests nothing"). Follows IdCardExportScopeTests.cs to the
 * letter: no WebApplicationFactory/TestServer; straight Dapper + Microsoft.Data.SqlClient
 * against the shared dev DB (CLAUDE.md §10) for fixture plumbing; ChatDbTestConfig
 * (internal, same assembly) reused verbatim for connection-string resolution;
 * [SkippableFact]/[SkippableTheory] + Skip.If so a missing connection string reports
 * genuinely Skipped, not silently Passed.
 *
 * THE POINT OF THIS SUITE (priority order, per the task brief):
 *   1. A cross-chapter scan of a valid credential must return the four public facts
 *      ONLY — never FullName/MemberNumber/BloodTypeName. This is CLAUDE.md invariant #7
 *      and is usp_Credential_VerifyForMember's entire reason for existing over
 *      usp_Credential_VerifyPublic.
 *   2. A same-chapter scan must open the gate for the case it should — proving the
 *      procedure isn't accidentally closed for everyone.
 *   3. Anti-enumeration must hold for the AUTHENTICATED in-app path too, not just the
 *      public one: unknown/revoked/expired all collapse to one identical shape.
 *   4. Every VerifyForMemberAsync call is audited exactly once (invariant #10), and the
 *      self scan-history read (usp_ScanLog_ListForSelf) never leaks another member's rows.
 *
 * WHAT THIS SUITE OWNS AND TEARS DOWN: two dedicated ZZTEST chapters, both parented
 * under the real seeded 'National Council' (same anchor IdCardExportScopeTests.cs uses),
 * and a set of dedicated ZZTEST members/credentials — one per scenario, so no two test
 * methods share a credential whose ScanLog history the other could pollute. Nothing here
 * touches the real seeded chapter's own 5 members (db/seed/02_demo_chapter.sql) or their
 * credential state.
 */
public sealed class CredentialVerificationDbFixture : IAsyncLifetime
{
    public string? ConnectionString { get; } = ChatDbTestConfig.ConnectionString;

    public int ChapterAId { get; private set; }
    public int ChapterBId { get; private set; }

    // ---- Scope-leak scenario (cases 1 & 2) ----
    public int ScannerMemberId { get; private set; }                 // Chapter A — the one calling VerifyForMemberAsync
    public int SameChapterTargetMemberId { get; private set; }       // Chapter A — same chapter as the scanner
    public Guid SameChapterTargetToken { get; private set; }
    public string SameChapterTargetFullName { get; private set; } = "";
    public string SameChapterTargetMemberNumber { get; private set; } = "";
    public int CrossChapterTargetMemberId { get; private set; }      // Chapter B — different chapter than the scanner
    public Guid CrossChapterTargetToken { get; private set; }

    // ---- Anti-enumeration scenario (case 3) ----
    public Guid RevokedToken { get; private set; }
    public Guid ExpiredToken { get; private set; }

    // ---- Audit-write scenario (case 4) — a credential untouched by any other test ----
    public int SoleScanTargetMemberId { get; private set; }
    public Guid SoleScanTargetToken { get; private set; }

    // ---- Self-scan-history scoping scenario (case 5) ----
    public int ListSelfMemberAId { get; private set; }
    public Guid ListSelfMemberAToken { get; private set; }
    public int ListSelfMemberBId { get; private set; }
    public Guid ListSelfMemberBToken { get; private set; }

    // ---- Anonymous-scan-shows-as-null scenario (case 6) ----
    public int AnonScanTargetMemberId { get; private set; }
    public Guid AnonScanTargetToken { get; private set; }

    // ---- Photo-lookup failure scenarios (case 7) ----
    public int NoPhotoMemberId { get; private set; }                 // valid credential, PhotoPath IS NULL
    public Guid NoPhotoToken { get; private set; }
    public int MissingOnDiskPhotoMemberId { get; private set; }      // valid credential, PhotoPath set but no file exists anywhere
    public Guid MissingOnDiskPhotoToken { get; private set; }
    public string MissingOnDiskRelativePath { get; } = "zztest-missing-" + Guid.NewGuid().ToString("N") + ".jpg";

    public List<int> AllMemberIds { get; } = [];

    public async Task InitializeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        var nationalCouncilId = await conn.ExecuteScalarAsync<int>(
            "SELECT CouncilId FROM dbo.Council WHERE CouncilName = N'National Council'");
        nationalCouncilId.Should().NotBe(0, "expected seed data (db/seed/02_demo_chapter.sql) not found");

        var activeStatusId = await conn.ExecuteScalarAsync<int>(
            "SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = N'Active'");
        var bloodTypeOPlusId = await conn.ExecuteScalarAsync<int>(
            "SELECT BloodTypeId FROM dbo.BloodType WHERE BloodTypeName = N'O+'");

        ChapterAId = await InsertChapter(conn, nationalCouncilId, "ZZTEST-CredVerify-ChapterA");
        ChapterBId = await InsertChapter(conn, nationalCouncilId, "ZZTEST-CredVerify-ChapterB");

        ScannerMemberId = await InsertMember(conn, ChapterAId, "Scanner", "Scanner", activeStatusId, null);

        SameChapterTargetFullName = "ZZFIRST ZZLAST-SameChapterTarget";
        SameChapterTargetMemberId = await InsertMember(
            conn, ChapterAId, "ZZFIRST", "ZZLAST-SameChapterTarget", activeStatusId, bloodTypeOPlusId);
        SameChapterTargetMemberNumber = await GetMemberNumber(conn, SameChapterTargetMemberId);
        SameChapterTargetToken = await InsertLiveCredential(conn, SameChapterTargetMemberId);

        CrossChapterTargetMemberId = await InsertMember(conn, ChapterBId, "ZZFIRST", "ZZLAST-CrossChapterTarget", activeStatusId, bloodTypeOPlusId);
        CrossChapterTargetToken = await InsertLiveCredential(conn, CrossChapterTargetMemberId);

        var revokedMemberId = await InsertMember(conn, ChapterBId, "ZZFIRST", "ZZLAST-Revoked", activeStatusId, null);
        RevokedToken = await InsertRevokedCredential(conn, revokedMemberId);

        var expiredMemberId = await InsertMember(conn, ChapterBId, "ZZFIRST", "ZZLAST-Expired", activeStatusId, null);
        ExpiredToken = await InsertExpiredCredential(conn, expiredMemberId);

        SoleScanTargetMemberId = await InsertMember(conn, ChapterBId, "ZZFIRST", "ZZLAST-SoleScanTarget", activeStatusId, null);
        SoleScanTargetToken = await InsertLiveCredential(conn, SoleScanTargetMemberId);

        ListSelfMemberAId = await InsertMember(conn, ChapterAId, "ZZFIRST", "ZZLAST-ListSelfA", activeStatusId, null);
        ListSelfMemberAToken = await InsertLiveCredential(conn, ListSelfMemberAId);
        ListSelfMemberBId = await InsertMember(conn, ChapterBId, "ZZFIRST", "ZZLAST-ListSelfB", activeStatusId, null);
        ListSelfMemberBToken = await InsertLiveCredential(conn, ListSelfMemberBId);

        AnonScanTargetMemberId = await InsertMember(conn, ChapterAId, "ZZFIRST", "ZZLAST-AnonScanTarget", activeStatusId, null);
        AnonScanTargetToken = await InsertLiveCredential(conn, AnonScanTargetMemberId);

        NoPhotoMemberId = await InsertMember(conn, ChapterAId, "ZZFIRST", "ZZLAST-NoPhoto", activeStatusId, null);
        NoPhotoToken = await InsertLiveCredential(conn, NoPhotoMemberId);

        MissingOnDiskPhotoMemberId = await InsertMember(conn, ChapterAId, "ZZFIRST", "ZZLAST-MissingOnDisk", activeStatusId, null);
        MissingOnDiskPhotoToken = await InsertLiveCredential(conn, MissingOnDiskPhotoMemberId);
        await conn.ExecuteAsync(
            "UPDATE dbo.Member SET PhotoPath = @path, PhotoContentType = N'image/jpeg' WHERE MemberId = @id",
            new { path = MissingOnDiskRelativePath, id = MissingOnDiskPhotoMemberId });

        AllMemberIds.AddRange([
            ScannerMemberId, SameChapterTargetMemberId, CrossChapterTargetMemberId,
            revokedMemberId, expiredMemberId, SoleScanTargetMemberId,
            ListSelfMemberAId, ListSelfMemberBId, AnonScanTargetMemberId,
            NoPhotoMemberId, MissingOnDiskPhotoMemberId,
        ]);
    }

    public async Task DisposeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        await conn.ExecuteAsync(
            """
            DELETE sl
            FROM   dbo.ScanLog sl
                   LEFT JOIN dbo.MemberCredential mc ON mc.CredentialId = sl.CredentialId
            WHERE  sl.ScannedByMemberId IN @AllMemberIds
               OR  mc.MemberId IN @AllMemberIds;
            DELETE FROM dbo.MemberCredential WHERE MemberId IN @AllMemberIds;
            DELETE FROM dbo.Member WHERE MemberId IN @AllMemberIds;
            """,
            new { AllMemberIds });

        await conn.ExecuteAsync(
            "DELETE FROM dbo.Chapter WHERE ChapterId IN @ids", new { ids = new[] { ChapterAId, ChapterBId } });
    }

    private static async Task<int> InsertChapter(SqlConnection conn, int parentCouncilId, string chapterName) =>
        await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Chapter (ParentCouncilId, ChapterName, Barangay, SuggestedContribution)
            OUTPUT INSERTED.ChapterId
            VALUES (@parentCouncilId, @chapterName, N'ZZTEST', 0)
            """,
            new { parentCouncilId, chapterName });

    private static async Task<int> InsertMember(
        SqlConnection conn, int chapterId, string firstName, string lastName, int activeStatusId, int? bloodTypeId)
    {
        var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        return await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, MemberNumber, FirstName, LastName, GiftName, BloodTypeId, StatusId)
            OUTPUT INSERTED.MemberId
            VALUES (@chapterId, @memberNumber, @firstName, @lastName, @giftName, @bloodTypeId, @activeStatusId)
            """,
            new { chapterId, memberNumber, firstName, lastName, giftName = "ZZTEST-" + lastName, bloodTypeId, activeStatusId });
    }

    private static async Task<string> GetMemberNumber(SqlConnection conn, int memberId) =>
        await conn.ExecuteScalarAsync<string>(
            "SELECT MemberNumber FROM dbo.Member WHERE MemberId = @memberId", new { memberId })
        ?? throw new InvalidOperationException("Member just inserted by this fixture was not found.");

    private static async Task<Guid> InsertLiveCredential(SqlConnection conn, int memberId) =>
        await conn.ExecuteScalarAsync<Guid>(
            """
            INSERT dbo.MemberCredential (MemberId, ExpiryDate)
            OUTPUT INSERTED.TokenSubject
            VALUES (@memberId, DATEADD(YEAR, 1, SYSUTCDATETIME()))
            """,
            new { memberId });

    private static async Task<Guid> InsertRevokedCredential(SqlConnection conn, int memberId) =>
        await conn.ExecuteScalarAsync<Guid>(
            """
            INSERT dbo.MemberCredential (MemberId, ExpiryDate, RevokedDate)
            OUTPUT INSERTED.TokenSubject
            VALUES (@memberId, DATEADD(YEAR, 1, SYSUTCDATETIME()), SYSUTCDATETIME())
            """,
            new { memberId });

    private static async Task<Guid> InsertExpiredCredential(SqlConnection conn, int memberId) =>
        await conn.ExecuteScalarAsync<Guid>(
            """
            INSERT dbo.MemberCredential (MemberId, ExpiryDate)
            OUTPUT INSERTED.TokenSubject
            VALUES (@memberId, DATEADD(DAY, -1, SYSUTCDATETIME()))
            """,
            new { memberId });
}

[CollectionDefinition("CredentialVerificationDb")]
public sealed class CredentialVerificationDbCollection : ICollectionFixture<CredentialVerificationDbFixture>;

[Collection("CredentialVerificationDb")]
public class CredentialVerificationScopeLeakTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly CredentialVerificationDbFixture _fx;

    public CredentialVerificationScopeLeakTests(CredentialVerificationDbFixture fx) => _fx = fx;

    private static ICredentialRepository BuildCredentialRepository(string connectionString) =>
        new CredentialRepository(new SqlConnectionFactory(connectionString));

    private static IScanLogRepository BuildScanLogRepository(string connectionString) =>
        new ScanLogRepository(new SqlConnectionFactory(connectionString));

    // ---- 1. THE point of the whole proc: cross-chapter scan hides the three extra fields. ----

    [SkippableFact]
    public async Task Cross_chapter_scan_of_a_valid_credential_hides_full_name_member_number_and_blood_type()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = BuildCredentialRepository(_fx.ConnectionString!);

        var result = await repo.VerifyForMemberAsync(
            _fx.CrossChapterTargetToken, _fx.ScannerMemberId, wasOffline: false, deviceHint: null, CancellationToken.None);

        result.IsValid.Should().BeTrue();
        result.IsSameChapter.Should().BeFalse();

        // The four public facts still come through — this is a valid, live credential.
        result.GiftName.Should().NotBeNullOrWhiteSpace();
        result.ChapterName.Should().NotBeNullOrWhiteSpace();
        result.StatusName.Should().NotBeNullOrWhiteSpace();

        // Invariant #7: cross-chapter data is name/chapter/status only. A regression here
        // leaks a stranger's legal name, member number and blood type across chapter lines.
        result.FullName.Should().BeNull(
            "a scanner from a different chapter must never see a stranger's legal name");
        result.MemberNumber.Should().BeNull(
            "a scanner from a different chapter must never see a stranger's member number");
        result.BloodTypeName.Should().BeNull(
            "a scanner from a different chapter must never see a stranger's blood type");
    }

    // ---- 2. The gate actually OPENS for the case it should — not just closed for everyone. ----

    [SkippableFact]
    public async Task Same_chapter_scan_of_a_valid_credential_reveals_full_name_member_number_and_blood_type()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = BuildCredentialRepository(_fx.ConnectionString!);

        var result = await repo.VerifyForMemberAsync(
            _fx.SameChapterTargetToken, _fx.ScannerMemberId, wasOffline: false, deviceHint: null, CancellationToken.None);

        result.IsValid.Should().BeTrue();
        result.IsSameChapter.Should().BeTrue();
        result.FullName.Should().Be(_fx.SameChapterTargetFullName);
        result.MemberNumber.Should().Be(_fx.SameChapterTargetMemberNumber);
        result.BloodTypeName.Should().Be("O+");
    }

    // ---- 3. Anti-enumeration on the AUTHENTICATED path too. ----

    [SkippableTheory]
    [InlineData("Unknown")]
    [InlineData("Revoked")]
    [InlineData("Expired")]
    public async Task Unknown_revoked_and_expired_tokens_all_collapse_to_the_identical_null_shape(string kind)
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = BuildCredentialRepository(_fx.ConnectionString!);

        var token = kind switch
        {
            "Unknown" => Guid.NewGuid(),
            "Revoked" => _fx.RevokedToken,
            "Expired" => _fx.ExpiredToken,
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };

        var result = await repo.VerifyForMemberAsync(
            token, _fx.ScannerMemberId, wasOffline: false, deviceHint: null, CancellationToken.None);

        result.IsValid.Should().BeFalse();
        result.IsSameChapter.Should().BeFalse();
        result.GiftName.Should().BeNull();
        result.ChapterName.Should().BeNull();
        result.StatusName.Should().BeNull();
        result.RenewedThrough.Should().BeNull();
        result.FullName.Should().BeNull();
        result.MemberNumber.Should().BeNull();
        result.BloodTypeName.Should().BeNull();
    }

    // ---- 4. Every call writes exactly one audit row, correctly attributed. ----

    [SkippableFact]
    public async Task VerifyForMemberAsync_writes_exactly_one_ScanLog_row_attributed_to_the_scanning_member()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();
        var repo = BuildCredentialRepository(_fx.ConnectionString!);

        await repo.VerifyForMemberAsync(
            _fx.SoleScanTargetToken, _fx.ScannerMemberId, wasOffline: false, deviceHint: "ZZTEST-device", CancellationToken.None);

        var rows = (await conn.QueryAsync<(int? CredentialId, int? ScannedByMemberId, string ResultCode)>(
            """
            SELECT sl.CredentialId, sl.ScannedByMemberId, sl.ResultCode
            FROM   dbo.ScanLog sl
                   JOIN dbo.MemberCredential mc ON mc.CredentialId = sl.CredentialId
            WHERE  mc.MemberId = @MemberId
            """,
            new { MemberId = _fx.SoleScanTargetMemberId })).ToList();

        rows.Should().ContainSingle("exactly one ScanLog row must be written per VerifyForMemberAsync call");
        rows[0].ScannedByMemberId.Should().Be(_fx.ScannerMemberId);
        rows[0].ResultCode.Should().Be("Live");
    }

    // ---- 5. Self scan-history never leaks another member's rows. ----

    [SkippableFact]
    public async Task ListForSelfAsync_never_returns_another_members_scan_history()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var credentialRepo = BuildCredentialRepository(_fx.ConnectionString!);
        var scanLogRepo = BuildScanLogRepository(_fx.ConnectionString!);

        // Both A and B get scanned by the same scanner.
        await credentialRepo.VerifyForMemberAsync(_fx.ListSelfMemberAToken, _fx.ScannerMemberId, false, "ZZTEST-A", CancellationToken.None);
        await credentialRepo.VerifyForMemberAsync(_fx.ListSelfMemberBToken, _fx.ScannerMemberId, false, "ZZTEST-B", CancellationToken.None);

        var aHistory = await scanLogRepo.ListForSelfAsync(_fx.ListSelfMemberAId, pageSize: 50, pageNumber: 1, CancellationToken.None);

        aHistory.Should().ContainSingle("member A's own dedicated credential was scanned exactly once by this test");
        // The only correctness signal usp_ScanLog_ListForSelf exposes about WHICH credential
        // a row belongs to is the join itself (no CredentialId column comes back) — the
        // absence of a second row here, after B was also scanned, is exactly the leak this
        // test exists to catch.
    }

    // ---- 6. An anonymous public-page scan shows scanner fields as null, not a sentinel. ----

    [SkippableFact]
    public async Task ListForSelfAsync_shows_an_anonymous_scan_with_both_scanner_fields_null()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var storage = BuildThrowawayFileStorage(out var cleanup);
        try
        {
            var publicRepo = new PublicVerificationRepository(new SqlConnectionFactory(_fx.ConnectionString!), storage);
            await publicRepo.VerifyAsync(_fx.AnonScanTargetToken, wasOffline: false, deviceHint: null, CancellationToken.None);

            var scanLogRepo = BuildScanLogRepository(_fx.ConnectionString!);
            var history = await scanLogRepo.ListForSelfAsync(_fx.AnonScanTargetMemberId, pageSize: 10, pageNumber: 1, CancellationToken.None);

            history.Should().ContainSingle();
            history[0].ScannerGiftName.Should().BeNull(
                "an anonymous public-page scan must write ScannedByMemberId = NULL, never a sentinel");
            history[0].ScannerChapterName.Should().BeNull();
        }
        finally
        {
            cleanup();
        }
    }

    // ---- 7. GetPhotoAsync throws the identical exception for every failure case. ----

    [SkippableFact]
    public async Task GetPhotoAsync_throws_PhotoNotFoundException_for_an_unknown_token()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var storage = BuildThrowawayFileStorage(out var cleanup);
        try
        {
            var publicRepo = new PublicVerificationRepository(new SqlConnectionFactory(_fx.ConnectionString!), storage);

            var act = async () => await publicRepo.GetPhotoAsync(Guid.NewGuid(), CancellationToken.None);

            await act.Should().ThrowAsync<PhotoNotFoundException>();
        }
        finally
        {
            cleanup();
        }
    }

    [SkippableFact]
    public async Task GetPhotoAsync_throws_PhotoNotFoundException_for_a_member_with_no_PhotoPath_at_all()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var storage = BuildThrowawayFileStorage(out var cleanup);
        try
        {
            var publicRepo = new PublicVerificationRepository(new SqlConnectionFactory(_fx.ConnectionString!), storage);

            var act = async () => await publicRepo.GetPhotoAsync(_fx.NoPhotoToken, CancellationToken.None);

            await act.Should().ThrowAsync<PhotoNotFoundException>();
        }
        finally
        {
            cleanup();
        }
    }

    /// <summary>
    /// The database resolves a PhotoPath (a valid, live credential's member genuinely has
    /// one on file) but the file itself does not exist on THIS environment's disk
    /// (CLAUDE.md §8.12 — photo storage is local per deployment, the database is shared).
    /// Proven for real, not just by inspection: a fresh, empty temp directory stands in for
    /// "this environment's disk" and the DB row's PhotoPath points at a filename that was
    /// never written into it.
    /// </summary>
    [SkippableFact]
    public async Task GetPhotoAsync_throws_the_identical_PhotoNotFoundException_when_the_resolved_file_is_missing_from_disk()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var storage = BuildThrowawayFileStorage(out var cleanup);
        try
        {
            var publicRepo = new PublicVerificationRepository(new SqlConnectionFactory(_fx.ConnectionString!), storage);

            var act = async () => await publicRepo.GetPhotoAsync(_fx.MissingOnDiskPhotoToken, CancellationToken.None);

            await act.Should().ThrowAsync<PhotoNotFoundException>(
                "a DB-resolved PhotoPath missing from this environment's disk must be indistinguishable " +
                "from every other 'nothing to show' case — never a 500");
        }
        finally
        {
            cleanup();
        }
    }

    private static IFileStorage BuildThrowawayFileStorage(out Action cleanup)
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "ZZTEST-CredVerify-" + Guid.NewGuid().ToString("N"));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Storage:UploadPath"] = tempRoot })
            .Build();
        var storage = new LocalFileStorage(config);
        cleanup = () =>
        {
            if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, recursive: true);
        };
        return storage;
    }
}
