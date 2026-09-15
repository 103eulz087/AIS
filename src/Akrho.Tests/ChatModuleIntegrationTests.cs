using System.Data;
using System.Security.Claims;
using System.Text.Json;
using Akrho.Api.Features.Chat;
using Akrho.Api.Features.Conversations;
using Akrho.Infrastructure.Repositories;
using Dapper;
using FluentAssertions;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Akrho.Tests;

/*
 * Public chat — scope-leak suite (task 24) and audit/integrity suite (task 25).
 *
 * This project has zero integration-test infrastructure (no WebApplicationFactory/TestServer,
 * no DB-backed fixture — see Akrho.Tests.csproj before this file: xunit/FluentAssertions/
 * Test.Sdk only, until the two additions this file's own edit made: a ProjectReference to
 * Akrho.Api — needed only for the ChatDtos reflection test and to construct a real ChatHub —
 * and a FrameworkReference to Microsoft.AspNetCore.App that Akrho.Api's own Sdk.Web project
 * type pulls in transitively for SignalR/HTTP types). Everything below that genuinely needs a
 * database talks to the shared dev/test SQL Server documented in CLAUDE.md §10
 * (corex.itcoreapps.com,6601 / AISDB) directly via Dapper + Microsoft.Data.SqlClient — the
 * same packages Akrho.Infrastructure already references, flowing transitively through the
 * existing ProjectReference. No stored procedure, schema, or non-test source file is modified
 * by this change.
 *
 * CONNECTION STRING: ChatDbTestConfig below resolves it the same way CLAUDE.md §10 documents —
 * the ConnectionStrings__Akrho environment variable first, falling back to reading (never
 * printing) src/Akrho.Api/appsettings.Development.local.json if present. If neither is
 * available, every DB-backed test in this file reports as genuinely SKIPPED — not a silent
 * early-return "pass" — via the Xunit.SkippableFact package ([SkippableFact]/[SkippableTheory]
 * + Skip.If). xunit 2.9.2 (this project's version) has no Assert.Skip of its own — that is a
 * v3 feature — so a plain early `return` from a [Fact] is recorded as Passed, which would make
 * this entire suite silently vacuous in CI (no ConnectionStrings__Akrho, no SQL Server
 * provisioned there). SkippableFact fixes that: the test genuinely reports Skipped in the run
 * summary. The pure unit tests (ChatHub group assignment, DTO shape reflection) never touch the
 * database, need none of this, and always run.
 *
 * TEST DATA / CLEANUP: the shared DB currently seeds exactly ONE chapter (db/seed/02_demo_chapter.sql,
 * "Brgy. San Isidro Chapter", ChapterId=1) with 8 active members — there was no second chapter
 * to "look up" for a scope-leak test as originally assumed; see this class's own exploration
 * output, and the report accompanying this change. "Chapter A" below is therefore that REAL
 * seeded chapter (nothing created, nothing to clean up for it): AKR-04-0117-001 (TANGLAW,
 * seeded as ChapterAdmin) as its officer, AKR-04-0117-002 (BAGWIS) as an ordinary member.
 * "Chapter B" does not exist anywhere yet, so ChatDbFixture creates ONE dedicated,
 * unmistakably-named chapter+member for it ("ZZTEST-ChatScope-ChapterB" / member number
 * prefixed "ZZTEST-") and deletes both, plus every chat row hung off them, in DisposeAsync.
 * Every individual test that posts a message into either chapter's room deletes that message
 * (and its flags/audit rows) itself in a finally block — no test leaves chat content behind in
 * chapter 1's real, shared room, and no test depends on another test's data.
 */

/// <summary>
/// Resolves the shared dev database connection string. See this file's header comment for the
/// resolution order and why a missing connection string is not a test failure.
/// </summary>
internal static class ChatDbTestConfig
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

    private static string? FindRepoRoot(string startDir)
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

