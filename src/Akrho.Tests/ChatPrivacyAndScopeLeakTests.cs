using System.Reflection;
using Akrho.Infrastructure;
using Akrho.Infrastructure.Push;
using Akrho.Infrastructure.Repositories;
using Dapper;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Xunit;

namespace Akrho.Tests;

/*
 * Chat module slice 2 (private chat + push) — the scope-leak / privacy suite the tech-lead
 * called out as not yet covered. This file adds ONLY what ChatPrivateAndPushIntegrationTests.cs
 * and ChatPrivateAndPushExceptionTests (in ChatExceptionTests.cs) do not already prove — both
 * were read in full before writing this file. In particular, NOT duplicated here:
 *   - EnsurePrivateRoom_across_chapters_throws_NotFound_category (cross-chapter rejection,
 *     tech-lead item 4) — already in ChatPrivateAndPushIntegrationTests.cs.
 *   - PostMessage_with_a_genuine_mention_is_verified_and_returned (tech-lead item 6e) — already
 *     in ChatPrivateAndPushIntegrationTests.cs.
 *   - The 51280-51285 SQL-error-to-category mapping pins — already in ChatExceptionTests.cs's
 *     ChatPrivateAndPushExceptionTests class.
 *
 * Reuses ChatDbFixture/"ChatDb" (ChatModuleIntegrationTests.cs) EXACTLY — same collection, same
 * fixture, same officer/member pair (AKR-04-0117-001/002) — rather than a second, parallel
 * fixture. This is deliberate, not merely for reuse's sake: usp_ChatRoom_EnsurePrivate's
 * canonical pair (MemberAId, MemberBId) is a real, globally-unique row for this specific
 * officer/member pair, and xunit only serializes tests that share ONE collection — a second
 * collection would be free to run concurrently against that SAME pair and race
 * ChatPrivateAndPushIntegrationTests.cs's own room-creating tests (this was caught empirically
 * while writing this file — see the accompanying report). Joining "ChatDb" is what makes this
 * suite's room-creating tests safe to run alongside that file's, not merely convenient.
 *
 * ChatDbFixture does not expose everything this suite needs (a third real member of chapter A
 * who is never a private-room participant, the parent council id, a member's gift name) — those
 * are resolved with small ad hoc queries via ChatPrivacyLookups below, once per test, rather than
 * by extending that fixture (out of scope for this task: "do not modify any file outside
 * src/Akrho.Tests" — technically this file IS in that folder, but ChatModuleIntegrationTests.cs
 * is a file this task's brief pointed at only to read, not to change).
 *
 * DB-backed tests use [SkippableFact]/Skip.If from the very first test written in this file —
 * genuinely reports Skipped (not a false-green early-return Pass) when no shared dev DB
 * connection string is configured, exactly like every other DB-backed test in this project.
 * Source-inspection tests (reflection over PushJob, grep over Features/, template-string checks
 * against PushDispatchHostedService.cs) need no database and are plain [Fact]s that always run.
 *
 * Everything this file creates beyond the real seeded chapter A (a second chapter, a detached
 * member, a chapter with 12 members for the mention cap, two throwaway chapter-A members for the
 * audit test) is created and torn down by the specific test that needs it, in a finally block —
 * no test in this file depends on another test's data, and nothing here mutates ChatDbFixture's
 * own ChapterB (only reads its already-seeded id/member).
 */
internal static class ChatPrivacyLookups
{
    /// <summary>AKR-04-0117-003 / LAKANDULA — a real, active member of chapter A never used as a participant in any private room this suite creates.</summary>
    public static Task<int> GetChapterAThirdMemberIdAsync(SqlConnection conn) =>
        conn.ExecuteScalarAsync<int>("SELECT MemberId FROM dbo.Member WHERE MemberNumber = N'AKR-04-0117-003'");

    public static Task<int> GetParentCouncilIdAsync(SqlConnection conn, int chapterId) =>
        conn.ExecuteScalarAsync<int>("SELECT ParentCouncilId FROM dbo.Chapter WHERE ChapterId = @chapterId", new { chapterId });

    public static async Task<string> GetGiftNameAsync(SqlConnection conn, int memberId) =>
        (await conn.ExecuteScalarAsync<string>("SELECT GiftName FROM dbo.Member WHERE MemberId = @memberId", new { memberId }))!;

    public static Task<int> GetActiveStatusIdAsync(SqlConnection conn) =>
        conn.ExecuteScalarAsync<int>("SELECT StatusId FROM dbo.MemberStatus WHERE StatusName = N'Active'");
}

internal static class ChatPrivacyTestHelpers
{
    /// <summary>Tears down a Private room and everything hung off it: participant rows, messages, mentions on those messages, and the room's own AuditLog 'Create' row (if any).</summary>
    public static Task CleanupPrivateRoomAsync(SqlConnection conn, int roomId) =>
        conn.ExecuteAsync(
            """
            DELETE m FROM dbo.ChatMessageMention m
              JOIN dbo.ChatMessage cm ON cm.MessageId = m.MessageId
             WHERE cm.RoomId = @roomId;
            DELETE FROM dbo.ChatParticipant WHERE RoomId = @roomId;
            DELETE FROM dbo.ChatMessage WHERE RoomId = @roomId;
            DELETE FROM dbo.AuditLog WHERE TableName = 'ChatRoom' AND RecordId = @roomIdText;
            DELETE FROM dbo.ChatRoom WHERE RoomId = @roomId;
            """,
            new { roomId, roomIdText = roomId.ToString() });

