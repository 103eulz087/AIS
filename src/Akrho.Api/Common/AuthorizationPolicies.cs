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
    /// ChapterAdmin, OR CouncilSecretary/CouncilAdmin — re-issue an enrolment link. The
    /// ChapterAdmin case is the ordinary one: an existing member forgot his password. The
    /// council case exists ONLY for a brand-new chapter's very first President, whose original
    /// enrolment link (issued at charter approval) never got redeemed — nobody has EVER been
    /// that chapter's admin yet (the President being enrolled IS what creates one), so no
    /// ChapterAdmin exists to click this for him. usp_Enrolment_Issue has always supported this
    /// as its own "Bounded Council Issuer" branch (see that proc's header) — this policy simply
    /// needed to stop being narrower than the procedure it guards. The procedure re-validates
    /// independently regardless of which branch got the caller past this policy: a council
    /// officer only succeeds for a member with NO UserAccount yet AND who has never redeemed a
    /// link, over a chapter inside his own council's jurisdiction — this policy grants no
    /// standing power over an already-enrolled member, ever (CLAUDE.md invariant #16).
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

    /// <summary>
    /// ChapterAdmin only — file (or resubmit) a chapter's officer-turnover registration.
    /// Same role bar as <see cref="ChapterMembershipApprove"/>/<see cref="ChapterMembersEnrolmentReissue"/>
    /// for the same reason: usp_ChapterRegistration_SubmitTurnover re-derives the caller's own
    /// chapter from this SAME role, server-side — a chapter's officer roster is filed by its
    /// own sitting Chapter Admin, nobody else (§7A.4 decision E1a).
    /// </summary>
    public const string ChapterOfficerRosterFile = "ChapterOfficerRosterFile";

    /// <summary>
    /// CouncilSecretary or CouncilAdmin — see a council's chapter-registration queue/detail,
    /// tick an officer's verification, or return a registration for correction. NOTE:
    /// <c>ChapterAuditor</c> must NEVER be added here or to any other write-granting policy —
    /// it is deliberately read-only (docs §7A.4: "an auditor who can edit what he audits is
    /// not an auditor"). This is a COUNCIL role check (CouncilSecretary/CouncilAdmin), not to
    /// be confused with the chapter-level ChapterAuditor office seeded by
    /// db/schema/17_chapter_registration.sql, which never appears in any policy at all.
    /// </summary>
    public const string CouncilChapterRegistrationVerify = "CouncilChapterRegistrationVerify";

    /// <summary>
    /// CouncilAdmin only — final approval of a chapter registration (charter or turnover).
    /// Narrower than <see cref="CouncilChapterRegistrationVerify"/> by design, same two-person-
    /// control reasoning as <see cref="ChapterMeetingsFinalize"/> narrowing
    /// <see cref="ChapterMeetingsWrite"/>: verifying individual officers is the Secretary's (or
    /// the Admin's) job; giving final approval — which creates member records / regenerates
    /// credentials — is reserved for the council's own most accountable officer (§7A.4
    /// decision E1b). <c>ChapterAuditor</c> must NEVER be added here either, for the same
    /// reason noted on <see cref="CouncilChapterRegistrationVerify"/>.
    /// </summary>
    public const string CouncilChapterRegistrationApprove = "CouncilChapterRegistrationApprove";

    /// <summary>
    /// CouncilSecretary or CouncilAdmin — read council-wide/chapter-subtree statistics
    /// (GET /api/councils/statistics, GET /api/councils/{councilId}/statistics). Same role
    /// bar as <see cref="CouncilChapterRegistrationVerify"/>: read-only, but still a seated
    /// council office, not open to every member. <c>ChapterAuditor</c> must NEVER be added
    /// here either, same reasoning as <see cref="CouncilChapterRegistrationVerify"/>'s own
    /// note. Do NOT add ProvincialOfficer/RegionalOfficer/NationalSecretariat/SystemAdmin
    /// here or to any policy — these are seeded role names (db/seed/01_reference.sql) that
    /// grant nothing anywhere in code today, and this must not be the first place they
    /// silently start meaning something.
    /// </summary>
    public const string CouncilStatisticsRead = "CouncilStatisticsRead";

    /// <summary>
    /// CouncilAdmin — block/unblock a member's login, force a password reset, and view
    /// currently-blocked members. The ROLE bar here is coarse (any CouncilAdmin seat, at
    /// any level) — the actual restriction to specifically National Council is enforced
    /// inside usp_Member_Block/_Unblock/_ResetPassword/_ListBlocked themselves (same
    /// defence-in-depth posture as <see cref="CouncilStatisticsRead"/>'s own subtree
    /// check), because a role claim carries no council-level information to check here.
    /// Client decision (2026-09-21): National only, deliberately narrower than
    /// <see cref="CouncilStatisticsRead"/> — see usp_Enrolment_Issue's own header for why
    /// "any council officer may manage the login of any member anywhere beneath it" is a
    /// standing power this codebase has consistently refused to grant more broadly.
    /// </summary>
    public const string NationalMemberAccountManage = "NationalMemberAccountManage";

    /// <summary>
    /// CouncilAdmin — create a council, seat/unseat an officer, browse or look up a
    /// seating candidate. The ROLE bar here is coarse (any CouncilAdmin seat, at any
    /// level) — the actual restriction to the specific council authorized to act (the
    /// nearest ancestor with seated officers, per invariant #13a) is enforced inside
    /// usp_Council_Create/_SeatOfficer/_UnseatOfficer/_EligibleOfficers/_MemberLookup
    /// themselves, same defence-in-depth posture as every other council-facing policy
    /// in this file. Do NOT add CouncilSecretary/CouncilTreasurer here — seating and
    /// creation are consequential, irreversible-in-effect actions (a seated officer
    /// gets a real login), same two-person-integrity reasoning as
    /// <see cref="CouncilChapterRegistrationApprove"/> narrowing
    /// <see cref="CouncilChapterRegistrationVerify"/>.
    /// </summary>
    public const string CouncilSeatOfficer = "CouncilSeatOfficer";

    /// <summary>
    /// Any real council office — read-only. Council registry/roster viewing is
    /// deliberately broader than <see cref="CouncilSeatOfficer"/>: a Secretary or
    /// Treasurer has legitimate reason to see who is seated where, even though only a
    /// CouncilAdmin may change it. usp_Council_GetRegistry/_GetRoster re-scope this to
    /// the caller's own dbo.fn_MemberCouncilScope regardless of role. <c>CouncilAuditor</c>
    /// and the inert seeded role names (ProvincialOfficer/RegionalOfficer/
    /// NationalSecretariat/SystemAdmin) must NEVER be added here or to any policy.
    /// </summary>
    public const string CouncilRegistryRead = "CouncilRegistryRead";
}