/// <summary>
/// Small proc-calling helpers shared by every DB-backed test class below. Every call here goes
/// through a named stored procedure via Dapper (CommandType.StoredProcedure) — the one
/// exception in this whole file is the CHECK-constraint pin at the bottom of
/// <see cref="ChatAuditIntegrityTests"/>, called out explicitly where it happens.
/// </summary>
internal static class ChatDbTestHelpers
{
    /// <summary>
    /// usp_ChatMessage_Post now takes a REQUIRED dbo.IntList @Mentions table-valued parameter
    /// (Chat module slice 2 — mentions) — SQL Server allows no default on a TVP, so this always
    /// passes one, empty here since none of this suite's fixtures exercise mentions. The proc
    /// also now returns TWO result sets (the message row, unchanged shape, then zero-or-more
    /// verified mention MemberIds) — QueryMultiple reads both, but only the message row is
    /// this helper's own concern.
    /// </summary>
    public static async Task<ChatMessageRow> PostAsync(SqlConnection conn, int chapterId, int memberId, string body)
    {
        var emptyMentions = new DataTable();
        emptyMentions.Columns.Add("Value", typeof(int));

        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
            "dbo.usp_ChatMessage_Post",
            new
            {
                ChapterId = chapterId,
                RequestingMemberId = memberId,
                Body = body,
                Ip = (string?)null,
                Mentions = emptyMentions.AsTableValuedParameter("dbo.IntList")
            },
            commandType: CommandType.StoredProcedure));

        return await multi.ReadSingleAsync<ChatMessageRow>();
    }

    /// <summary>
    /// Removes everything this suite could have written for one message: its flags, every
    /// AuditLog row keyed to it (regardless of which action wrote it — Post/Flag/Delete/
    /// ResolveFlags all share the same TableName='ChatMessage' + RecordId), and the message
    /// itself. Deliberately a hard DELETE even though the application never exposes one for
    /// ChatMessage (db/schema/14_chat.sql header comment #1) — this is test-fixture hygiene
    /// against a SHARED dev database, run directly against the DB, never through any API or
    /// proc a real user could reach. It does not weaken or contradict the "no hard delete"
    /// application invariant.
    /// </summary>
    public static Task CleanupMessageAsync(SqlConnection conn, int messageId) =>
        conn.ExecuteAsync(
            """
            DELETE FROM dbo.ChatMessageFlag WHERE MessageId = @messageId;
            DELETE FROM dbo.AuditLog WHERE TableName = 'ChatMessage' AND RecordId = @messageIdText;
            DELETE FROM dbo.ChatMessage WHERE MessageId = @messageId;
            """,
            new { messageId, messageIdText = messageId.ToString() });
}

/// <summary>
/// Chapter A is the real seeded chapter (db/seed/02_demo_chapter.sql) — nothing created,
/// nothing to tear down for it. Chapter B does not exist in the shared dev DB today (see this
/// file's header comment), so this fixture creates one dedicated, unmistakably-named chapter
/// and member for it, and removes every trace of both in <see cref="DisposeAsync"/>.
/// </summary>
public sealed class ChatDbFixture : IAsyncLifetime
{
    public string? ConnectionString { get; } = ChatDbTestConfig.ConnectionString;

    public int ChapterAId { get; private set; }
    public int ChapterAOfficerId { get; private set; }   // AKR-04-0117-001 / TANGLAW / ChapterAdmin
    public int ChapterAMemberId { get; private set; }    // AKR-04-0117-002 / BAGWIS / plain member

    public int ChapterBId { get; private set; }
    public int ChapterBMemberId { get; private set; }

    public async Task InitializeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        ChapterAId = await conn.ExecuteScalarAsync<int>(
            "SELECT ChapterId FROM dbo.Chapter WHERE ChapterName = N'Brgy. San Isidro Chapter'");
        ChapterAOfficerId = await conn.ExecuteScalarAsync<int>(
            "SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-001'");
        ChapterAMemberId = await conn.ExecuteScalarAsync<int>(
            "SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-002'");

        if (ChapterAId == 0 || ChapterAOfficerId == 0 || ChapterAMemberId == 0)
            throw new InvalidOperationException(
                "Expected seed data (db/seed/02_demo_chapter.sql) not found in the configured database — " +
                "cannot run the Chat scope-leak/audit integration suite against it.");

        var parentCouncilId = await conn.ExecuteScalarAsync<int>(
            "SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @ChapterAId", new { ChapterAId });
        var activeStatusId = await conn.ExecuteScalarAsync<int>(
            "SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = N'Active'");

        ChapterBId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Chapter (ParentCouncilId, ChapterName, Barangay, SuggestedContribution)
            OUTPUT INSERTED.ChapterId
            VALUES (@parentCouncilId, N'ZZTEST-ChatScope-ChapterB', N'ZZTEST', 0)
            """,
            new { parentCouncilId });

        var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
        ChapterBMemberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (ChapterId, MemberNumber, FirstName, LastName, GiftName, StatusId)
            OUTPUT INSERTED.MemberId
            VALUES (@ChapterBId, @memberNumber, N'ZZTEST', N'ZZTEST', N'ZZTEST-ChapterB-Member', @activeStatusId)
            """,
            new { ChapterBId, memberNumber, activeStatusId });
    }

    public async Task DisposeAsync()
    {
        if (ConnectionString is null) return;

        using var conn = new SqlConnection(ConnectionString);
        await conn.OpenAsync();

        // Deletion order respects FK dependencies: flags -> audit rows for those messages ->
        // participant rows -> messages -> audit rows for the room -> the room -> the member ->
        // the chapter. Scoped entirely to ChapterBId; chapter A (real seed data) is never
        // touched here.
        await conn.ExecuteAsync(
            """
            DELETE f FROM dbo.ChatMessageFlag f
              JOIN dbo.ChatMessage cm ON cm.MessageId = f.MessageId
              JOIN dbo.ChatRoom cr ON cr.RoomId = cm.RoomId
             WHERE cr.ChapterId = @ChapterBId;

            DELETE al FROM dbo.AuditLog al
             WHERE al.TableName = 'ChatMessage'
               AND al.RecordId IN (
                    SELECT CAST(cm.MessageId AS NVARCHAR(40))
                    FROM dbo.ChatMessage cm JOIN dbo.ChatRoom cr ON cr.RoomId = cm.RoomId
                    WHERE cr.ChapterId = @ChapterBId);

            DELETE cp FROM dbo.ChatParticipant cp
              JOIN dbo.ChatRoom cr ON cr.RoomId = cp.RoomId
             WHERE cr.ChapterId = @ChapterBId;

            DELETE cm FROM dbo.ChatMessage cm
              JOIN dbo.ChatRoom cr ON cr.RoomId = cm.RoomId
             WHERE cr.ChapterId = @ChapterBId;

            DELETE al2 FROM dbo.AuditLog al2
             WHERE al2.TableName = 'ChatRoom'
               AND al2.RecordId IN (SELECT CAST(RoomId AS NVARCHAR(40)) FROM dbo.ChatRoom WHERE ChapterId = @ChapterBId);

            DELETE FROM dbo.ChatRoom WHERE ChapterId = @ChapterBId;
            DELETE FROM dbo.Member WHERE ChapterId = @ChapterBId;
            DELETE FROM dbo.Chapter WHERE ChapterId = @ChapterBId;
            """,
            new { ChapterBId });
    }
}