    /// <summary>Tears down a Public-room message that may carry verified mentions — ChatDbTestHelpers.CleanupMessageAsync (ChatModuleIntegrationTests.cs) does not know about ChatMessageMention, since it predates the mentions feature.</summary>
    public static Task CleanupMentionedMessageAsync(SqlConnection conn, int messageId) =>
        conn.ExecuteAsync(
            """
            DELETE FROM dbo.ChatMessageMention WHERE MessageId = @messageId;
            DELETE FROM dbo.ChatMessageFlag WHERE MessageId = @messageId;
            DELETE FROM dbo.AuditLog WHERE TableName = 'ChatMessage' AND RecordId = @messageIdText;
            DELETE FROM dbo.ChatMessage WHERE MessageId = @messageId;
            """,
            new { messageId, messageIdText = messageId.ToString() });
}

/// <summary>
/// Tech-lead item 1: a member of the SAME chapter as both participants, who is simply not one
/// of the two people in the conversation, must be rejected by every Private-room operation —
/// exactly as if the room didn't exist to him. Each test creates and tears down its own room so
/// none of these four depend on each other or on any other test's data.
/// </summary>
[Collection("ChatDb")]
public class ChatPrivateRoomNonParticipantTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatPrivateRoomNonParticipantTests(ChatDbFixture fx) => _fx = fx;

    private ChatRepository MakeRepo() => new(new SqlConnectionFactory(_fx.ConnectionString!));

    [SkippableFact]
    public async Task NonParticipant_of_same_chapter_cannot_read_private_history()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();
        var thirdMemberId = await ChatPrivacyLookups.GetChapterAThirdMemberIdAsync(conn);

        var room = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        try
        {
            var act = () => repo.GetPrivateHistoryAsync(room.RoomId, thirdMemberId, null, 50, CancellationToken.None);
            (await act.Should().ThrowAsync<ChatException>()).Which.Category.Should().Be(ChatErrorCategory.NotFound);
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, room.RoomId);
        }
    }

    [SkippableFact]
    public async Task NonParticipant_of_same_chapter_cannot_post_to_a_private_room()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();
        var thirdMemberId = await ChatPrivacyLookups.GetChapterAThirdMemberIdAsync(conn);

        var room = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        try
        {
            var act = () => repo.PostPrivateMessageAsync(room.RoomId, thirdMemberId, "should never be inserted", null, CancellationToken.None);
            (await act.Should().ThrowAsync<ChatException>()).Which.Category.Should().Be(ChatErrorCategory.NotFound);

            var messageCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.ChatMessage WHERE RoomId = @roomId", new { roomId = room.RoomId });
            messageCount.Should().Be(0, "a rejected non-participant's post must never reach the table, not merely be filtered from a response");
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, room.RoomId);
        }
    }

    [SkippableFact]
    public async Task NonParticipant_of_same_chapter_cannot_mark_a_private_room_read()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();
        var thirdMemberId = await ChatPrivacyLookups.GetChapterAThirdMemberIdAsync(conn);

        var room = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        try
        {
            var act = () => repo.MarkPrivateReadAsync(room.RoomId, thirdMemberId, 1, CancellationToken.None);
            (await act.Should().ThrowAsync<ChatException>()).Which.Category.Should().Be(ChatErrorCategory.NotFound);

            var participantRow = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.ChatParticipant WHERE RoomId = @roomId AND MemberId = @memberId",
                new { roomId = room.RoomId, memberId = thirdMemberId });
            participantRow.Should().Be(0, "a rejected caller must never end up with a participant row for a room he has no standing in");
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, room.RoomId);
        }
    }

    [SkippableFact]
    public async Task NonParticipant_of_same_chapter_cannot_mute_a_private_room()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();
        var thirdMemberId = await ChatPrivacyLookups.GetChapterAThirdMemberIdAsync(conn);

        var room = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        try
        {
            // usp_ChatParticipant_SetMute's own single failure code (51284) maps to Forbidden,
            // not NotFound — see ChatException's mapping table and that procedure's own header
            // comment — but the caller-facing meaning here is identical: no standing at all.
            var act = () => repo.SetMuteAsync(room.RoomId, thirdMemberId, true, CancellationToken.None);
            (await act.Should().ThrowAsync<ChatException>()).Which.Category.Should().Be(ChatErrorCategory.Forbidden);
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, room.RoomId);
        }
    }
}

