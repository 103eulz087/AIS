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
 * ChapterAdmin only — re-issue an enrolment link for an existing member who forgot his
 * password. Mirrors AuthorizationPolicies.ChapterMembersEnrolmentReissue. Same narrowing
 * as canApproveApplications: granting account access is a Chapter Admin action, not a
 * general officer one.
 */
export function canReissueEnrolmentLink(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin");
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