[CollectionDefinition("ChatDb")]
public sealed class ChatDbCollection : ICollectionFixture<ChatDbFixture>;

/// <summary>
/// Task 24 — scope leakage is the worst possible failure this system can have (CLAUDE.md
/// §"What to test first" #1). Every one of these calls the real stored procedure directly, by
/// name, over a real connection to the shared dev database — never through IChatRepository,
/// and never mocked — because the procedure IS the authorization boundary here, and mocking it
/// would test nothing.
/// </summary>
[Collection("ChatDb")]
public class ChatScopeLeakTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatScopeLeakTests(ChatDbFixture fx)
    {
        _fx = fx;
    }

    // --- Task 24.1 -----------------------------------------------------------------------

    /// <summary>
    /// The literal "GET /api/chapters/{B}/chat/messages as a member of chapter A -> 403" case
    /// needs a WebApplicationFactory/TestServer harness this repository does not have (see
    /// this file's header comment). Rather than fabricate an HTTP test double that doesn't
    /// exercise real ASP.NET Core routing/DI/auth — which would prove nothing but its own
    /// plumbing — this is left as a documented, deliberate skip (option (c) from the task
    /// brief): every handler in ChatEndpoints.cs calls
    /// <c>scope.EnsureChapter(caller, chapterId)</c> as its very first statement, before any
    /// IChatRepository call (see e.g. GetMessages/PostMessage/FlagMessage/... — all of them,
    /// read the file), and ScopeGuardTests.cs already proves that call throws
    /// ScopeViolationException for exactly this mismatch
    /// (Member_cannot_read_another_chapter_even_by_asking_for_it). The proc-level tests below
    /// prove the STRONGER claim anyway: even if EnsureChapter were ever accidentally deleted
    /// from a handler, the stored procedure itself still rejects the cross-chapter call.
    /// </summary>
    [Fact(Skip =
        "No WebApplicationFactory/TestServer harness exists in this repo to make a real HTTP call. " +
        "Source-verified instead (see this test's own XML doc) plus the proc-level tests below, " +
        "which prove the stronger defense-in-depth claim.")]
    public void HttpLevel_scope_check_is_source_verified_not_re_tested_here()
    {
    }

    // --- Task 24.2 — proc-level defense in depth --------------------------------------------

    /// <summary>
    /// A member of chapter A asking usp_ChatMessage_GetHistory for chapter B's history must be
    /// rejected by the PROCEDURE, independent of whatever the API layer does — this is what
    /// makes IScopeGuard defense in depth rather than the only lock on the door.
    /// </summary>
    [SkippableFact]
    public async Task GetHistory_requesting_member_from_a_different_chapter_throws_51271()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var act = () => conn.QueryAsync<ChatMessageRow>(new CommandDefinition(
            "dbo.usp_ChatMessage_GetHistory",
            new { ChapterId = _fx.ChapterBId, RequestingMemberId = _fx.ChapterAMemberId, BeforeMessageId = (int?)null, Take = 50 },
            commandType: CommandType.StoredProcedure));

        (await act.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(51271);
    }

    [SkippableFact]
    public async Task Post_requesting_member_from_a_different_chapter_throws_51272()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var act = () => ChatDbTestHelpers.PostAsync(conn, _fx.ChapterBId, _fx.ChapterAMemberId, "should never be inserted");

        // Nothing is created — the proc's membership check runs before any INSERT — so there
        // is nothing for this test to clean up afterwards.
        (await act.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(51272);
    }

    /// <summary>
    /// A member of the message's OWN chapter, just not an officer/admin of it, may not remove
    /// a message — Forbidden (51273), distinct from the anti-enumeration NotFound (51274) below.
    /// </summary>
    [SkippableFact]
    public async Task Delete_by_a_member_who_is_not_an_officer_throws_51273()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var posted = await ChatDbTestHelpers.PostAsync(conn, _fx.ChapterAId, _fx.ChapterAMemberId, "51273 fixture — not an officer");
        try
        {
            var act = () => conn.QuerySingleAsync<ChatMessageDeleteResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Delete",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAMemberId, Reason = "attempt by a non-officer", Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            (await act.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(51273);
        }
        finally
        {
            await ChatDbTestHelpers.CleanupMessageAsync(conn, posted.MessageId);
        }
    }

    /// <summary>
    /// Task 24.6's explicit combination: an OFFICER (real role, real term) of chapter A, acting
    /// on a message that belongs to chapter B — a chapter he isn't even a member of. Merged
    /// anti-enumeration means this comes back as the same generic "not found" (51274) as a
    /// message id that doesn't exist at all, not a distinct "wrong chapter" message that would
    /// let a caller map another chapter's message ids.
    /// </summary>
    [SkippableFact]
    public async Task Delete_by_an_officer_of_a_different_chapter_throws_51274()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var posted = await ChatDbTestHelpers.PostAsync(conn, _fx.ChapterBId, _fx.ChapterBMemberId, "51274 fixture — belongs to chapter B");
        try
        {
            var act = () => conn.QuerySingleAsync<ChatMessageDeleteResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Delete",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAOfficerId, Reason = "wrong chapter attempt", Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            (await act.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(51274);
        }
        finally
        {
            await ChatDbTestHelpers.CleanupMessageAsync(conn, posted.MessageId);
        }
    }

    /// <summary>
    /// Flagging is open to any active member of the message's own chapter — but a member of
    /// chapter B has no standing over a message that lives in chapter A's room at all. Merged
    /// anti-enumeration, same reasoning as 51274, its own code (51275).
    /// </summary>
    [SkippableFact]
    public async Task Flag_a_message_in_a_chapter_the_caller_is_not_a_member_of_throws_51275()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var posted = await ChatDbTestHelpers.PostAsync(conn, _fx.ChapterAId, _fx.ChapterAMemberId, "51275 fixture — belongs to chapter A");
        try
        {
            var act = () => conn.QuerySingleAsync<ChatMessageFlagResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Flag",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterBMemberId, Reason = (string?)null, Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            (await act.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(51275);
        }
        finally
        {
            await ChatDbTestHelpers.CleanupMessageAsync(conn, posted.MessageId);
        }
    }

    /// <summary>Task 24.7 — a plain member of chapter A has no standing to view chapter A's own moderation queue.</summary>
    [SkippableFact]
    public async Task GetFlagged_by_a_non_officer_throws_51276()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var act = () => conn.QueryAsync(new CommandDefinition(
            "dbo.usp_ChatMessage_GetFlagged",
            new { ChapterId = _fx.ChapterAId, RequestingMemberId = _fx.ChapterAMemberId, Skip = 0, Take = 50, IncludeResolved = false },
            commandType: CommandType.StoredProcedure));

        (await act.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(51276);
    }

    [SkippableFact]
    public async Task MarkRead_requesting_member_from_a_different_chapter_throws_51279()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var act = () => conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_ChatParticipant_MarkRead",
            new { ChapterId = _fx.ChapterBId, RequestingMemberId = _fx.ChapterAMemberId, LastReadMessageId = 1 },
            commandType: CommandType.StoredProcedure));

        (await act.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(51279);
    }

    // --- Task 24.8 — the single most important test in the whole suite ---------------------

    /// <summary>
    /// A removed message's real text must never reach anyone but an officer of the chapter it
    /// was removed from — withheld by usp_ChatMessage_GetHistory itself (Body -> NULL), never
    /// left for the API or the UI to filter after the fact. This is checked from BOTH sides in
    /// one test so a regression that makes it fail for either caller is caught: a plain member
    /// (including the very member who wrote the removed message) gets NULL; an officer of the
    /// same chapter gets the real text.
    /// </summary>
    [SkippableFact]
    public async Task Deleted_message_body_is_withheld_from_a_plain_member_but_visible_to_an_officer()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var marker = Guid.NewGuid().ToString("N");
        var body = $"soft-delete body-leak regression guard {marker}";
        var posted = await ChatDbTestHelpers.PostAsync(conn, _fx.ChapterAId, _fx.ChapterAMemberId, body);

        try
        {
            await conn.QuerySingleAsync<ChatMessageDeleteResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Delete",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAOfficerId, Reason = "integration test — soft-delete leak check", Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            var asPlainMember = await conn.QueryAsync<ChatMessageRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_GetHistory",
                new { ChapterId = _fx.ChapterAId, RequestingMemberId = _fx.ChapterAMemberId, BeforeMessageId = (int?)null, Take = 200 },
                commandType: CommandType.StoredProcedure));
            var plainRow = asPlainMember.Single(m => m.MessageId == posted.MessageId);
            plainRow.IsDeleted.Should().BeTrue();
            plainRow.Body.Should().BeNull("a plain member must never receive a removed message's body, even his own message");
            plainRow.CanSeeRemovedBody.Should().BeFalse();

            var asOfficer = await conn.QueryAsync<ChatMessageRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_GetHistory",
                new { ChapterId = _fx.ChapterAId, RequestingMemberId = _fx.ChapterAOfficerId, BeforeMessageId = (int?)null, Take = 200 },
                commandType: CommandType.StoredProcedure));
            var officerRow = asOfficer.Single(m => m.MessageId == posted.MessageId);
            officerRow.Body.Should().Be(body, "an officer of the message's own chapter must still see the real text, for moderation");
            officerRow.CanSeeRemovedBody.Should().BeTrue();
        }
        finally
        {
            await ChatDbTestHelpers.CleanupMessageAsync(conn, posted.MessageId);
        }
    }
}