/// <summary>
/// Tech-lead item 2: a chapter officer has zero elevated access to a private room, even one
/// between two members of his own chapter — this is the regression guard on "a private room's
/// ChapterId is always NULL, which is what makes it automatically unreachable by every
/// moderation proc" (usp_ChatMessage_Flag / usp_ChatMessage_Delete / usp_ChatMessage_GetFlagged
/// all resolve chapter via the room and reject when ChapterId IS NULL).
/// </summary>
[Collection("ChatDb")]
public class ChatPrivateRoomOfficerHasNoStandingTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatPrivateRoomOfficerHasNoStandingTests(ChatDbFixture fx) => _fx = fx;

    private ChatRepository MakeRepo() => new(new SqlConnectionFactory(_fx.ConnectionString!));

    [SkippableFact]
    public async Task Officer_of_the_chapter_cannot_flag_a_message_in_a_private_room_between_his_own_members()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var room = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        var posted = await repo.PostPrivateMessageAsync(room.RoomId, _fx.ChapterAOfficerId, "officer standing fixture — flag", null, CancellationToken.None);
        try
        {
            // Same "not found" behavior as a MessageId that doesn't exist at all (51275) —
            // there is no distinct "that's a private message" error, by design.
            var act = () => repo.FlagMessageAsync(posted.MessageId, _fx.ChapterAOfficerId, "attempted flag on a private message", null, CancellationToken.None);
            (await act.Should().ThrowAsync<ChatException>()).Which.Category.Should().Be(ChatErrorCategory.NotFound);

            var flagCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.ChatMessageFlag WHERE MessageId = @id", new { id = posted.MessageId });
            flagCount.Should().Be(0);
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, room.RoomId);
        }
    }

    [SkippableFact]
    public async Task Officer_of_the_chapter_cannot_delete_a_message_in_a_private_room_between_his_own_members()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var room = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        var posted = await repo.PostPrivateMessageAsync(room.RoomId, _fx.ChapterAMemberId, "officer standing fixture — delete", null, CancellationToken.None);
        try
        {
            // Same "not found" behavior as a MessageId that doesn't exist at all (51274).
            var act = () => repo.DeleteMessageAsync(posted.MessageId, _fx.ChapterAOfficerId, "attempted removal of a private message", null, CancellationToken.None);
            (await act.Should().ThrowAsync<ChatException>()).Which.Category.Should().Be(ChatErrorCategory.NotFound);

            var isDeleted = await conn.ExecuteScalarAsync<bool>(
                "SELECT IsDeleted FROM dbo.ChatMessage WHERE MessageId = @id", new { id = posted.MessageId });
            isDeleted.Should().BeFalse();
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, room.RoomId);
        }
    }

    [SkippableFact]
    public async Task GetFlagged_by_a_real_officer_of_the_chapter_never_returns_a_private_room_message()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var room = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        var posted = await repo.PostPrivateMessageAsync(room.RoomId, _fx.ChapterAOfficerId, "officer standing fixture — moderation queue", null, CancellationToken.None);
        try
        {
            // usp_ChatMessage_Flag rejects the private message itself (proven above), so this
            // message can never legitimately appear in ChatMessageFlag — this test's own value
            // is proving that usp_ChatMessage_GetFlagged's ChapterId-scoped queue genuinely
            // cannot surface it even if something upstream ever went wrong.
            var queue = await repo.GetFlaggedAsync(_fx.ChapterAId, _fx.ChapterAOfficerId, 0, 200, true, CancellationToken.None);

            queue.Messages.Should().NotContain(m => m.MessageId == posted.MessageId,
                "a private message must never surface in a chapter's Public-room moderation queue, regardless of who both participants are");
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, room.RoomId);
        }
    }
}

/// <summary>Tech-lead item 3 — not yet covered by ChatPrivateAndPushIntegrationTests.cs (that file only ever calls EnsurePrivateRoomAsync in ONE argument order).</summary>
[Collection("ChatDb")]
public class ChatPrivateRoomCanonicalOrderingTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatPrivateRoomCanonicalOrderingTests(ChatDbFixture fx) => _fx = fx;

    [SkippableFact]
    public async Task EnsurePrivateRoom_called_with_either_argument_order_resolves_to_the_identical_room()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = new ChatRepository(new SqlConnectionFactory(_fx.ConnectionString!));
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var forward = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        try
        {
            forward.WasCreated.Should().BeTrue();

            var reversed = await repo.EnsurePrivateRoomAsync(_fx.ChapterAMemberId, _fx.ChapterAOfficerId, null, CancellationToken.None);

            reversed.RoomId.Should().Be(forward.RoomId, "the same pair of members must always resolve to the same room regardless of who initiates");
            reversed.WasCreated.Should().BeFalse();
            reversed.OtherMemberId.Should().Be(_fx.ChapterAOfficerId, "from the second caller's point of view, the 'other' member is whoever HE didn't call as");
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, forward.RoomId);
        }
    }
}

