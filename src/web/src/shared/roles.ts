/**
 * Role-gating helpers for officer-only UI.
 *
 * These mirror src/Akrho.Api/Common/AuthorizationPolicies.cs — deliberately narrower
 * than "is this member any kind of officer" in the same places the backend is
 * narrower, so a button never promises an action the API will then 403 on.
 * The backend enforces every one of these again server-side; these functions only
 * decide what to SHOW, never what to allow.
 *
 * Phase 1 "dynamic council office permissions" (2026-10-17): four of these —
 * canReviewChapterRegistrations, canApproveChapterRegistrations,
 * canViewCouncilStatistics, canSearchMembersByJurisdiction — used to gate on ROLE NAME
 * (CouncilSecretary/CouncilAdmin, or the wider five-role set for search). The matching
 * backend policies (AuthorizationPolicies.CouncilChapterRegistrationVerify/Approve,
 * CouncilStatisticsRead, CouncilMemberSearchRead) were widened to a coarse "holds SOME
 * council office" pre-check — the real gate moved to a per-office, per-council PERMISSION
 * KEY a council's own President can grant or revoke (db/schema/28_council_permissions.sql,
 * GET /api/auth/me's own councilSeats). These four functions were re-implemented on top
 * of that — they now take the caller's own CouncilSeatPermissions array, never roles —
 * so a role check here can no longer promise a capability a council has since revoked
 * from that office, or withhold one it has since granted. Every OTHER helper in this file
 * is still role-based by design (phase 2 scope, unchanged) — do not convert them without
 * a matching backend permission key to drive them.
 */
import type { CouncilSeatPermissions } from "@/shared/types";

/** The council permission keys, exactly as seeded in dbo.CouncilPermission
 * (db/schema/28_council_permissions.sql — the first six are phase 1; the two
 * MemberPaymentTag keys are National-only and held by National's President by default). Use these constants, never a hand-typed
 * string, so a typo fails at compile time instead of silently never matching. */
export const COUNCIL_PERMISSION = {
  ChapterRegistrationReview: "ChapterRegistration.Review",
  ChapterRegistrationVerify: "ChapterRegistration.Verify",
  ChapterRegistrationApprove: "ChapterRegistration.Approve",
  ChapterRegistrationReturn: "ChapterRegistration.Return",
  CouncilStatisticsRead: "CouncilStatistics.Read",
  CouncilMemberSearchRead: "CouncilMemberSearch.Read",
  MemberPaymentTagRead: "MemberPaymentTag.Read",
  MemberPaymentTagSet: "MemberPaymentTag.Set",
} as const;

export type CouncilPermissionKeyName = typeof COUNCIL_PERMISSION[keyof typeof COUNCIL_PERMISSION];

/** True if ANY of the caller's council seats currently carries this permission key —
 * a member seated on two councils only needs one of them to grant it. */
export function hasCouncilPermission(
  seats: readonly CouncilSeatPermissions[], key: string,
): boolean {
  return seats.some(s => s.permissions.includes(key));
}

/** True if the caller is the currently-seated President of ANY council he holds a seat
 * on — the only capability phase 1 never makes grantable (db/schema/28_council_
 * permissions.sql's own header: "there is deliberately NO 'manage permissions' key").
 * Drives whether the Office Permissions screen offers a council to EDIT, not just view. */
export function canManageCouncilPermissions(seats: readonly CouncilSeatPermissions[]): boolean {
  return seats.some(s => s.canManagePermissions);
}

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
 * See a council's chapter-registration queue and detail, tick officers off as verified,
 * return a registration for correction. Gates on the caller's own ChapterRegistration.
 * Review permission key (any seat), per this file's own header note on phase 1 —
 * formerly a CouncilSecretary/CouncilAdmin role check; today's default grant reproduces
 * that same role bar byte for byte (db/schema/28_council_permissions.sql), so nothing
 * visibly changes for an existing council until its own President edits the grid.
 */
export function canReviewChapterRegistrations(seats: readonly CouncilSeatPermissions[]): boolean {
  return hasCouncilPermission(seats, COUNCIL_PERMISSION.ChapterRegistrationReview);
}

/**
 * View the council statistics rollup (council-to-council, council-to-chapter,
 * chapter-to-member). Gates on CouncilStatistics.Read (any seat) — same phase 1 note as
 * canReviewChapterRegistrations above; the default grant is CouncilSecretary + CouncilAdmin's
 * old role bar, unchanged until a council's own President edits its grid.
 */
export function canViewCouncilStatistics(seats: readonly CouncilSeatPermissions[]): boolean {
  return hasCouncilPermission(seats, COUNCIL_PERMISSION.CouncilStatisticsRead);
}

/**
 * Final approval of a chapter registration (charter or turnover), ANYWHERE the caller is
 * seated — gates on ChapterRegistration.Approve (any seat), same phase 1 note as
 * canReviewChapterRegistrations above. The default grant still reproduces the
 * CouncilSecretary/CouncilAdmin role bar widened 2026-10-06 (a Secretary confined to this
 * one module end to end — verify AND approve, no other Portal access; see
 * PortalShell.tsx's own nav-filtering comment) — unchanged until a council's own
 * President edits its grid. ChapterRegistrationDetail.tsx itself drives its own Approve
 * button from the per-registration data.canApprove the detail endpoint returns instead (a
 * direct-seat check scoped to THAT registration's own acting council) — this coarser
 * function is kept for any screen that only needs "can approve something, somewhere".
 */