/// <summary>
/// Task 25 — audit rows are the only permanent trace a chat action leaves. These tests exist
/// to catch two different regressions: (1) a write silently stops auditing, or starts
/// double-auditing, and (2) the message body — which AuditLog was deliberately designed to
/// never carry (see usp_ChatMessage_Post's own header comment, "D5") — leaks into NewValues.
/// </summary>
[Collection("ChatDb")]
public class ChatAuditIntegrityTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatAuditIntegrityTests(ChatDbFixture fx)
    {
        _fx = fx;
    }

    private static Task<List<(string? NewValues, int? PerformedBy)>> GetAuditRowsAsync(
        SqlConnection conn, int messageId, string action) =>
        conn.QueryAsync<(string? NewValues, int? PerformedBy)>(
                "SELECT NewValues, PerformedBy FROM dbo.AuditLog WHERE TableName = 'ChatMessage' AND RecordId = @recordId AND [Action] = @action",
                new { recordId = messageId.ToString(), action })
            .ContinueWith(t => t.Result.ToList());

    /// <summary>
    /// The regression guard task 25 calls out as highest value in this sub-suite: proves chat
    /// audit rows are metadata-only by using a deliberately distinctive, greppable body (a GUID)
    /// and asserting that GUID never appears in NewValues.
    /// </summary>
    [SkippableFact]
    public async Task Posting_a_message_writes_exactly_one_audit_row_and_never_the_body()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var marker = Guid.NewGuid().ToString("N");
        var body = $"audit metadata-only regression guard {marker}";
        var posted = await ChatDbTestHelpers.PostAsync(conn, _fx.ChapterAId, _fx.ChapterAMemberId, body);

        try
        {
            var rows = await GetAuditRowsAsync(conn, posted.MessageId, "Post");

            rows.Should().HaveCount(1, "posting a message must write exactly one AuditLog row for the Post action");
            rows[0].PerformedBy.Should().Be(_fx.ChapterAMemberId);
            rows[0].NewValues.Should().NotContain(marker,
                "AuditLog is permanent and chat is meant to purge eventually — the message body must never land in NewValues");
        }
        finally
        {
            await ChatDbTestHelpers.CleanupMessageAsync(conn, posted.MessageId);
        }
    }

    [SkippableFact]
    public async Task Removing_a_message_writes_exactly_one_audit_row_and_never_the_body()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var marker = Guid.NewGuid().ToString("N");
        var body = $"remove audit regression guard {marker}";
        var posted = await ChatDbTestHelpers.PostAsync(conn, _fx.ChapterAId, _fx.ChapterAMemberId, body);

        try
        {
            await conn.QuerySingleAsync<ChatMessageDeleteResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Delete",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAOfficerId, Reason = "audit regression test", Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            var rows = await GetAuditRowsAsync(conn, posted.MessageId, "Delete");

            rows.Should().HaveCount(1, "removing a message must write exactly one AuditLog row for the Delete action");
            rows[0].PerformedBy.Should().Be(_fx.ChapterAOfficerId);
            rows[0].NewValues.Should().NotContain(marker, "removal audit must not carry the message body either");
        }
        finally
        {
            await ChatDbTestHelpers.CleanupMessageAsync(conn, posted.MessageId);
        }
    }

    [SkippableFact]
    public async Task Resolving_flags_writes_exactly_one_audit_row_and_never_the_body()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var marker = Guid.NewGuid().ToString("N");
        var body = $"resolve-flags audit regression guard {marker}";
        var posted = await ChatDbTestHelpers.PostAsync(conn, _fx.ChapterAId, _fx.ChapterAMemberId, body);

        try
        {
            await conn.QuerySingleAsync<ChatMessageFlagResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Flag",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAOfficerId, Reason = "for audit regression test", Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            await conn.QuerySingleAsync<ChatMessageResolveFlagsResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_ResolveFlags",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAOfficerId, Note = "resolved for audit regression test", Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            var rows = await GetAuditRowsAsync(conn, posted.MessageId, "ResolveFlags");

            rows.Should().HaveCount(1, "resolving flags must write exactly one AuditLog row for the ResolveFlags action");
            rows[0].PerformedBy.Should().Be(_fx.ChapterAOfficerId);
            rows[0].NewValues.Should().NotContain(marker, "resolve-flags audit must not carry the message body either");
        }
        finally
        {
            await ChatDbTestHelpers.CleanupMessageAsync(conn, posted.MessageId);
        }
    }

    /// <summary>
    /// dbo.ChatMessageFlag's primary key (MessageId, MemberId) is what makes this a database
    /// guarantee, not an application convention — flagging twice from the SAME member is a
    /// silent no-op, proven here by calling the proc twice with identical parameters and
    /// comparing the FlagCount each call returns.
    /// </summary>
    [SkippableFact]
    public async Task Flagging_the_same_message_twice_by_the_same_member_does_not_inflate_FlagCount()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var posted = await ChatDbTestHelpers.PostAsync(conn, _fx.ChapterAId, _fx.ChapterAMemberId, "duplicate-flag fixture");

        try
        {
            var first = await conn.QuerySingleAsync<ChatMessageFlagResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Flag",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAOfficerId, Reason = "first flag", Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            var second = await conn.QuerySingleAsync<ChatMessageFlagResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Flag",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAOfficerId, Reason = "first flag", Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            first.FlagCount.Should().Be(1);
            second.FlagCount.Should().Be(1, "a second flag from the same member must be a silent no-op, not a second flag");
        }
        finally
        {
            await ChatDbTestHelpers.CleanupMessageAsync(conn, posted.MessageId);
        }
    }

    /// <summary>
    /// FlagCount is a permanent "ever flagged" count, never decremented — usp_ChatMessage_ResolveFlags
    /// closes out open flags but must not touch it (OpenFlagCount, from usp_ChatMessage_GetFlagged,
    /// is the live gauge instead).
    /// </summary>
    [SkippableFact]
    public async Task Resolving_flags_does_not_change_FlagCount()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var posted = await ChatDbTestHelpers.PostAsync(conn, _fx.ChapterAId, _fx.ChapterAMemberId, "resolve-does-not-decrement fixture");

        try
        {
            var flagged = await conn.QuerySingleAsync<ChatMessageFlagResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_Flag",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAOfficerId, Reason = "flag before resolve", Ip = (string?)null },
                commandType: CommandType.StoredProcedure));
            flagged.FlagCount.Should().Be(1);

            await conn.QuerySingleAsync<ChatMessageResolveFlagsResultRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_ResolveFlags",
                new { MessageId = posted.MessageId, RequestingMemberId = _fx.ChapterAOfficerId, Note = (string?)null, Ip = (string?)null },
                commandType: CommandType.StoredProcedure));

            var afterResolve = await conn.QueryAsync<ChatMessageRow>(new CommandDefinition(
                "dbo.usp_ChatMessage_GetHistory",
                new { ChapterId = _fx.ChapterAId, RequestingMemberId = _fx.ChapterAOfficerId, BeforeMessageId = (int?)null, Take = 200 },
                commandType: CommandType.StoredProcedure));

            afterResolve.Single(m => m.MessageId == posted.MessageId).FlagCount.Should().Be(1,
                "FlagCount reflects total-ever-raised and must never decrement, even after every open flag is resolved");
        }
        finally
        {
            await ChatDbTestHelpers.CleanupMessageAsync(conn, posted.MessageId);
        }
    }

    /// <summary>
    /// Confirmed decision D6: a scroll position carries no organizational weight, so
    /// usp_ChatParticipant_MarkRead writes NO AuditLog row — a regression here would silently
    /// start auditing something the team explicitly decided not to. Scoped to AuditLog rows
    /// created by THIS test's own member id after a captured high-water mark, so it isn't
    /// thrown off by unrelated concurrent activity elsewhere in the shared database.
    /// </summary>
    [SkippableFact]
    public async Task MarkRead_writes_zero_audit_rows()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var highWaterMark = await conn.ExecuteScalarAsync<long>("SELECT ISNULL(MAX(AuditId), 0) FROM dbo.AuditLog");

        await conn.ExecuteAsync(new CommandDefinition(
            "dbo.usp_ChatParticipant_MarkRead",
            new { ChapterId = _fx.ChapterAId, RequestingMemberId = _fx.ChapterAMemberId, LastReadMessageId = 1 },
            commandType: CommandType.StoredProcedure));

        var newRowsByThisMember = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.AuditLog WHERE AuditId > @highWaterMark AND PerformedBy = @memberId",
            new { highWaterMark, memberId = _fx.ChapterAMemberId });

        newRowsByThisMember.Should().Be(0, "marking a room read is a personal UI preference, not an organizational fact — it must never be audited");
    }

    /// <summary>
    /// Regression pin for CK_ChatMessage_BodyLength (db/schema/14_chat.sql). This is the ONE
    /// deliberate exception to "call procs only" in this file: it is not testing proc logic at
    /// all, it is testing the table's own CHECK constraint directly, because — see the report
    /// accompanying this change — calling usp_ChatMessage_Post itself with an oversized body
    /// does NOT reach this constraint. The proc's @Body parameter is declared NVARCHAR(2000);
    /// a longer value is silently truncated to 2000 characters by SQL Server at the RPC
    /// parameter-binding stage, before the procedure body ever runs, so the constraint is
    /// unreachable through that path (confirmed empirically while writing this suite — see the
    /// accompanying report). The API's own FluentValidation rule (ChatValidators.cs,
    /// PostMessageRequestValidator: MaximumLength(2000)) is the real, load-bearing gate in
    /// practice. This test proves the constraint still does its job for whatever DOES reach it
    /// directly — the same defense-in-depth reasoning as every proc-level check above, just one
    /// layer further down.
    /// </summary>
    [SkippableFact]
    public async Task ChatMessage_body_over_2000_characters_is_rejected_by_the_database_check_constraint()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var roomId = await conn.ExecuteScalarAsync<int>(
            "SELECT RoomId FROM dbo.ChatRoom WHERE ChapterId = @ChapterId AND RoomType = 'Public'",
            new { ChapterId = _fx.ChapterAId });
        roomId.Should().NotBe(0, "chapter A's Public room should already exist from earlier module smoke testing / this suite's own posts");

        var tooLong = new string('z', 2001);

        var act = () => conn.ExecuteAsync(
            "INSERT dbo.ChatMessage (RoomId, SenderId, Body) VALUES (@roomId, @senderId, @body)",
            new { roomId, senderId = _fx.ChapterAMemberId, body = tooLong });

        // Nothing to clean up regardless of outcome: the constraint either blocks the INSERT
        // (expected) or, if this ever regresses, the row it created would need real
        // investigation rather than silent test cleanup.
        (await act.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(547);
    }
}