/// <summary>Tech-lead item 5 — a detached, council-homed member (ChapterId IS NULL, CLAUDE.md invariant #14) has no chapter to share with anyone, so same-chapter-only rejects him in both directions.</summary>
[Collection("ChatDb")]
public class ChatPrivateRoomDetachedMemberTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatPrivateRoomDetachedMemberTests(ChatDbFixture fx) => _fx = fx;

    [SkippableFact]
    public async Task Detached_member_with_no_chapter_cannot_start_or_be_the_target_of_a_private_conversation()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var parentCouncilId = await ChatPrivacyLookups.GetParentCouncilIdAsync(conn, _fx.ChapterAId);
        var activeStatusId = await ChatPrivacyLookups.GetActiveStatusIdAsync(conn);
        var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];

        // CK_Member_Home (db/schema/02_members.sql): ChapterId NULL requires HomeCouncilId NOT
        // NULL AND AttachReason NOT NULL — this is what makes the row a genuine detached member,
        // not merely a malformed one.
        var detachedMemberId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Member (HomeCouncilId, AttachReason, AttachedSince, MemberNumber, FirstName, LastName, GiftName, StatusId)
            OUTPUT INSERTED.MemberId
            VALUES (@parentCouncilId, N'ZZTEST fixture — chapter dissolved, re-homed to council', CAST(SYSUTCDATETIME() AS DATE),
                    @memberNumber, N'ZZTEST', N'ZZTEST', N'ZZTEST-Detached', @activeStatusId)
            """,
            new { parentCouncilId, memberNumber, activeStatusId });

        try
        {
            var repo = new ChatRepository(new SqlConnectionFactory(_fx.ConnectionString!));

            var asInitiator = () => repo.EnsurePrivateRoomAsync(detachedMemberId, _fx.ChapterAMemberId, null, CancellationToken.None);
            (await asInitiator.Should().ThrowAsync<ChatException>()).Which.Category.Should().Be(ChatErrorCategory.NotFound);

            var asTarget = () => repo.EnsurePrivateRoomAsync(_fx.ChapterAMemberId, detachedMemberId, null, CancellationToken.None);
            (await asTarget.Should().ThrowAsync<ChatException>()).Which.Category.Should().Be(ChatErrorCategory.NotFound);

            var roomsInvolvingHim = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.ChatRoom WHERE RoomType = 'Private' AND (MemberAId = @id OR MemberBId = @id)",
                new { id = detachedMemberId });
            roomsInvolvingHim.Should().Be(0, "a rejected attempt in either direction must never leave a room behind");
        }
        finally
        {
            await conn.ExecuteAsync("DELETE FROM dbo.Member WHERE MemberId = @detachedMemberId", new { detachedMemberId });
        }
    }
}

/// <summary>
/// Regression guard for a tech-lead review finding: the header comments in
/// db/schema/15_chat_private.sql and db/procs/usp_ChatRoom_EnsurePrivate.sql USED TO claim (wrongly)
/// that a detached member (chapter gone dormant, ChapterId set to NULL, CLAUDE.md invariant #14)
/// "cannot receive" an EXISTING private conversation. That was never true of the shipped SQL:
/// usp_ChatMessage_GetPrivateHistory, usp_ChatMessage_PostPrivate, usp_ChatParticipant_MarkReadPrivate
/// and usp_ChatParticipant_SetMute all authorize purely on "is the caller one of this room's two
/// stored MemberAId/MemberBId" (see usp_ChatMessage_GetPrivateHistory's own THROW 51282 check, read
/// directly above) — none of them re-checks current chapter membership. Only
/// usp_ChatRoom_EnsurePrivate's same-chapter check (proven above, in
/// ChatPrivateRoomDetachedMemberTests) governs STARTING a brand-new conversation; it has no bearing
/// on a conversation that already exists. The misleading comments have since been corrected, but
/// the actual behavior — an existing conversation survives a participant later becoming detached —
/// is the intended, correct one and must never be "fixed" into a re-check, which would silently
/// sever every existing conversation the instant one party's chapter goes dormant. This test proves
/// the real behavior directly against the database so nobody re-introduces that re-check by relying
/// on comments alone.
/// </summary>
[Collection("ChatDb")]
public class ChatPrivateRoomSurvivesDetachmentTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatPrivateRoomSurvivesDetachmentTests(ChatDbFixture fx) => _fx = fx;

    private ChatRepository MakeRepo() => new(new SqlConnectionFactory(_fx.ConnectionString!));

    [SkippableFact]
    public async Task Existing_conversation_survives_a_participant_becoming_detached()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        // A real, existing ancestor council of chapter A — not an arbitrary id. Same lookup
        // ChatPrivateRoomDetachedMemberTests already relies on for the identical purpose.
        var parentCouncilId = await ChatPrivacyLookups.GetParentCouncilIdAsync(conn, _fx.ChapterAId);

        // 1/2/3: a real, same-chapter pair (the fixture's own officer/member pair), a real room
        // between them, and at least one message in it before anyone is detached.
        var room = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        var originalPost = await repo.PostPrivateMessageAsync(room.RoomId, _fx.ChapterAOfficerId, "before detachment — must remain readable and postable after", null, CancellationToken.None);

        // Capture the exact prior state of the member being detached so cleanup restores it
        // precisely, rather than assuming it was _fx.ChapterAId.
        var originalChapterId = await conn.ExecuteScalarAsync<int?>(
            "SELECT ChapterId FROM dbo.Member WHERE MemberId = @id", new { id = _fx.ChapterAMemberId });

        try
        {
            // 4: detach _fx.ChapterAMemberId — CK_Member_Home (db/schema/02_members.sql) requires
            // ChapterId NULL to come with HomeCouncilId NOT NULL AND AttachReason NOT NULL; this
            // is what makes the row a genuine, legitimate detachment, not merely a malformed one.
            await conn.ExecuteAsync(
                """
                UPDATE dbo.Member
                   SET ChapterId = NULL,
                       HomeCouncilId = @parentCouncilId,
                       AttachReason = N'ZZTEST fixture — chapter dissolved, re-homed to council (regression test)',
                       AttachedSince = CAST(SYSUTCDATETIME() AS DATE)
                 WHERE MemberId = @memberId
                """,
                new { parentCouncilId, memberId = _fx.ChapterAMemberId });

            // 5: the now-detached member can still read the existing conversation...
            var historyForDetached = await repo.GetPrivateHistoryAsync(room.RoomId, _fx.ChapterAMemberId, null, 50, CancellationToken.None);
            historyForDetached.Should().Contain(m => m.MessageId == originalPost.MessageId,
                "an existing private conversation must survive a participant later becoming detached — this is the correct, intended behavior");

            // ...and still post to it.
            var postFromDetached = await repo.PostPrivateMessageAsync(
                room.RoomId, _fx.ChapterAMemberId, "after detachment — the detached member can still write here", null, CancellationToken.None);
            postFromDetached.Body.Should().Be("after detachment — the detached member can still write here");

            // The still-chapter-homed other participant is unaffected: he can still read (seeing
            // both messages, including the detached member's new one) and still post.
            var historyForOther = await repo.GetPrivateHistoryAsync(room.RoomId, _fx.ChapterAOfficerId, null, 50, CancellationToken.None);
            historyForOther.Should().Contain(m => m.MessageId == originalPost.MessageId)
                .And.Contain(m => m.MessageId == postFromDetached.MessageId,
                    "the conversation keeps working normally for the still-chapter-homed side too");

            var postFromOther = await repo.PostPrivateMessageAsync(
                room.RoomId, _fx.ChapterAOfficerId, "after the other party's detachment — still works normally", null, CancellationToken.None);
            postFromOther.Body.Should().Be("after the other party's detachment — still works normally");
        }
        finally
        {
            // 6: restore the member exactly as found, then tear down everything this test created.
            await conn.ExecuteAsync(
                """
                UPDATE dbo.Member
                   SET ChapterId = @originalChapterId,
                       HomeCouncilId = NULL,
                       AttachReason = NULL,
                       AttachedSince = NULL
                 WHERE MemberId = @memberId
                """,
                new { originalChapterId, memberId = _fx.ChapterAMemberId });

            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, room.RoomId);
        }
    }
}

/// <summary>
/// Tech-lead item 6 — mention verification is real only when the claim survives ALL of: active
/// member of the SAME chapter, the literal "@GiftName" substring actually present in the body,
/// not the sender himself, and capped at 10. (a)/(b)/(c)/(d) below; (e), the genuinely-valid
/// case, is already covered by ChatPrivateAndPushIntegrationTests.PostMessage_with_a_genuine_mention_is_verified_and_returned.
/// </summary>
[Collection("ChatDb")]
public class ChatMentionVerificationTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatMentionVerificationTests(ChatDbFixture fx) => _fx = fx;

    private ChatRepository MakeRepo() => new(new SqlConnectionFactory(_fx.ConnectionString!));

    [SkippableFact]
    public async Task Claimed_mention_of_an_active_same_chapter_member_whose_gift_name_is_not_in_the_body_is_dropped()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var result = await repo.PostMessageAsync(
            _fx.ChapterAId, _fx.ChapterAOfficerId, "a message that does not name anyone at all", [_fx.ChapterAMemberId], null, CancellationToken.None);
        try
        {
            result.MentionedMemberIds.Should().BeEmpty();

            var recorded = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.ChatMessageMention WHERE MessageId = @id", new { id = result.Message.MessageId });
            recorded.Should().Be(0);
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupMentionedMessageAsync(conn, result.Message.MessageId);
        }
    }

    [SkippableFact]
    public async Task Claimed_mention_of_a_member_from_a_different_chapter_is_dropped()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();
        var chapterBGiftName = await ChatPrivacyLookups.GetGiftNameAsync(conn, _fx.ChapterBMemberId);

        var result = await repo.PostMessageAsync(
            _fx.ChapterAId, _fx.ChapterAOfficerId,
            $"mentioning @{chapterBGiftName} who belongs to a different chapter entirely",
            [_fx.ChapterBMemberId], null, CancellationToken.None);
        try
        {
            result.MentionedMemberIds.Should().BeEmpty("the claimed member's gift name is literally present, but he is not a member of the post's own chapter");

            var recorded = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.ChatMessageMention WHERE MessageId = @id", new { id = result.Message.MessageId });
            recorded.Should().Be(0);
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupMentionedMessageAsync(conn, result.Message.MessageId);
        }
    }

    [SkippableFact]
    public async Task A_member_mentioning_himself_is_dropped()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = MakeRepo();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();
        var officerGiftName = await ChatPrivacyLookups.GetGiftNameAsync(conn, _fx.ChapterAOfficerId);

        var result = await repo.PostMessageAsync(
            _fx.ChapterAId, _fx.ChapterAOfficerId,
            $"@{officerGiftName} talking to myself here",
            [_fx.ChapterAOfficerId], null, CancellationToken.None);
        try
        {
            result.MentionedMemberIds.Should().BeEmpty("a self-mention must never be recorded, even though the sender's own gift name is trivially present in his own message");
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupMentionedMessageAsync(conn, result.Message.MessageId);
        }
    }

    /// <summary>
    /// A dedicated, throwaway chapter with 12 fresh members (distinct, non-overlapping gift
    /// names — see the ZZM01..ZZM12 padding below, which matters: usp_ChatMessage_Post matches
    /// mentions with plain CHARINDEX, so "ZZM1" would also match inside "ZZM10" if names were
    /// not all the same length). Sender claims all 11 other members as mentions; only the 10
    /// with the smallest MemberId (the proc's own tie-break — dbo.IntList has no ordinal column
    /// to preserve caller order, see usp_ChatMessage_Post's header comment) survive.
    /// </summary>
    [SkippableFact]
    public async Task Posting_a_message_with_more_than_ten_claimed_mentions_records_only_the_first_ten_by_member_id()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var parentCouncilId = await ChatPrivacyLookups.GetParentCouncilIdAsync(conn, _fx.ChapterAId);
        var activeStatusId = await ChatPrivacyLookups.GetActiveStatusIdAsync(conn);

        var chapterId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT dbo.Chapter (ParentCouncilId, ChapterName, Barangay, SuggestedContribution)
            OUTPUT INSERTED.ChapterId
            VALUES (@parentCouncilId, N'ZZTEST-ChatPrivacy-MentionCap', N'ZZTEST', 0)
            """,
            new { parentCouncilId });

        var memberIds = new List<int>();
        var giftNames = new List<string>();
        try
        {
            for (var i = 1; i <= 12; i++)
            {
                var giftName = $"ZZM{i:00}";
                var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
                var id = await conn.ExecuteScalarAsync<int>(
                    """
                    INSERT dbo.Member (ChapterId, MemberNumber, FirstName, LastName, GiftName, StatusId)
                    OUTPUT INSERTED.MemberId
                    VALUES (@chapterId, @memberNumber, N'ZZTEST', N'ZZTEST', @giftName, @activeStatusId)
                    """,
                    new { chapterId, memberNumber, giftName, activeStatusId });
                memberIds.Add(id);
                giftNames.Add(giftName);
            }

            var senderId = memberIds[0];
            var candidateIds = memberIds.Skip(1).ToList();          // 11 candidates, ascending MemberId (insertion order)
            var candidateNames = giftNames.Skip(1).ToList();
            var body = "mentioning everyone: " + string.Join(" ", candidateNames.Select(n => "@" + n));

            var repo = new ChatRepository(new SqlConnectionFactory(_fx.ConnectionString!));
            var result = await repo.PostMessageAsync(chapterId, senderId, body, candidateIds, null, CancellationToken.None);
            try
            {
                var expectedTop10 = candidateIds.Take(10).ToList();

                result.MentionedMemberIds.Should().HaveCount(10, "usp_ChatMessage_Post caps verified mentions at 10 per message");
                result.MentionedMemberIds.Should().Equal(expectedTop10, "the survivors are the 10 smallest MemberIds among the claimed candidates, in ascending order");

                var recordedCount = await conn.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM dbo.ChatMessageMention WHERE MessageId = @id", new { id = result.Message.MessageId });
                recordedCount.Should().Be(10);
            }
            finally
            {
                await ChatPrivacyTestHelpers.CleanupMentionedMessageAsync(conn, result.Message.MessageId);
            }
        }
        finally
        {
            // usp_ChatMessage_Post lazily creates this chapter's Public room on first post (the
            // sender's own post above did exactly that) — it must be torn down, along with its
            // own 'Create' AuditLog row, before the chapter itself can be deleted (FK).
            await conn.ExecuteAsync(
                """
                DELETE FROM dbo.AuditLog WHERE TableName = 'ChatRoom'
                    AND RecordId IN (SELECT CAST(RoomId AS NVARCHAR(40)) FROM dbo.ChatRoom WHERE ChapterId = @chapterId);
                DELETE FROM dbo.ChatRoom WHERE ChapterId = @chapterId;
                DELETE FROM dbo.Member WHERE ChapterId = @chapterId;
                DELETE FROM dbo.Chapter WHERE ChapterId = @chapterId;
                """,
                new { chapterId });
        }
    }
}

