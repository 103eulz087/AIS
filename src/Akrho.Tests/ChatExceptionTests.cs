using Akrho.Infrastructure.Repositories;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping for the Public chat module. See
/// usp_ChatRoom_EnsurePublic.sql / usp_ChatMessage_*.sql / usp_ChatParticipant_MarkRead.sql
/// (51270-51279) for the THROWs this mirrors, and CommsException/DashboardException for the
/// pattern this follows.
/// </summary>
public class ChatExceptionTests
{
    [Fact]
    public void Not_an_active_member_opening_the_room_maps_to_Forbidden()
    {
        // usp_ChatRoom_EnsurePublic
        new ChatException(51270, "Not permitted to open this chapter's chat room.")
            .Category.Should().Be(ChatErrorCategory.Forbidden);
    }

    [Fact]
    public void Not_an_active_member_reading_history_maps_to_Forbidden()
    {
        // usp_ChatMessage_GetHistory
        new ChatException(51271, "Not permitted to read this chapter's chat.")
            .Category.Should().Be(ChatErrorCategory.Forbidden);
    }

    [Fact]
    public void Not_an_active_member_posting_maps_to_Forbidden()
    {
        // usp_ChatMessage_Post
        new ChatException(51272, "Not permitted to post to this chapter's chat.")
            .Category.Should().Be(ChatErrorCategory.Forbidden);
    }

    [Fact]
    public void Member_but_not_an_officer_removing_a_message_maps_to_Forbidden()
    {
        // usp_ChatMessage_Delete / usp_ChatMessage_ResolveFlags — a member of the message's
        // own chapter, just not an officer/admin of it.
        new ChatException(51273, "Only a chapter officer or chapter admin may remove a message.")
            .Category.Should().Be(ChatErrorCategory.Forbidden);
    }

    [Fact]
    public void Message_not_found_or_wrong_chapter_removing_maps_to_NotFound()
    {
        // usp_ChatMessage_Delete / usp_ChatMessage_ResolveFlags — deliberately merged
        // anti-enumeration: nonexistent message and "belongs to a chapter the caller isn't
        // even a member of" both come back as this one code.
        new ChatException(51274, "Message not found.")
            .Category.Should().Be(ChatErrorCategory.NotFound);
    }

    [Fact]
    public void Message_not_found_or_not_a_member_flagging_maps_to_NotFound()
    {
        // usp_ChatMessage_Flag — same merged anti-enumeration shape as 51274, its own code.
        new ChatException(51275, "Message not found.")
            .Category.Should().Be(ChatErrorCategory.NotFound);
    }

    [Fact]
    public void Not_an_officer_viewing_the_moderation_queue_maps_to_Forbidden()
    {
        // usp_ChatMessage_GetFlagged
        new ChatException(51276, "Only a chapter officer or chapter admin may view the moderation queue.")
            .Category.Should().Be(ChatErrorCategory.Forbidden);
    }

    [Fact]
    public void An_empty_message_body_maps_to_BadRequest()
    {
        // usp_ChatMessage_Post
        new ChatException(51277, "A message cannot be empty.")
            .Category.Should().Be(ChatErrorCategory.BadRequest);
    }

    [Fact]
    public void An_empty_removal_reason_maps_to_BadRequest()
    {
        // usp_ChatMessage_Delete
        new ChatException(51278, "A reason is required to remove a message.")
            .Category.Should().Be(ChatErrorCategory.BadRequest);
    }

    [Fact]
    public void Not_an_active_member_marking_read_maps_to_Forbidden()
    {
        // usp_ChatParticipant_MarkRead
        new ChatException(51279, "Not permitted to update read state for this chapter's chat.")
            .Category.Should().Be(ChatErrorCategory.Forbidden);
    }

    [Fact]
    public void An_unrecognised_error_number_falls_back_to_BadRequest_not_a_silent_pass()
    {
        new ChatException(50999, "Some other procedure error.")
            .Category.Should().Be(ChatErrorCategory.BadRequest);
    }
}

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping for the Private-chat/push module (Chat
/// module slice 2) — 51280-51285, deliberately kept in the SAME <see cref="ChatException"/>
/// type as the Public module above rather than a parallel class (see that class's own header
/// comment). See usp_ChatRoom_EnsurePrivate.sql / usp_ChatMessage_PostPrivate.sql /
/// usp_ChatMessage_GetPrivateHistory.sql / usp_ChatParticipant_MarkReadPrivate.sql /
/// usp_ChatParticipant_SetMute.sql / usp_PushSubscription_Remove.sql for the THROWs this mirrors.
/// </summary>
public class ChatPrivateAndPushExceptionTests
{
    [Fact]
    public void Not_permitted_to_start_a_private_conversation_maps_to_NotFound()
    {
        // usp_ChatRoom_EnsurePrivate — merged anti-enumeration: different chapters, no
        // chapter, or the other member doesn't exist, all come back as this one code.
        new ChatException(51280, "Not permitted to start a private conversation with this member.")
            .Category.Should().Be(ChatErrorCategory.NotFound);
    }

    [Fact]
    public void Starting_a_conversation_with_yourself_maps_to_BadRequest()
    {
        // usp_ChatRoom_EnsurePrivate
        new ChatException(51281, "You cannot start a private conversation with yourself.")
            .Category.Should().Be(ChatErrorCategory.BadRequest);
    }

    [Fact]
    public void Not_a_participant_of_a_private_room_maps_to_NotFound()
    {
        // usp_ChatMessage_PostPrivate / usp_ChatMessage_GetPrivateHistory /
        // usp_ChatParticipant_MarkReadPrivate — merged anti-enumeration: a nonexistent room, a
        // Public room, and a room the caller isn't a participant of all come back the same way.
        new ChatException(51282, "Not permitted to post to this conversation.")
            .Category.Should().Be(ChatErrorCategory.NotFound);
    }

    [Fact]
    public void An_empty_private_message_body_maps_to_BadRequest()
    {
        // usp_ChatMessage_PostPrivate
        new ChatException(51283, "A message cannot be empty.")
            .Category.Should().Be(ChatErrorCategory.BadRequest);
    }

    [Fact]
    public void Not_permitted_to_change_a_rooms_mute_setting_maps_to_Forbidden()
    {
        // usp_ChatParticipant_SetMute — serves both Public and Private rooms; a nonexistent
        // room also lands here (RoomType comes back NULL, satisfying neither branch).
        new ChatException(51284, "Not permitted to change the mute setting for this conversation.")
            .Category.Should().Be(ChatErrorCategory.Forbidden);
    }

    [Fact]
    public void Push_subscription_not_found_or_not_owned_maps_to_NotFound()
    {
        // usp_PushSubscription_Remove — merged anti-enumeration: a nonexistent subscription id
        // and one that belongs to a different account both come back the same way.
        new ChatException(51285, "Push subscription not found.")
            .Category.Should().Be(ChatErrorCategory.NotFound);
    }
}