/// <summary>
/// Task 24.3/24.4 — SignalR group isolation. A genuine TestServer + real HubConnection
/// round-trip would be the most faithful test, but there is zero existing precedent for that
/// harness shape in this codebase (see this file's header comment on the state of integration
/// testing here), so this instead constructs a real <see cref="ChatHub"/> directly and calls
/// its actual <see cref="Hub.OnConnectedAsync"/> override against a fake
/// <see cref="HubCallerContext"/>/<see cref="IGroupManager"/> pair that simply records which
/// groups a connection was added to. This exercises the REAL group-assignment logic in
/// ChatHub.cs — nothing about it is re-implemented or guessed — it just avoids standing up a
/// Kestrel/TestServer instance to do so. No database involved; these always run.
/// </summary>
public class ChatHubGroupIsolationTests
{
    private sealed class FakeGroupManager : IGroupManager
    {
        public List<(string ConnectionId, string GroupName)> Added { get; } = [];

        public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
        {
            Added.Add((connectionId, groupName));
            return Task.CompletedTask;
        }

        public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class FakeHubCallerContext(ClaimsPrincipal user) : HubCallerContext
    {
        public override string ConnectionId { get; } = "test-connection-1";
        public override string? UserIdentifier => null;
        public override ClaimsPrincipal User { get; } = user;
        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
        public override IFeatureCollection Features { get; } = new FeatureCollection();
        public override CancellationToken ConnectionAborted => CancellationToken.None;
        public override void Abort() { }
    }

