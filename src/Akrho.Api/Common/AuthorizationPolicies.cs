namespace Akrho.Api.Common;

/// <summary>
/// Named authorization policies. Deliberately narrower than <c>ICurrentUser.IsChapterOfficer</c>
/// in places — that convenience property also matches ChapterTreasurer, who has no meeting-write
/// right per the AIS role table. Do not substitute the convenience property for these policies.
/// </summary>
public static class AuthorizationPolicies
{
    /// <summary>ChapterOfficer or ChapterAdmin — create/edit a meeting, save/clear attendance.</summary>
    public const string ChapterMeetingsWrite = "ChapterMeetingsWrite";

    /// <summary>ChapterAdmin only — finalize a meeting (posts to the ledger).</summary>
    public const string ChapterMeetingsFinalize = "ChapterMeetingsFinalize";

    /// <summary>ChapterTreasurer or ChapterAdmin — reopen a finalized meeting / reverse a ledger entry.</summary>
    public const string ChapterLedgerCorrect = "ChapterLedgerCorrect";

    /// <summary>ChapterTreasurer or ChapterAdmin — create an expense or a donation, or stage a receipt attachment for one.</summary>
    public const string ChapterMoneyWrite = "ChapterMoneyWrite";

    /// <summary>
    /// ChapterAdmin only — void an expense or a donation. Narrower than
    /// <see cref="ChapterMoneyWrite"/> by design, same reasoning as
    /// <see cref="ChapterMeetingsFinalize"/> narrowing <see cref="ChapterMeetingsWrite"/>:
    /// an irreversible correction to money already posted and already disclosed to the
    /// whole chapter's ledger is reserved for the chapter's most accountable officer.
    /// </summary>
    public const string ChapterMoneyVoid = "ChapterMoneyVoid";

    /// <summary>ChapterOfficer or ChapterAdmin — create/close an activity. Same role bar as
    /// <see cref="ChapterMeetingsWrite"/>, kept as its own named policy per this codebase's
    /// one-policy-per-capability convention (see <see cref="ChapterCommsWrite"/> for the
    /// same pattern with an identical role set).</summary>
    public const string ChapterActivitiesWrite = "ChapterActivitiesWrite";

    /// <summary>ChapterOfficer or ChapterAdmin — post an announcement or memo.</summary>
    public const string ChapterCommsWrite = "ChapterCommsWrite";

    /// <summary>ChapterAdmin only — file a corrective action.</summary>
    public const string ChapterDisciplineWrite = "ChapterDisciplineWrite";

    /// <summary>
    /// ChapterAdmin only — view a chapter's membership-application queue/detail, and
    /// approve/return/reject an application. Narrower than <see cref="ChapterCommsWrite"/>'s
    /// role set on purpose: reviewing sign-ups (and, on approval, creating the member record
    /// itself — CLAUDE.md invariant #13) is a Chapter Admin action, not a general officer one.
    /// </summary>
    public const string ChapterMembershipApprove = "ChapterMembershipApprove";

    /// <summary>
    /// ChapterAdmin only — re-issue an enrolment link for an existing member who forgot his
    /// password. Same role bar as <see cref="ChapterMembershipApprove"/> for the same reason:
    /// this grants account access (CLAUDE.md invariant #16), not a general officer action.
    /// </summary>
    public const string ChapterMembersEnrolmentReissue = "ChapterMembersEnrolmentReissue";

    /// <summary>
    /// ChapterOfficer or ChapterAdmin — remove a chat message, resolve its flags, or view the
    /// moderation queue. Same role set as <see cref="ChapterCommsWrite"/>/<see cref="ChapterActivitiesWrite"/>,
    /// kept as its own named policy per this codebase's one-policy-per-capability convention
    /// (public chat moderation is its own capability with its own procedures/THROW numbers,
    /// not a reuse of the comms module's write right).
    /// </summary>
    public const string ChapterChatModerate = "ChapterChatModerate";
}
