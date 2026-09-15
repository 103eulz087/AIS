using Akrho.Infrastructure;
using Akrho.Infrastructure.Repositories;
using Dapper;
using Microsoft.Data.SqlClient;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Chat module slice 2 (Private chat + push) — exercises <see cref="ChatRepository"/>'s new
/// Private-chat methods and <see cref="PushRepository"/> against the real stored procedures on
/// the shared dev database (see <see cref="ChatDbFixture"/>/<see cref="ChatDbTestConfig"/>,
/// defined in ChatModuleIntegrationTests.cs, reused here under the same "ChatDb" collection).
/// Unlike that file's tests (which call procedures directly via Dapper to prove the PROCEDURE
/// is the authorization boundary), this file goes through the actual repository classes —
/// these are new C# mapping code (column names, parameter shapes, the dbo.IntList
/// table-valued-parameter plumbing for mentions) this session added, so it is that mapping
/// code itself under test here, not just the procedure's own SQL logic.
/// </summary>
[Collection("ChatDb")]
public class ChatPrivateAndPushIntegrationTests
{
    private const string NoDbSkipReason =
        "no shared dev DB connection string configured — set ConnectionStrings__Akrho or restore " +
        "appsettings.Development.local.json to run this test for real";

    private readonly ChatDbFixture _fx;

    public ChatPrivateAndPushIntegrationTests(ChatDbFixture fx)
    {
        _fx = fx;
    }

    private (ChatRepository Chat, PushRepository Push, SqlConnectionFactory Factory) MakeRepos() =>
        (new ChatRepository(new SqlConnectionFactory(_fx.ConnectionString!)),
         new PushRepository(new SqlConnectionFactory(_fx.ConnectionString!)),
         new SqlConnectionFactory(_fx.ConnectionString!));

    /// <summary>
    /// End-to-end round trip through every Private-chat repository method, against two real
    /// active members of the SAME chapter (docs §4.2 requires this) — chapter A's seeded
    /// officer/member pair, same as every scope-leak test in ChatModuleIntegrationTests.cs.
    /// Hard-deletes everything it creates in a finally block, same hygiene as that file.
    /// </summary>
    [SkippableFact]
    public async Task Private_chat_round_trip_through_the_repository()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var (chatRepo, _, _) = MakeRepos();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var room = await chatRepo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
        var roomId = room.RoomId;

        try
        {
            room.OtherMemberId.Should().Be(_fx.ChapterAMemberId);
            room.OtherChapterId.Should().Be(_fx.ChapterAId);

            // Idempotent: calling again for the same pair returns the SAME room, WasCreated = false.
            var again = await chatRepo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAMemberId, null, CancellationToken.None);
            again.RoomId.Should().Be(roomId);
            again.WasCreated.Should().BeFalse();

            var posted = await chatRepo.PostPrivateMessageAsync(
                roomId, _fx.ChapterAOfficerId, "private-chat repository round-trip fixture", null, CancellationToken.None);
            posted.RecipientMemberId.Should().Be(_fx.ChapterAMemberId);
            posted.Body.Should().Be("private-chat repository round-trip fixture");

            var history = await chatRepo.GetPrivateHistoryAsync(roomId, _fx.ChapterAMemberId, null, 50, CancellationToken.None);
            history.Should().Contain(m => m.MessageId == posted.MessageId);

            var rooms = await chatRepo.ListPrivateRoomsAsync(_fx.ChapterAOfficerId, 0, 50, CancellationToken.None);
            rooms.Should().Contain(r => r.RoomId == roomId && r.LastMessageId == posted.MessageId);

            await chatRepo.MarkPrivateReadAsync(roomId, _fx.ChapterAMemberId, posted.MessageId, CancellationToken.None);

            var state = await chatRepo.GetParticipantStateAsync(roomId, _fx.ChapterAMemberId, CancellationToken.None);
            state.LastReadMessageId.Should().Be(posted.MessageId);
            state.IsMuted.Should().BeFalse();