    private static ClaimsPrincipal BuildUser(int? chapterId, bool isOfficer, int? memberId = null)
    {
        var claims = new List<Claim>();
        if (chapterId is { } c) claims.Add(new Claim("chp", c.ToString()));
        if (memberId is { } m) claims.Add(new Claim("mid", m.ToString()));
        if (isOfficer) claims.Add(new Claim(ClaimTypes.Role, "ChapterOfficer"));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType: "TestAuth"));
    }

    private static async Task<FakeGroupManager> ConnectAsync(ClaimsPrincipal user)
    {
        var groups = new FakeGroupManager();
        using var hub = new ChatHub { Context = new FakeHubCallerContext(user), Groups = groups };
        await hub.OnConnectedAsync();
        return groups;
    }

    [Fact]
    public async Task Connection_with_a_chapter_claim_joins_only_that_chapters_group()
    {
        var groups = await ConnectAsync(BuildUser(chapterId: 10, isOfficer: false));

        groups.Added.Select(a => a.GroupName).Should().BeEquivalentTo(["chapter-10"]);
        groups.Added.Should().OnlyContain(a => a.ConnectionId == "test-connection-1");
    }

    [Fact]
    public async Task Officer_connection_joins_its_chapter_group_and_that_chapters_officers_group_only()
    {
        var groups = await ConnectAsync(BuildUser(chapterId: 10, isOfficer: true));

        groups.Added.Select(a => a.GroupName).Should().BeEquivalentTo(["chapter-10", "chapter-10-officers"]);
    }

    [Fact]
    public async Task Non_officer_connection_never_joins_any_officers_group()
    {
        var groups = await ConnectAsync(BuildUser(chapterId: 10, isOfficer: false));

        groups.Added.Should().NotContain(a => a.GroupName.EndsWith("-officers"));
    }

    /// <summary>
    /// A connection with no "chp" claim at all is a detached, council-homed member
    /// (CLAUDE.md invariant #14) — not an error, just nothing to join.
    /// </summary>
    [Fact]
    public async Task Connection_with_no_chapter_claim_joins_no_group_and_does_not_throw()
    {
        FakeGroupManager? groups = null;
        var act = async () => groups = await ConnectAsync(BuildUser(chapterId: null, isOfficer: false));

        await act.Should().NotThrowAsync();
        groups!.Added.Should().BeEmpty();
    }

    /// <summary>A "chp" claim of 0 must be treated exactly like an absent one — not a valid chapter id.</summary>
    [Fact]
    public async Task Connection_with_a_chapter_claim_of_zero_joins_no_group()
    {
        var groups = await ConnectAsync(BuildUser(chapterId: 0, isOfficer: false));

        groups.Added.Should().BeEmpty();
    }

    /// <summary>
    /// Chat module slice 2 (Private chat/push): every connection also joins its own
    /// "member-{id}" group, from the SAME "mid" claim every REST call already trusts —
    /// independent of whatever chapter group it joins, because a Private conversation is not
    /// chapter-scoped at all.
    /// </summary>
    [Fact]
    public async Task Connection_with_a_member_claim_joins_its_own_member_group_in_addition_to_its_chapter_group()
    {
        var groups = await ConnectAsync(BuildUser(chapterId: 10, isOfficer: false, memberId: 42));

        groups.Added.Select(a => a.GroupName).Should().BeEquivalentTo(["chapter-10", "member-42"]);
    }

    /// <summary>A detached, council-homed member (no "chp" claim) still joins his own member group.</summary>
    [Fact]
    public async Task Connection_with_no_chapter_claim_still_joins_its_own_member_group()
    {
        var groups = await ConnectAsync(BuildUser(chapterId: null, isOfficer: false, memberId: 42));

        groups.Added.Select(a => a.GroupName).Should().BeEquivalentTo(["member-42"]);
    }

    /// <summary>No "mid" claim at all (should not happen for a real authenticated user) joins no member group, and does not throw.</summary>
    [Fact]
    public async Task Connection_with_no_member_claim_joins_no_member_group_and_does_not_throw()
    {
        var groups = await ConnectAsync(BuildUser(chapterId: 10, isOfficer: false));

        groups.Added.Select(a => a.GroupName).Should().BeEquivalentTo(["chapter-10"]);
    }
}