export function canApproveChapterRegistrations(seats: readonly CouncilSeatPermissions[]): boolean {
  return hasCouncilPermission(seats, COUNCIL_PERMISSION.ChapterRegistrationApprove);
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
 * ChapterAdmin OR CouncilAdmin — view a chapter's own officer roster, seat/replace an
 * officer, or unseat one. Mirrors AuthorizationPolicies.ChapterOfficerSeat's own ROLE
 * bar — deliberately coarse: the real, narrower split (a ChapterAdmin may act on every
 * office except President; only a CouncilAdmin at the chapter's resolved seating
 * authority may act on the President seat) is enforced server-side inside
 * usp_Chapter_SeatOfficer/_UnseatOfficer themselves, same "coarse client check, real
 * server check" posture as canSeatCouncilOfficers above.
 */
export function canSeatChapterOfficers(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin") || roles.includes("CouncilAdmin");
}

/**
 * ChapterAdmin only — correct a same-chapter member's typo'd first/middle/last name or
 * mobile number. Mirrors AuthorizationPolicies.ChapterMemberIdentityEdit's own ROLE bar
 * (Program.cs: RequireRole("ChapterAdmin")). ChapterOfficer/ChapterTreasurer/
 * ChapterAuditor must never be added here — same two-person-integrity bar as
 * canFileOfficerRoster above.
 */
export function canEditMemberIdentity(roles: readonly string[]): boolean {
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

/**
 * The Council Portal's global member search. Gates on CouncilMemberSearch.Read (any
 * seat) — same phase 1 note as canReviewChapterRegistrations above. The default grant
 * reproduces the old five-role bar exactly (CouncilSecretary, CouncilAdmin,
 * CouncilTreasurer, Vice President/CouncilOfficer, CouncilPIO — a Secretary or Treasurer
 * has as much legitimate reason to look a member up as an Admin does), unchanged until a
 * council's own President edits its grid; CouncilAuditor still holds nothing by default
 * (its seeded IsReadOnly office). Which members the search actually returns is scoped
 * server-side to the caller's own jurisdiction (usp_Member_SearchByJurisdiction) — this
 * helper only decides whether to show the screen at all.
 */
export function canSearchMembersByJurisdiction(seats: readonly CouncilSeatPermissions[]): boolean {
  return hasCouncilPermission(seats, COUNCIL_PERMISSION.CouncilMemberSearchRead);
}

/**
 * CouncilAdmin only — place a chapter on hold (freezing every one of its members'
 * logins at once) or release one. Mirrors AuthorizationPolicies.ChapterHoldManage's own
 * ROLE bar; the real "National, or this chapter's own governing council" split is
 * re-derived entirely server-side (usp_Chapter_Hold/_Release), same "coarse client
 * check, real server check" posture as every other helper in this file. A CouncilAdmin
 * seated somewhere with no standing over a given chapter still sees this screen and is
 * turned away by the real 403 those procedures return.
 */
export function canManageChapterHolds(roles: readonly string[]): boolean {
  return roles.includes("CouncilAdmin");
}

/**
 * CouncilAdmin only — post or withdraw a National announcement (visible in every
 * chapter's own dashboard). Mirrors AuthorizationPolicies.NationalAnnouncementManage's
 * own ROLE bar; the real "specifically the National Council's own Admin" restriction
 * is re-derived entirely server-side (usp_Announcement_CreateNational/_WithdrawNational),
 * same "coarse client check, real server check" posture as every other helper here.
 */
export function canPostNationalAnnouncements(roles: readonly string[]): boolean {
  return roles.includes("CouncilAdmin");
}

/**
 * View the member payment tag list and the Paid/Unpaid/Free report. Gates on
 * MemberPaymentTag.Read (any seat). National-only: the key is only ever granted on
 * National Council seats, and by default only National's President holds it. The real
 * restriction is re-derived server-side by the payment tag procedures.
 */
export function canViewPaymentTags(seats: readonly CouncilSeatPermissions[]): boolean {
  return hasCouncilPermission(seats, COUNCIL_PERMISSION.MemberPaymentTagRead);
}

/**
 * Change a member's payment tag (Paid / Unpaid / Free). Gates on MemberPaymentTag.Set
 * (any seat), which itself requires MemberPaymentTag.Read in the permission grid. A user
 * who can view but not set sees the list read-only.
 */
export function canSetPaymentTags(seats: readonly CouncilSeatPermissions[]): boolean {
  return hasCouncilPermission(seats, COUNCIL_PERMISSION.MemberPaymentTagSet);
}

/**
 * ChapterAdmin only — upload the chapter's own logo, shown on every member's Digital ID.
 * Mirrors AuthorizationPolicies.ChapterLogoManage's own ROLE bar: per this codebase's
 * officer-seeding convention, 'ChapterAdmin' IS the President's office, so this reuses
 * that role bar directly rather than a separate "President" claim — same posture as
 * canFileOfficerRoster/canEditMemberIdentity above.
 */
export function canManageChapterLogo(roles: readonly string[]): boolean {
  return roles.includes("ChapterAdmin");
}
