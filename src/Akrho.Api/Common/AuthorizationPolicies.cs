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
    /// Phase 1 "dynamic council office permissions" (2026-10-17): widened to all six council
    /// roles (CouncilAdmin, CouncilOfficer, CouncilSecretary, CouncilTreasurer, CouncilPIO,
    /// CouncilAuditor), including CouncilAuditor. This is now only the coarse "holds SOME
    /// council office" pre-check — the real gate is the stored procedure, via
    /// dbo.fn_MemberSeatPermissions over the ChapterRegistration.Review/Verify/Approve/Return
    /// keys (db/schema/28_council_permissions.sql), which usp_ChapterRegistration_GetQueue/
    /// _Get/_VerifyOfficer/_Return check themselves. CouncilAuditor clears this ROLE check but
    /// is never granted ChapterRegistration.Verify/Approve/Return by default (dbo.CouncilOffice
    /// seeds it IsReadOnly) — adding a write permission to a read-only office is itself
    /// rejected by usp_CouncilPermission_Set (51934), so an auditor who can edit what he
    /// audits (docs §7A.4) stays structurally impossible, enforced in the procedure, not here.
    /// </summary>
    public const string CouncilChapterRegistrationVerify = "CouncilChapterRegistrationVerify";

    /// <summary>
    /// Final approval of a chapter registration (charter or turnover). Originally
    /// CouncilAdmin-only, then CouncilSecretary/CouncilAdmin (§7A.4 decision E1b widened
    /// 2026-10-06), now the same all-six-roles coarse check as
    /// <see cref="CouncilChapterRegistrationVerify"/> (Phase 1, 2026-10-17) — same reasoning:
    /// the real gate is usp_ChapterRegistration_Approve's own fn_MemberSeatPermissions check
    /// over ChapterRegistration.Approve, and CouncilAuditor's seeded IsReadOnly office makes
    /// holding that key structurally impossible without usp_CouncilPermission_Set rejecting
    /// the grant (51934) first.
    /// </summary>
    public const string CouncilChapterRegistrationApprove = "CouncilChapterRegistrationApprove";

    /// <summary>
    /// Read council-wide/chapter-subtree statistics (GET /api/councils/statistics, GET
    /// /api/councils/{councilId}/statistics). Phase 1 (2026-10-17): widened to all six council
    /// roles, same coarse-check-only reasoning as <see cref="CouncilChapterRegistrationVerify"/>
    /// — usp_CouncilStatistics_Get's own 51620/51621 checks are the real gate, scoped via
    /// dbo.fn_MemberPermissionScope(@RequestingMemberId, 'CouncilStatistics.Read'). Do
    /// NOT add ProvincialOfficer/RegionalOfficer/NationalSecretariat/SystemAdmin here or to any
    /// policy — these are seeded role names (db/seed/01_reference.sql) that grant nothing
    /// anywhere in code today, and this must not be the first place they silently start
    /// meaning something.
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

    /// <summary>
    /// ChapterAdmin OR CouncilAdmin — view a chapter's own officer roster, seat/replace an
    /// officer, or unseat one. Deliberately BOTH roles on one policy, not split the way
    /// CouncilSeatOfficer/CouncilRegistryRead are: usp_Chapter_SeatOfficer/_UnseatOfficer
    /// themselves enforce the real, narrower split (client decision 2026-09-22) — a
    /// ChapterAdmin may act on every office EXCEPT President; only a CouncilAdmin seated at
    /// the chapter's own resolved seating authority may act on the President seat. This
    /// policy is only the coarse "is this caller either kind of officer at all" pre-check;
    /// same defence-in-depth posture as every other policy in this file. Do NOT add
    /// ChapterOfficer/ChapterTreasurer/ChapterAuditor or CouncilSecretary here — seating is
    /// consequential (installs or removes a real standing office), same two-person-
    /// integrity reasoning as <see cref="CouncilSeatOfficer"/>.
    /// </summary>
    public const string ChapterOfficerSeat = "ChapterOfficerSeat";

    /// <summary>
    /// ChapterAdmin only — correct a same-chapter member's typo'd FirstName/MiddleName/
    /// LastName/MobileNo (PUT /api/members/{memberId}/identity). Mirrors the ROLE bar
    /// usp_Member_UpdateOwnProfile's own header comment anticipates for this exact
    /// capability ("editable only by an officer, through a future module") — this is
    /// that module. usp_Member_UpdateByOfficer re-derives the real restriction (same
    /// chapter as the caller's own ChapterAdmin seat) server-side regardless of this
    /// coarse role check, same "coarse client check, real server check" posture as
    /// every other policy in this file. <c>ChapterOfficer</c>/<c>ChapterTreasurer</c>/
    /// <c>ChapterAuditor</c> must never be added here — a member's own legal name and
    /// contact number are organizational-identity facts, same two-person-integrity
    /// bar as <see cref="ChapterMoneyVoid"/> and <see cref="ChapterDisciplineWrite"/>.
    /// </summary>
    public const string ChapterMemberIdentityEdit = "ChapterMemberIdentityEdit";

    /// <summary>
    /// Any real council office — read-only global member search (GET
    /// /api/members/search-jurisdiction), by name, member number, or mobile number. Phase 1
    /// (2026-10-17): widened to all six council roles, including CouncilAuditor — same
    /// coarse-check-only reasoning as <see cref="CouncilChapterRegistrationVerify"/>.
    /// usp_Member_SearchByJurisdiction/_GetByJurisdiction re-derive the caller's own
    /// dbo.fn_MemberCouncilScope regardless of role — a National officer's own scope happens
    /// to be the whole tree, a Regional/Provincial/City officer's is only his own subtree;
    /// this policy never knows or checks which. Do NOT add the inert seeded role names
    /// (ProvincialOfficer/RegionalOfficer/NationalSecretariat/SystemAdmin) here or to any
    /// policy, same reasoning as <see cref="CouncilStatisticsRead"/>'s own note.
    /// </summary>
    public const string CouncilMemberSearchRead = "CouncilMemberSearchRead";

    /// <summary>
    /// CouncilAdmin only — place a chapter on hold, release one, or search chapters to
    /// find one (GET /api/chapters/search-jurisdiction, POST .../hold, POST .../release).
    /// Client decision 2026-09-22, made with a documented prior precedent in front of it:
    /// usp_Member_Block's own header records a deliberate earlier decision to keep
    /// account-management narrowed to National Council alone ("a standing power to
    /// manage any member's account anywhere beneath a council is the thing this codebase
    /// has consistently refused to build"). This policy's coarse ROLE bar can't express
    /// the real per-chapter split (National, OR the chapter's own resolved governing
    /// council — see usp_Chapter_Hold.sql) — that is re-derived entirely server-side by
    /// usp_Chapter_Hold/_Release via usp_Approval_ResolveApprover, same "coarse client
    /// check, real server check" posture as every other policy in this file. Do NOT add
    /// CouncilSecretary/CouncilTreasurer/CouncilOfficer/CouncilPIO here — freezing an
    /// entire chapter's logins at once is at least as consequential as blocking one
    /// member, which is CouncilAdmin-only for the same reason.
    /// </summary>
    public const string ChapterHoldManage = "ChapterHoldManage";

    /// <summary>
    /// CouncilAdmin only — post or withdraw a National announcement (visible in every
    /// chapter's own feed, POST /api/announcements/national and its /withdraw). Same
    /// coarse ROLE bar as <see cref="ChapterHoldManage"/>/<see cref="CouncilSeatOfficer"/>
    /// — the real "specifically the National Council's own Admin, not a CouncilAdmin
    /// seated elsewhere" restriction is re-derived entirely server-side by
    /// usp_Announcement_CreateNational/_WithdrawNational, same "coarse client check, real
    /// server check" posture as every other policy in this file. Do NOT add
    /// CouncilSecretary/CouncilTreasurer/CouncilOfficer/CouncilPIO here — broadcasting to
    /// every chapter AIS user in the organization is at least as consequential as placing
    /// one chapter on hold, which is CouncilAdmin-only for the same reason.
    /// </summary>
    public const string NationalAnnouncementManage = "NationalAnnouncementManage";

    /// <summary>
    /// CouncilAdmin — search a chapter's own member list and tag/untag whoever has paid
    /// this membership year (GET /api/member-payment-tags/chapters/{chapterId}/members,
    /// POST .../members/{memberId}). Client decision 2026-09-29: held at National alone
    /// while chapters are still rolling out — deliberately narrower than the "National, or
    /// the chapter/council's own governing body" split <see cref="ChapterHoldManage"/> uses;
    /// see usp_MemberPaymentTag_Set.sql's own header. The real "specifically the seated
    /// National CouncilAdmin, not one seated elsewhere" restriction is re-derived entirely
    /// server-side by usp_MemberPaymentTag_GetChapterMembers/_Set, same "coarse client
    /// check, real server check" posture as every other policy in this file. Do NOT add
    /// CouncilSecretary/CouncilTreasurer/CouncilOfficer/CouncilPIO here — this is a brand
    /// new, informal control the client wants held at National alone, same reasoning as
    /// <see cref="NationalMemberAccountManage"/>.
    /// </summary>
    public const string MemberPaymentTagManage = "MemberPaymentTagManage";

    /// <summary>
    /// ChapterAdmin only — stage or set the caller's OWN chapter's logo (POST
    /// /api/members/me/chapter-logo/stage, POST /api/members/me/chapter-logo). Per this
    /// codebase's own officer-seeding convention (db/seed/01_reference.sql), the
    /// 'ChapterAdmin' role IS the President's office — nothing else maps to it — so this
    /// reuses that role bar directly rather than inventing a separate "President" claim,
    /// same posture as <see cref="ChapterMemberIdentityEdit"/>/<see cref="ChapterOfficerRosterFile"/>.
    /// The real "specifically the caller's OWN chapter" restriction is re-derived
    /// entirely server-side by usp_Chapter_SetLogo (it resolves the chapter from the
    /// caller's own Member row — there is no chapter id in the request to substitute).
    /// GET /api/members/me/chapter-logo carries NO policy beyond plain authentication —
    /// any member needs to see his own chapter's logo on his own Digital ID, not just
    /// the President who set it.
    /// </summary>
    public const string ChapterLogoManage = "ChapterLogoManage";

    /// <summary>
    /// CouncilSecretary or CouncilAdmin — the National ID card export (GET
    /// /api/id-card-exports and its /digital-id variant). Split out (Phase 1, 2026-10-17)
    /// from <see cref="CouncilChapterRegistrationApprove"/>, which it used to reuse, so that
    /// widening CouncilChapterRegistrationApprove to all six council roles does not also
    /// widen who may bulk-export every member's photo and credential data — this stays
    /// exactly the pre-widening role set. The procedures' own 51581 check (National Council
    /// only, re-derived from @RequestingMemberId) remains the real restriction; this policy
    /// is only the coarse "must hold one of these two roles, on some council" pre-check.
    /// </summary>
    public const string NationalIdCardExport = "NationalIdCardExport";

    /// <summary>
    /// Any real council office — read a council's own permission grid (GET
    /// /api/councils/{councilId}/permissions). Same all-six-roles coarse bar as
    /// <see cref="CouncilChapterRegistrationVerify"/>/<see cref="CouncilStatisticsRead"/>:
    /// visibility is intentionally broader than who may edit (any officer who may see the
    /// council at all may see what it grants — usp_CouncilPermission_GetGrid's own header),
    /// re-derived server-side via dbo.fn_MemberCouncilScope (51930 if the council is outside
    /// the caller's view). <c>CouncilAuditor</c> belongs here same as everywhere else in this
    /// group — read access was never the risk; see <see cref="CouncilPermissionsManage"/> for
    /// the actual write boundary.
    /// </summary>
    public const string CouncilPermissionsRead = "CouncilPermissionsRead";

    /// <summary>
    /// CouncilAdmin only — edit a council's own permission grid (PUT
    /// /api/councils/{councilId}/permissions). Deliberately narrower than
    /// <see cref="CouncilPermissionsRead"/>, and deliberately NOT widened to every council
    /// role the way the four Phase 1 policies above were: this is the one capability that
    /// decides every OTHER council capability, so it is reserved for that council's own
    /// seated President alone — there is no "manage permissions" key to delegate this away
    /// with either (db/schema/28_council_permissions.sql's own header). The coarse ROLE bar
    /// here only confirms the caller holds SOME CouncilAdmin seat; usp_CouncilPermission_Set's
    /// own 51931 is what actually confirms it is THIS council's own currently-seated
    /// President, never a parent's.
    /// </summary>
    public const string CouncilPermissionsManage = "CouncilPermissionsManage";
}