/// <summary>
/// Tech-lead item 10 — a private message SEND writes no AuditLog row (confirmed decision); room
/// CREATION does, exactly once, and never again once the room already exists.
/// </summary>
[Collection("ChatDb")]
public class ChatPrivateAuditIntegrityTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatPrivateAuditIntegrityTests(ChatDbFixture fx) => _fx = fx;

    [SkippableFact]
    public async Task PostPrivateMessage_writes_zero_AuditLog_rows()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var repo = new ChatRepository(new SqlConnectionFactory(_fx.ConnectionString!));
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var room = await repo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        var posted = await repo.PostPrivateMessageAsync(room.RoomId, _fx.ChapterAOfficerId, "audit-integrity fixture — private send", null, CancellationToken.None);
        try
        {
            var auditRows = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.AuditLog WHERE TableName = 'ChatMessage' AND RecordId = @id",
                new { id = posted.MessageId.ToString() });

            auditRows.Should().Be(0, "a private message send is never audited — see usp_ChatMessage_PostPrivate's own header comment for this module's confirmed decision");
        }
        finally
        {
            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, room.RoomId);
        }
    }

    /// <summary>
    /// Uses two fresh, dedicated members (not the shared officer/member pair every other test in
    /// this file reuses) specifically so "no room exists yet for this pair" is a guarantee this
    /// test creates itself, not an assumption about what earlier tests may have left behind.
    /// </summary>
    [SkippableFact]
    public async Task EnsurePrivateRoom_audits_exactly_once_on_creation_and_not_again_when_the_room_already_exists()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var activeStatusId = await ChatPrivacyLookups.GetActiveStatusIdAsync(conn);
        async Task<int> MakeChapterAMemberAsync(string giftName)
        {
            var memberNumber = "ZZTEST-" + Guid.NewGuid().ToString("N")[..20];
            return await conn.ExecuteScalarAsync<int>(
                """
                INSERT dbo.Member (ChapterId, MemberNumber, FirstName, LastName, GiftName, StatusId)
                OUTPUT INSERTED.MemberId
                VALUES (@chapterId, @memberNumber, N'ZZTEST', N'ZZTEST', @giftName, @activeStatusId)
                """,
                new { chapterId = _fx.ChapterAId, memberNumber, giftName, activeStatusId });
        }

        var memberX = await MakeChapterAMemberAsync("ZZTEST-AuditPairX");
        var memberY = await MakeChapterAMemberAsync("ZZTEST-AuditPairY");

        try
        {
            var repo = new ChatRepository(new SqlConnectionFactory(_fx.ConnectionString!));

            var created = await repo.EnsurePrivateRoomAsync(memberX, memberY, null, CancellationToken.None);
            created.WasCreated.Should().BeTrue();

            var createRows = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.AuditLog WHERE TableName = 'ChatRoom' AND RecordId = @id AND [Action] = 'Create'",
                new { id = created.RoomId.ToString() });
            createRows.Should().Be(1, "room creation is audited exactly once");

            var again = await repo.EnsurePrivateRoomAsync(memberX, memberY, null, CancellationToken.None);
            again.RoomId.Should().Be(created.RoomId);
            again.WasCreated.Should().BeFalse();

            var createRowsAfterSecondCall = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.AuditLog WHERE TableName = 'ChatRoom' AND RecordId = @id AND [Action] = 'Create'",
                new { id = created.RoomId.ToString() });
            createRowsAfterSecondCall.Should().Be(1, "finding an already-existing room must never write a second Create audit row");

            await ChatPrivacyTestHelpers.CleanupPrivateRoomAsync(conn, created.RoomId);
        }
        finally
        {
            await conn.ExecuteAsync("DELETE FROM dbo.Member WHERE MemberId IN (@memberX, @memberY)", new { memberX, memberY });
        }
    }
}