            await chatRepo.SetMuteAsync(roomId, _fx.ChapterAMemberId, true, CancellationToken.None);
            var mutedState = await chatRepo.GetParticipantStateAsync(roomId, _fx.ChapterAMemberId, CancellationToken.None);
            mutedState.IsMuted.Should().BeTrue();
        }
        finally
        {
            await conn.ExecuteAsync("DELETE FROM dbo.ChatParticipant WHERE RoomId = @roomId", new { roomId });
            await conn.ExecuteAsync("DELETE FROM dbo.ChatMessage WHERE RoomId = @roomId", new { roomId });
            await conn.ExecuteAsync("DELETE FROM dbo.AuditLog WHERE TableName = 'ChatRoom' AND RecordId = @recordId", new { recordId = roomId.ToString() });
            await conn.ExecuteAsync("DELETE FROM dbo.ChatRoom WHERE RoomId = @roomId", new { roomId });
        }
    }

    /// <summary>A member of chapter B has no standing to open a Private room with a member of chapter A — merged anti-enumeration, NotFound.</summary>
    [SkippableFact]
    public async Task EnsurePrivateRoom_across_chapters_throws_NotFound_category()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var (chatRepo, _, _) = MakeRepos();

        var act = () => chatRepo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterBMemberId, null, CancellationToken.None);

        var thrown = await act.Should().ThrowAsync<ChatException>();
        thrown.Which.Category.Should().Be(ChatErrorCategory.NotFound);
    }

    [SkippableFact]
    public async Task EnsurePrivateRoom_with_yourself_throws_BadRequest_category()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var (chatRepo, _, _) = MakeRepos();

        var act = () => chatRepo.EnsurePrivateRoomAsync(_fx.ChapterAOfficerId, _fx.ChapterAOfficerId, null, CancellationToken.None);

        var thrown = await act.Should().ThrowAsync<ChatException>();
        thrown.Which.Category.Should().Be(ChatErrorCategory.BadRequest);
    }

    /// <summary>
    /// usp_ChatMessage_Post's amended mention plumbing: a claimed mention that genuinely
    /// appears in the body, for an active member of the SAME chapter, is verified and returned
    /// in the second result set — proving ChatRepository.PostMessageAsync's dbo.IntList TVP
    /// wiring and QueryMultiple mapping both work against the real, deployed procedure.
    /// </summary>
    [SkippableFact]
    public async Task PostMessage_with_a_genuine_mention_is_verified_and_returned()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var (chatRepo, _, _) = MakeRepos();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var giftName = await conn.ExecuteScalarAsync<string>(
            "SELECT GiftName FROM dbo.Member WHERE MemberId = @memberId", new { memberId = _fx.ChapterAMemberId });

        var result = await chatRepo.PostMessageAsync(
            _fx.ChapterAId, _fx.ChapterAOfficerId, $"mention round-trip fixture for @{giftName}",
            [_fx.ChapterAMemberId], null, CancellationToken.None);

        try
        {
            result.MentionedMemberIds.Should().ContainSingle().Which.Should().Be(_fx.ChapterAMemberId);
        }
        finally
        {
            await conn.ExecuteAsync("DELETE FROM dbo.ChatMessageMention WHERE MessageId = @id", new { id = result.Message.MessageId });
            await conn.ExecuteAsync("DELETE FROM dbo.AuditLog WHERE TableName = 'ChatMessage' AND RecordId = @recordId",
                new { recordId = result.Message.MessageId.ToString() });
            await conn.ExecuteAsync("DELETE FROM dbo.ChatMessage WHERE MessageId = @id", new { id = result.Message.MessageId });
        }
    }

    /// <summary>An empty @Mentions dbo.IntList (the "no mentions" case) is always sent — never a null TVP — and yields zero verified mentions.</summary>
    [SkippableFact]
    public async Task PostMessage_with_no_mentions_sends_an_empty_TVP_and_returns_zero_mentions()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var (chatRepo, _, _) = MakeRepos();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var result = await chatRepo.PostMessageAsync(
            _fx.ChapterAId, _fx.ChapterAOfficerId, "no-mentions fixture", [], null, CancellationToken.None);

        try
        {
            result.MentionedMemberIds.Should().BeEmpty();
        }
        finally
        {
            await conn.ExecuteAsync("DELETE FROM dbo.AuditLog WHERE TableName = 'ChatMessage' AND RecordId = @recordId",
                new { recordId = result.Message.MessageId.ToString() });
            await conn.ExecuteAsync("DELETE FROM dbo.ChatMessage WHERE MessageId = @id", new { id = result.Message.MessageId });
        }
    }

    /// <summary>
    /// PushRepository/NotificationPreference round trip. Push subscriptions key off
    /// dbo.UserAccount, so this needs a member with a real account — chapter A's seeded officer
    /// (AKR-04-0117-001) is documented as seeded with an account (ChapterAdmin). Genuinely
    /// skips, rather than failing, if that assumption about the seed ever changes.
    /// </summary>
    [SkippableFact]
    public async Task Push_subscription_and_notification_preference_round_trip()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var (_, pushRepo, _) = MakeRepos();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var accountId = await conn.ExecuteScalarAsync<int>(
            "SELECT TOP 1 AccountId FROM dbo.UserAccount WHERE MemberId = @memberId", new { memberId = _fx.ChapterAOfficerId });
        Skip.If(accountId == 0, "chapter A's seeded officer has no dbo.UserAccount row in this database — cannot exercise account-keyed push subscriptions");

        var endpoint = $"https://smoke-test.invalid/{Guid.NewGuid():N}";
        var subscriptionId = await pushRepo.RegisterSubscriptionAsync(
            accountId, endpoint, "fake-p256dh-key", "fake-auth-secret", "xunit-fixture", null, CancellationToken.None);

        try
        {
            var subs = await pushRepo.GetSubscriptionsForMemberAsync(_fx.ChapterAOfficerId, CancellationToken.None);
            subs.Should().Contain(s => s.SubscriptionId == subscriptionId && s.Endpoint == endpoint);

            var before = await pushRepo.GetNotificationPreferenceAsync(_fx.ChapterAOfficerId, CancellationToken.None);

            await pushRepo.SetNotificationPreferenceAsync(_fx.ChapterAOfficerId, false, true, CancellationToken.None);
            var after = await pushRepo.GetNotificationPreferenceAsync(_fx.ChapterAOfficerId, CancellationToken.None);
            after.PrivateMessagePush.Should().BeFalse();
            after.MentionPush.Should().BeTrue();

            // Restore whatever was there before this test touched it.
            await pushRepo.SetNotificationPreferenceAsync(
                _fx.ChapterAOfficerId, before.PrivateMessagePush, before.MentionPush, CancellationToken.None);
        }
        finally
        {
            await conn.ExecuteAsync("DELETE FROM dbo.PushSubscription WHERE SubscriptionId = @subscriptionId", new { subscriptionId });
        }
    }

    /// <summary>Removing a subscription that doesn't belong to the caller's account is the same merged anti-enumeration NotFound as one that doesn't exist at all.</summary>
    [SkippableFact]
    public async Task RemoveSubscription_not_owned_by_the_caller_throws_NotFound_category()
    {
        Skip.If(_fx.ConnectionString is null, NoDbSkipReason);
        var (_, pushRepo, _) = MakeRepos();
        using var conn = new SqlConnection(_fx.ConnectionString);
        await conn.OpenAsync();

        var accountId = await conn.ExecuteScalarAsync<int>(
            "SELECT TOP 1 AccountId FROM dbo.UserAccount WHERE MemberId = @memberId", new { memberId = _fx.ChapterAOfficerId });
        Skip.If(accountId == 0, "chapter A's seeded officer has no dbo.UserAccount row in this database");

        var act = () => pushRepo.RemoveSubscriptionAsync(accountId, subscriptionId: -1, ip: null, CancellationToken.None);

        var thrown = await act.Should().ThrowAsync<ChatException>();
        thrown.Which.Category.Should().Be(ChatErrorCategory.NotFound);
    }
}