/// <summary>
/// Task 24.5 — a future "convenience" field on any of these request DTOs (a chapterId a client
/// could substitute, a senderId/memberId a client could impersonate) would reopen exactly the
/// scope hole CLAUDE.md invariant #4 exists to prevent. This reflects over the real types so a
/// change to ChatDtos.cs fails this test immediately, without anyone needing to remember why
/// the property must not exist.
/// </summary>
public class ChatDtoShapeTests
{
    private static readonly string[] ForbiddenNameFragments = ["chapterId", "roomId", "senderId", "memberId"];

    public static IEnumerable<object[]> RequestDtoTypes()
    {
        yield return [typeof(PostMessageRequest)];
        yield return [typeof(FlagMessageRequest)];
        yield return [typeof(RemoveMessageRequest)];
        yield return [typeof(ResolveFlagsRequest)];
        yield return [typeof(MarkReadRequest)];
        yield return [typeof(SetMuteRequest)];

        // Chat module slice 2 (Features/Conversations) — the SAME regression guard applies
        // with even more force here: these routes take no chapterId at all, by design (see
        // ConversationsEndpoints's own header comment), so a "convenience" identity/scope field
        // on any of these would be an even bigger departure from how this feature is supposed
        // to work than it would be for the Public module above.
        //
        // StartConversationRequest is deliberately NOT included here: its one property,
        // WithMemberId, legitimately names ANOTHER member (who to start a conversation with) —
        // the entire point of the endpoint — and would trip the "memberId" substring check
        // below for a reason unrelated to what that check actually guards against (a caller
        // overriding his OWN identity/scope). The real guard for that DTO is
        // usp_ChatRoom_EnsurePrivate's own same-chapter/self-conversation checks, proven in
        // ChatPrivateAndPushExceptionTests.
        yield return [typeof(PostPrivateMessageRequest)];
        yield return [typeof(MarkPrivateReadRequest)];
    }

    [Theory]
    [MemberData(nameof(RequestDtoTypes))]
    public void Request_dto_has_no_scope_or_identity_override_property(Type dtoType)
    {
        var propertyNames = dtoType.GetProperties().Select(p => p.Name).ToList();

        propertyNames.Should().NotContain(
            name => ForbiddenNameFragments.Any(f => name.Contains(f, StringComparison.OrdinalIgnoreCase)),
            $"{dtoType.Name} must derive the caller's identity/chapter from ICurrentUser and the route only, " +
            "never from a client-supplied property");
    }
}