/// <summary>
/// Tech-lead item 7 — the single most important test in this module. PushJob has no property
/// that could ever carry message body text, by construction; this is a structural guarantee,
/// verified by reflection so a future "helpful" field addition fails immediately, before anyone
/// even writes code that reads it. No database needed — always runs.
/// </summary>
public class PushJobShapeTests
{
    private static readonly string[] ForbiddenNameFragments = ["body", "content", "narrative", "text"];

    [Fact]
    public void PushJob_has_no_property_that_could_carry_message_body_text()
    {
        var properties = typeof(PushJob).GetProperties(BindingFlags.Public | BindingFlags.Instance);

        properties.Select(p => p.Name).Should().NotContain(
            name => ForbiddenNameFragments.Any(f => name.Contains(f, StringComparison.OrdinalIgnoreCase)),
            "PushJob must structurally be unable to carry message text — a lock screen is the most exposed surface in the app");
    }

    /// <summary>
    /// Stronger than the name check above: the ONLY string-typed property PushJob has at all is
    /// SenderGiftName — there is nowhere else free text could hide even under an innocuous name.
    /// </summary>
    [Fact]
    public void PushJob_has_exactly_one_string_property_and_it_is_the_sender_gift_name()
    {
        var stringProperties = typeof(PushJob).GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.PropertyType == typeof(string))
            .Select(p => p.Name)
            .ToList();

