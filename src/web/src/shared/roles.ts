/**
 * Role-gating helpers for officer-only UI.
 *
 * These mirror src/Akrho.Api/Common/AuthorizationPolicies.cs — deliberately narrower
 * than "is this member any kind of officer" in the same places the backend is
 * narrower, so a button never promises an action the API will then 403 on.
 * The backend enforces every one of these again server-side; these functions only
 * decide what to SHOW, never what to allow.
 */

/** ChapterOfficer or ChapterAdmin — create/edit a meeting, save/clear attendance. */
export function canWriteMeetings(roles: readonly string[]): boolean {
  return roles.includes("ChapterOfficer") || roles.includes("ChapterAdmin");
}

/** ChapterAdmin only — finalize a meeting (posts to the ledger). */
export function canFinalizeMeetings(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin");
}

/** ChapterTreasurer or ChapterAdmin — reopen a finalized meeting / reverse a ledger entry. */
export function canReopenMeetings(roles: readonly string[]): boolean {
  return roles.includes("ChapterTreasurer") || roles.includes("ChapterAdmin");
}

/** ChapterOfficer or ChapterAdmin — create an activity, close an activity. */
export function canWriteActivities(roles: readonly string[]): boolean {
  return roles.includes("ChapterOfficer") || roles.includes("ChapterAdmin");
}

/** ChapterTreasurer or ChapterAdmin — record an expense, stage a receipt attachment. */
export function canWriteExpenses(roles: readonly string[]): boolean {
  return roles.includes("ChapterTreasurer") || roles.includes("ChapterAdmin");
}

/** ChapterTreasurer or ChapterAdmin — record a donation. */
export function canWriteDonations(roles: readonly string[]): boolean {
  return roles.includes("ChapterTreasurer") || roles.includes("ChapterAdmin");
}

/**
 * ChapterAdmin only — void an expense or a donation. Narrower than canWriteExpenses/
 * canWriteDonations on purpose: mirrors AuthorizationPolicies.ChapterMoneyVoid, an
 * irreversible correction to money already posted and already disclosed on the
 * chapter's ledger, same reasoning as canFinalizeMeetings vs. canWriteMeetings.
 */
export function canVoidMoney(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin");
}

/** ChapterOfficer or ChapterAdmin — post an announcement or memo. No screen uses this yet. */
export function canWriteComms(roles: readonly string[]): boolean {
  return roles.includes("ChapterOfficer") || roles.includes("ChapterAdmin");
}

/** ChapterAdmin only — file a corrective action. No screen uses this yet. */
export function canWriteDiscipline(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin");
}

/**
 * ChapterAdmin only — review and decide membership applications (registration
 * approvals). Mirrors AuthorizationPolicies.ChapterMembershipApprove. A member is
 * created by his chapter (CLAUDE.md invariant #13), and within the chapter this is a
 * Chapter Admin action specifically, not a general officer one — same narrowing as
 * canFinalizeMeetings/canVoidMoney.
 */
export function canApproveApplications(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin");
}

/**
 * ChapterOfficer or ChapterAdmin — remove a public chat message, resolve its flags, or
 * view the moderation queue. Mirrors AuthorizationPolicies.ChapterChatModerate
 * (Program.cs), same role set as canWriteComms/canWriteActivities above, kept as its
 * own function per this file's one-capability-per-helper convention.
 */
export function canModerateChat(roles: readonly string[]): boolean {
  return roles.includes("ChapterOfficer") || roles.includes("ChapterAdmin");
}

/**
 * ChapterAdmin (the ordinary "forgot his password" case), OR CouncilSecretary/CouncilAdmin
 * (a brand-new chapter's very first President, before any ChapterAdmin exists to reissue his
 * own first link). Mirrors AuthorizationPolicies.ChapterMembersEnrolmentReissue exactly —
 * the API's own usp_Enrolment_Issue call is what actually narrows the council case down
 * further (first-credential-only, jurisdiction-scoped); this is only the "should this
 * button be offered at all" check, same role as everywhere else in this codebase.
 */
export function canReissueEnrolmentLink(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin") || roles.includes("CouncilSecretary") || roles.includes("CouncilAdmin");
}

/** ChapterAdmin only — generate/regenerate the chapter's own permanent join link/QR
 * code. Mirrors AuthorizationPolicies' own ChapterAdmin-only gate on
 * usp_ChapterInviteLink_GetOwn/_Regenerate. */
export function canManageChapterInviteLink(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin");
}

