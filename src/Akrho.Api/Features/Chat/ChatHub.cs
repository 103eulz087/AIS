using Microsoft.AspNetCore.SignalR;

namespace Akrho.Api.Features.Chat;

/// <summary>
/// The group-naming scheme shared between <see cref="ChatHub"/> (which JOINS groups on
/// connect) and <see cref="ChatEndpoints"/> (which BROADCASTS to them after a write has
/// committed). Kept as its own tiny type so the two files can never drift on the string shape.
/// </summary>
public static class ChatGroups
{
    /// <summary>Every member of this chapter — receives "MessagePosted" and "MessageRemoved".</summary>
    public static string Chapter(int chapterId) => $"chapter-{chapterId}";

    /// <summary>
    /// Only this chapter's officers/admins — receives "MessageFlagged". A flag count is a
    /// moderation signal, not something the general membership needs pushed to them.
    /// </summary>
    public static string ChapterOfficers(int chapterId) => $"chapter-{chapterId}-officers";

    /// <summary>
    /// Every connection authenticated as this member — joined unconditionally in
    /// OnConnectedAsync from the "mid" claim, regardless of chapter (a private conversation is
    /// not chapter-scoped, so there is no chapter group to broadcast a private message to
    /// instead). Receives "PrivateMessagePosted" — see ConversationsEndpoints, the only
    /// producer of that event.
    /// </summary>
    public static string Member(int memberId) => $"member-{memberId}";
}

/// <summary>
/// The Public chat hub. Deliberately has ZERO client-callable methods — this is a scope-leak
/// defence, not an oversight to "fix" by adding one (e.g. a "JoinRoom" method would let a
/// client choose its own chapter group, exactly what CLAUDE.md invariant #4 exists to
/// prevent). Every write (post/flag/remove/resolve-flags) goes through the REST endpoints in
/// <see cref="ChatEndpoints"/>, which enforce <c>IScopeGuard</c>/authorization and call the
/// stored procedure FIRST; only after that write has committed does the endpoint push the
/// update here via <c>IHubContext&lt;ChatHub&gt;</c>. This hub's only job is deciding, on
/// connect, which groups a connection should receive those broadcasts for — derived solely
/// from the connection's own JWT claims, never from anything a client sends.
///
/// Server-to-client events (exact strings the frontend listens for): "MessagePosted",
/// "MessageRemoved", "MessageFlagged" (Public — see <see cref="ChatEndpoints"/> for the payload
/// shape of each), and "PrivateMessagePosted" (Private — see <c>ConversationsEndpoints</c>).
/// </summary>
public sealed class ChatHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        // "chp" is the same chapter-id claim ICurrentUser/CurrentUser.cs reads for every REST
        // call — see AccessTokenService's own header comment for the claim contract. Missing
        // or non-positive means a detached, council-homed member (CLAUDE.md invariant #14):
        // he has no chapter, so no chapter chat group. Not an error — just nothing to join.
        var chapterId = int.TryParse(Context.User?.FindFirst("chp")?.Value, out var c) ? c : 0;

        if (chapterId > 0)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, ChatGroups.Chapter(chapterId));

            // Same role set as AuthorizationPolicies.ChapterChatModerate — deliberately NOT
            // ICurrentUser.IsChapterOfficer, which also matches ChapterTreasurer (see
            // AuthorizationPolicies.cs's own header comment on why that convenience property
            // is broader than the actual moderation right). The officers group exists only to
            // receive "MessageFlagged", which mirrors exactly the ChapterChatModerate-gated
            // REST actions, so the two must use the identical role set.
            if (Context.User is { } user && (user.IsInRole("ChapterOfficer") || user.IsInRole("ChapterAdmin")))
                await Groups.AddToGroupAsync(Context.ConnectionId, ChatGroups.ChapterOfficers(chapterId));
        }

        // "mid" is the same member-id claim ICurrentUser/CurrentUser.cs reads for every REST
        // call. Joined unconditionally — independent of the chapter check above — because a
        // Private conversation is not chapter-scoped at all (Features/Conversations
        // deliberately has no scope.EnsureChapter anywhere). A connection with no "mid" claim
        // (should not happen for an authenticated user, but treated the same as a missing
        // chapter claim above) simply joins nothing.
        var memberId = int.TryParse(Context.User?.FindFirst("mid")?.Value, out var m) ? m : 0;
        if (memberId > 0)
            await Groups.AddToGroupAsync(Context.ConnectionId, ChatGroups.Member(memberId));

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // No explicit Groups.RemoveFromGroupAsync calls needed — SignalR removes a closed
        // connection from every group it was in automatically. Overridden only so this hub's
        // complete lifecycle (connect/disconnect, nothing else) is visible in one place.
        await base.OnDisconnectedAsync(exception);
    }
}