        stringProperties.Should().Equal("SenderGiftName");
    }
}

/// <summary>
/// Tech-lead item 7 (continued) — PushDispatchHostedService.ProcessJobAsync is private and this
/// project has no test harness to invoke it directly (see ChatModuleIntegrationTests.cs's own
/// header comment on the state of integration testing here), so this is a documented
/// source-level assertion instead: read the actual shipped file and confirm (a) the two push
/// body strings are exactly the fixed templates, interpolating only job.SenderGiftName, and (b)
/// the word "Body" does not appear anywhere in the file at all — not in a template, not in a
/// comment referencing some other body it might reach for. This second check is deliberately
/// broader than just the template lines: PushJob has no Body property to interpolate (see
/// PushJobShapeTests above), so if this file ever changed to reference one, that reference could
/// only come from somewhere else entirely (e.g. a repository call this file doesn't currently
/// make) — worth catching immediately either way. No database needed — always runs.
/// </summary>
public class PushDispatchTemplateSourceTests
{
    private static string ReadSourceFile(string relativePathFromRepoRoot)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Akrho.sln")))
            dir = dir.Parent;

        if (dir is null)
            throw new InvalidOperationException("Could not locate repo root (Akrho.sln) from " + AppContext.BaseDirectory);

        var path = Path.Combine(dir.FullName, relativePathFromRepoRoot);
        if (!File.Exists(path))
            throw new InvalidOperationException($"Expected source file not found: {path}");