/**
 * CouncilAdmin — block/unblock a member's login, force a password reset, view currently
 * blocked members. Mirrors AuthorizationPolicies.NationalMemberAccountManage's own ROLE
 * bar (any CouncilAdmin) — but the real restriction to specifically National Council is
 * enforced server-side inside usp_Member_Block/_Unblock/_ResetPassword/_ListBlocked
 * themselves, since a role claim carries no council-level information for this helper to
 * check. A CouncilAdmin seated elsewhere still sees these buttons and is turned away by
 * the real 403 those procedures return — same "coarse client check, real server check"
 * posture as canExportIdCards' own doc comment describes.
 */
export function canManageMemberAccounts(roles: readonly string[]): boolean {
  return roles.includes("CouncilAdmin");
}

/**
 * CouncilAdmin — create a council, seat/unseat an officer, browse or look up a seating
 * candidate. Mirrors AuthorizationPolicies.CouncilSeatOfficer's own ROLE bar — the real
 * restriction to the specific council actually authorized to act is enforced server-side
 * (usp_Council_ResolveSeatingAuthority), same "coarse client check, real server check"
 * posture as canManageMemberAccounts above.
 */
export function canSeatCouncilOfficers(roles: readonly string[]): boolean {
  return roles.includes("CouncilAdmin");
}

/**
 * Any real council office — read-only registry/roster viewing. Mirrors
 * AuthorizationPolicies.CouncilRegistryRead: deliberately broader than
 * canSeatCouncilOfficers, since a Secretary or Treasurer has legitimate reason to see
 * who is seated where even though only a CouncilAdmin may change it. CouncilAuditor and
 * the inert seeded role names (ProvincialOfficer/RegionalOfficer/NationalSecretariat/
 * SystemAdmin) must NEVER be added here or to any helper in this file.
 */
export function canViewCouncilRegistry(roles: readonly string[]): boolean {
  return roles.includes("CouncilSecretary") || roles.includes("CouncilAdmin")
      || roles.includes("CouncilTreasurer") || roles.includes("CouncilOfficer") || roles.includes("CouncilPIO");
}

/**
 * CouncilSecretary or CouncilAdmin — see a council's chapter-registration queue and
 * detail, tick officers off as verified, return a registration for correction. Mirrors
 * AuthorizationPolicies.CouncilChapterRegistrationVerify (Program.cs:
 * RequireRole("CouncilSecretary", "CouncilAdmin")). This is a COUNCIL role check, wholly
 * separate from ChapterAdmin/ChapterOfficer above.
 */
export function canReviewChapterRegistrations(roles: readonly string[]): boolean {
  return roles.includes("CouncilSecretary") || roles.includes("CouncilAdmin");
}

/**
 * CouncilSecretary or CouncilAdmin — view the council statistics rollup (council-to-
 * council, council-to-chapter, chapter-to-member). Mirrors
 * AuthorizationPolicies.CouncilStatisticsRead (Program.cs), same role set as
 * canReviewChapterRegistrations above — the Secretary is the council's record-keeper
 * and already sees the registration queue, so this does not narrow further to
 * CouncilAdmin alone.
 */
export function canViewCouncilStatistics(roles: readonly string[]): boolean {
  return roles.includes("CouncilSecretary") || roles.includes("CouncilAdmin");
}

/**
 * CouncilAdmin only — final approval of a chapter registration (charter or turnover).
 * Narrower than canReviewChapterRegistrations by design, same two-person-integrity
 * reasoning as canFinalizeMeetings vs. canWriteMeetings: a Secretary can verify every
 * officer but a President/CouncilAdmin alone commits the decision. Mirrors
 * AuthorizationPolicies.CouncilChapterRegistrationApprove (Program.cs:
 * RequireRole("CouncilAdmin")).
 */
export function canApproveChapterRegistrations(roles: readonly string[]): boolean {
  return roles.includes("CouncilAdmin");
}

/**
 * ChapterAdmin only — file the chapter's own annual officer-turnover roster. Mirrors
 * AuthorizationPolicies.ChapterOfficerRosterFile (Program.cs: RequireRole("ChapterAdmin")).
 * ChapterAuditor is never granted this or any other function in this file — an auditor who
 * can edit what he audits is not an auditor (§7A.4).
 */
export function canFileOfficerRoster(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin");
}

/**
 * CouncilAdmin only — run the National ID card export. Mirrors
 * AuthorizationPolicies.CouncilChapterRegistrationApprove, which IdCardExportEndpoints.cs
 * deliberately reuses server-side rather than adding a new policy (RequireRole
 * "CouncilAdmin") — same role, same reasoning here. This is coarse on purpose: it only
 * confirms the caller holds CouncilAdmin on SOME council, not specifically the National
 * one — there is no cheap client-side way to know that without another round trip, so a
 * CouncilAdmin seated elsewhere still sees this screen and is turned away by the real
 * 403 the endpoint's own procedure returns (see IdCardExport.tsx).
 */
export function canExportIdCards(roles: readonly string[]): boolean {
  return roles.includes("CouncilAdmin");
}