        return File.ReadAllText(path);
    }

    [Fact]
    public void Push_body_templates_are_the_two_fixed_strings_interpolating_only_the_sender_gift_name()
    {
        var text = ReadSourceFile(Path.Combine("src", "Akrho.Infrastructure", "Push", "PushDispatchHostedService.cs"));

        text.Should().Contain(
            "\"New message from {job.SenderGiftName}\"",
            "the PrivateMessage push body must be exactly this fixed template plus the sender's gift name");
        text.Should().Contain(
            "\"{job.SenderGiftName} mentioned you in the chapter chat\"",
            "the Mention push body must be exactly this fixed template plus the sender's gift name");
    }

    [Fact]
    public void PushDispatchHostedService_source_never_mentions_a_message_body_at_all()
    {
        var text = ReadSourceFile(Path.Combine("src", "Akrho.Infrastructure", "Push", "PushDispatchHostedService.cs"));

        text.Should().NotContain("Body",
            "PushJob has no Body property (see PushJobShapeTests) — if this word ever appears here, " +
            "something changed to reach for message content that must never reach a push payload");
    }
}

/// <summary>
/// Tech-lead item 9 — usp_ChatParticipant_GetState and usp_PushSubscription_GetForMember are
/// documented (in their own procedure headers, and in ChatRepository/PushRepository's XML docs)
/// as internal-only: no member-facing endpoint should ever call
/// IChatRepository.GetParticipantStateAsync or IPushRepository.GetSubscriptionsForMemberAsync.
/// Expressed as a source grep over every .cs file under src/Akrho.Api/Features/ — the only call
/// sites in the whole solution are PushDispatchHostedService.cs itself and the two repository
/// implementations, both outside Features/ entirely. No database needed — always runs.
/// </summary>
public class PushInternalOnlyProcSourceGrepTests
{
    private static string FindFeaturesDirectory()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Akrho.sln")))
            dir = dir.Parent;

        if (dir is null)
            throw new InvalidOperationException("Could not locate repo root (Akrho.sln) from " + AppContext.BaseDirectory);

        var featuresDir = Path.Combine(dir.FullName, "src", "Akrho.Api", "Features");
        if (!Directory.Exists(featuresDir))
            throw new InvalidOperationException("Expected directory not found: " + featuresDir);

        return featuresDir;
    }

    public static IEnumerable<object[]> ForbiddenReferences()
    {
        yield return ["GetParticipantStateAsync"];
        yield return ["usp_ChatParticipant_GetState"];
        yield return ["GetSubscriptionsForMemberAsync"];
        yield return ["usp_PushSubscription_GetForMember"];
    }

    [Theory]
    [MemberData(nameof(ForbiddenReferences))]
    public void No_endpoint_under_Features_references_this_internal_only_member(string forbiddenText)
    {
        var featuresDir = FindFeaturesDirectory();
        var offendingFiles = Directory.GetFiles(featuresDir, "*.cs", SearchOption.AllDirectories)
            .Where(f => File.ReadAllText(f).Contains(forbiddenText, StringComparison.Ordinal))
            .ToList();

        offendingFiles.Should().BeEmpty(
            $"'{forbiddenText}' is internal-only (push-dispatch worker use only) — no file under Features/ may reference it");
    }
}

/// <summary>
/// Tech-lead item 8 — extends invariant #5's reasoning (never expose participation/social
/// metrics about ANOTHER member) to this module. A member seeing his OWN unread count or his OWN
/// conversation list total is not a participation metric about someone else and is deliberately
/// allowed (see the exclusions below); anything that would report on another member's activity
/// is not. usp_ChatRoom_ListPrivate's own SQL was also read directly (db/procs/usp_ChatRoom_ListPrivate.sql)
/// as part of writing this test: its columns are RoomId, OtherMemberId, OtherGiftName,
/// OtherChapterName, LastMessageId, LastMessagePreview, LastMessageDate, UnreadCount (the
/// CALLER's own unread count in that room), IsMuted, TotalCount (the CALLER's own paging total)
/// — nothing about "how many conversations does the other member have" or "how active is he".
/// No database needed — always runs.
/// </summary>
public class NoParticipationMetricsShapeTests
{
    private static readonly string[] ForbiddenNameFragments =
    [
        "messagecount", "conversationcount", "mostactive", "activityscore",
        "engagementscore", "participationscore", "totalmessages", "totalconversations"
    ];

    public static IEnumerable<object[]> TypesToCheck()
    {
        yield return [typeof(ChatRoomRow)];
        yield return [typeof(ChatMessageRow)];
        yield return [typeof(ChatMessagePostResult)];
        yield return [typeof(ChatModerationQueueRows)];
        yield return [typeof(ChatFlaggedMessageRow)];
        yield return [typeof(ChatFlagDetailRow)];
        yield return [typeof(ChatPrivateRoomRow)];
        yield return [typeof(ChatPrivateRoomListRow)];
        yield return [typeof(ChatPrivateMessageRow)];
        yield return [typeof(ChatParticipantStateRow)];
    }

    [Theory]
    [MemberData(nameof(TypesToCheck))]
    public void Type_carries_no_property_naming_a_participation_or_social_metric(Type type)
    {
        var propertyNames = type.GetProperties().Select(p => p.Name).ToList();

        propertyNames.Should().NotContain(
            name => ForbiddenNameFragments.Any(f => name.Contains(f, StringComparison.OrdinalIgnoreCase)),
            $"{type.Name} must never carry a participation/social metric about another member");
    }
}
