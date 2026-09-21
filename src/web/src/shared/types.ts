/** Member as returned to someone in the SAME chapter. */
export interface Member {
  memberId: number;
  giftName: string;
  memberNumber: string;
  chapterId: number;
  chapterName: string;
  status: string;
  fullName?: string;
  mobileNo?: string;
  profession?: string;
  bloodType?: string;
  photoUrl?: string;
  renewedThrough?: string;
  isCurrent?: boolean;
}

/**
 * Cross-chapter shape: gift name, chapter, status. Nothing else.
 * The other fields are ABSENT from the payload, not empty — do not add them
 * as optional properties "for convenience".
 */
export interface MemberCrossChapter {
  memberId: number;
  giftName: string;
  chapterId: number;
  chapterName: string;
  status: string;
}

export type DirectoryRow = Member | MemberCrossChapter;

export function isSameChapter(row: DirectoryRow): row is Member {
  return "memberNumber" in row;
}

/**
 * GET /api/chapters/{chapterId}/ledger/summary. Mirrors LedgerSummaryDto — a
 * server-computed rollup over the WHOLE ledger, never a client-side sum over a
 * paged list. This is the only sanctioned money aggregate on the Home dashboard
 * (CLAUDE.md invariant #5): a chapter-wide total, never a per-member figure.
 */
export interface LedgerSummary {
  cashIn: number;
  cashOut: number;
  balance: number;
}

export interface LedgerEntry {
  ledgerEntryId: number;
  entryDate: string;
  entryType: "In" | "Out";
  amount: number;
  description: string;
  sourceType: string;
  sourceId?: number;
  activityName?: string;
  isReversal: boolean;
  reversesEntryId?: number;
}

/** How confident we are that a scanned card is current. Never collapse Offline into Live. */
export type VerificationResult = "Live" | "Offline" | "Invalid" | "Revoked" | "Expired";

/**
 * GET /api/members/me/credential — self-only, what the Digital ID screen renders.
 * Mirrors MyCredentialDto exactly.
 *
 * dateSurvive/renewedThrough are DateOnly ("YYYY-MM-DD"), rendered with shortDate — never
 * hand-formatted. renewedThrough being null is NORMAL (no Portal renewal has run yet, not
 * "lapsed" — CLAUDE.md invariant #5's texture) and is simply omitted on screen, never shown
 * as any negative status.
 *
 * chapterName/chapterCode are null together for a detached, council-homed member (CK_Member_Home
 * — invariant #14); the council chain fields (cityName, provinceName, regionName,
 * nationalCouncilName, most specific first) are what the screen falls back to as "home" instead.
 *
 * verificationUrl is a RELATIVE path ("/verify/{token}") — CLAUDE.md invariant #8's own
 * carry-through to the frontend: never contains a MemberId or a name, and this screen must
 * resolve it against window.location.origin itself, never hardcode a domain.
 */
export interface MyCredential {
  giftName: string;
  fullName: string;
  memberNumber: string;
  chapterName: string | null;
  chapterCode: string | null;
  nationalCouncilName: string | null;
  regionName: string | null;
  provinceName: string | null;
  cityName: string | null;
  dateSurvive: string | null;
  bloodTypeName: string | null;
  statusName: string;
  renewedThrough: string | null;
  credentialIssuedDateUtc: string;
  credentialExpiryDateUtc: string;
  verificationUrl: string;
}

/**
 * One row of the chapter's meeting list. collectionTotal is the ONLY permitted fundAmount
 * aggregate here — the total for THIS meeting alone, never across meetings, never per
 * member (CLAUDE.md invariant #5). Mirrors MeetingListItemDto.
 */
export interface MeetingListItem {
  meetingId: number;
  subject: string;
  meetingDate: string;
  location: string | null;
  isFinalized: boolean;
  finalizedDateUtc: string | null;
  collectionTotal: number;
  presentCount: number;
  lateCount: number;
}

/**
 * One member's attendance for one meeting. Mirrors AttendanceRowDto.
 *
 * attendanceStatusId, fundAmount and checkedInAtUtc are nullable TOGETHER and
 * independently meaningful: null means "nobody has recorded him yet" for this
 * meeting — a real, distinct state from "recorded as absent" or "recorded as ₱0".
 * Never coerce null to 0 or to "Absent".
 *
 * NOTE: statusName is the MEMBER's own membership status (e.g. "Active"), not his
 * attendance status for this meeting — a genuine naming collision between
 * dbo.MemberStatus and dbo.AttendanceStatus in usp_Meeting_Get. Do not use it to
 * render attendance; use attendanceStatusId against ATTENDANCE_STATUSES instead.
 */
export interface AttendanceRow {
  memberId: number;
  giftName: string;
  memberNumber: string;
  statusName: string;
  attendanceStatusId: number | null;
  fundAmount: number | null;
  checkedInAtUtc: string | null;
}

/** One occurrence of a finalized meeting being reopened. Visible to the whole chapter. */
export interface MeetingReopen {
  meetingReopenId: number;
  reopenedBy: number;
  reopenedDateUtc: string;
  reason: string;
  reversedLedgerEntryId: number | null;
}

/** The full meeting: header, attendance sheet, and its reopen/correction trail. */
export interface MeetingDetail {
  meetingId: number;
  chapterId: number;
  subject: string;
  meetingDate: string;
  body: string | null;
  location: string | null;
  isFinalized: boolean;
  finalizedBy: number | null;
  finalizedDateUtc: string | null;
  createdBy: number;
  createdDateUtc: string;
  ledgerEntryId: number | null;
  ledgerEntryIsReversed: boolean;
  attendance: AttendanceRow[];
  reopenHistory: MeetingReopen[];
}

/**
 * The four attendance statuses. This is fixed reference data seeded at
 * db/seed/01_reference.sql (dbo.AttendanceStatus), in identity-column insertion
 * order (Present=1, Late=2, Excused=3, Absent=4).
 *
 * GAP: there is no GET endpoint exposing dbo.AttendanceStatus today. Hardcoded
 * here rather than building one — that is backend scope. Flagging for tech-lead/
 * backend: a small reference-data endpoint (e.g. GET /api/reference/attendance-statuses)
 * would let this list stop being duplicated by hand on the frontend.
 */
export const ATTENDANCE_STATUSES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1, name: "Present" },
  { id: 2, name: "Late" },
  { id: 3, name: "Excused" },
  { id: 4, name: "Absent" },
];

/**
 * One announcement. Mirrors AnnouncementDto (CommunicationsDtos.cs). There is no
 * restricted second shape here the way there is for CorrectiveActionDto — the body
 * is public to the whole chapter by design (short, time-sensitive, never disciplinary).
 *
 * expiryDate is a "day" value (yyyy-MM-dd), not a timestamp — render with shortDate,
 * never as a datetime.
 */
export interface Announcement {
  announcementId: number;
  title: string;
  body: string;
  isUrgent: boolean;
  urgentTypeId: number | null;
  urgentTypeName: string | null;
  bloodTypeId: number | null;
  bloodTypeName: string | null;
  publishDateUtc: string;
  expiryDate: string | null;
  createdBy: number;
  editedBy: number | null;
  editedDateUtc: string | null;
  isWithdrawn: boolean;
  withdrawnBy: number | null;
  withdrawnDateUtc: string | null;
  withdrawnReason: string | null;
  hasRead: boolean;
}

/**
 * One memo. Mirrors MemoDto. Immutable once published — never edited. A correction
 * is an entirely new memo with supersedesMemoId set to the one being corrected; the
 * old memo stays visible with isSuperseded/supersededByMemoId/supersededByMemoNumber
 * pointing forward at its replacement.
 */
export interface Memo {
  memoId: number;
  memoNumber: string;
  subject: string;
  body: string;
  publishDateUtc: string;
  createdBy: number;
  supersedesMemoId: number | null;
  isSuperseded: boolean;
  supersededByMemoId: number | null;
  supersededByMemoNumber: string | null;
  hasRead: boolean;
}

/** One reader of an announcement or memo. Mirrors ReadReceiptDto. Officer-only read. */
export interface ReadReceipt {
  memberId: number;
  giftName: string;
  fullName: string;
  readDateUtc: string;
}

/**
 * Announcement.UrgentTypeId reference data, seeded at db/seed/01_reference.sql
 * (dbo.UrgentType), in identity-column insertion order (BloodRequest=1, Assistance=2).
 *
 * GAP: there is no GET endpoint exposing dbo.UrgentType today, same kind of gap as
 * ATTENDANCE_STATUSES above — hardcoded here rather than building one, which is
 * backend scope.
 */
export const URGENT_TYPES: ReadonlyArray<{ id: number; name: string; label: string }> = [
  { id: 1, name: "BloodRequest", label: "Blood request" },
  { id: 2, name: "Assistance", label: "Assistance needed" },
];

/**
 * Announcement.BloodTypeId / Member.BloodTypeId reference data now has a live endpoint —
 * GET /api/blood-types, returning BloodTypeDto[] ({bloodTypeId, bloodTypeName}). The
 * GAP noted here previously (no GET endpoint) is closed; do not reintroduce a hardcoded
 * copy. Fetch it with a plain useQuery wherever it's needed (see Profile.tsx,
 * AnnouncementNew.tsx) — it changes rarely, so a long staleTime is appropriate.
 */
export interface BloodTypeOption { bloodTypeId: number; bloodTypeName: string }

/**
 * Member.SkillIds reference data — GET /api/skills, returning SkillDto[]
 * ({skillId, skillName}). Same live-endpoint shape as BloodTypeOption above.
 */
export interface SkillOption { skillId: number; skillName: string }

/**
 * One activity's own row. FundedTotal/SpentTotal are the ONLY totals this list ever
 * carries — both are whole-activity rollups (net of any voided expense/donation),
 * never per-donor, never per-member (CLAUDE.md invariant #5's texture, and the
 * hard "no donor leaderboard" rule for this module). Mirrors ActivityListItemDto.
 */
export interface ActivityListItem {
  activityId: number;
  activityName: string;
  activityDate: string | null;
  description: string | null;
  isClosed: boolean;
  fundedTotal: number;
  spentTotal: number;
}

/**
 * Expense.CategoryId's controlled list, seeded at db/seed/01_reference.sql
 * (dbo.ExpenseCategory), in identity-column insertion order.
 *
 * GAP: there is no GET endpoint exposing dbo.ExpenseCategory today — same kind of gap
 * as ATTENDANCE_STATUSES/URGENT_TYPES/BLOOD_TYPES above. Hardcoded here rather than
 * building one, which is backend scope.
 */
export const EXPENSE_CATEGORIES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1, name: "Food & Refreshments" },
  { id: 2, name: "Transport" },
  { id: 3, name: "Supplies" },
  { id: 4, name: "Venue" },
  { id: 5, name: "Utilities" },
  { id: 6, name: "Donation Given" },
  { id: 7, name: "Council Remittance" },
  { id: 8, name: "Other" },
];

/**
 * Donation.DonorTypeId's controlled list, seeded at db/seed/01_reference.sql
 * (dbo.DonorType), in identity-column insertion order. Same kind of GAP as
 * EXPENSE_CATEGORIES above — no GET endpoint exists yet.
 */
export const DONOR_TYPES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1, name: "Government Official" },
  { id: 2, name: "Private" },
  { id: 3, name: "Business" },
  { id: 4, name: "Member" },
];

/** One row of the chapter's expense list. Mirrors ExpenseListItemDto. */
export interface ExpenseListItem {
  expenseId: number;
  activityId: number | null;
  activityName: string | null;
  expenseDate: string;
  payee: string;
  description: string;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  recordedBy: number;
  approvedBy: number | null;
  isVoided: boolean;
}

/**
 * Display metadata for a receipt already attached to an expense. Mirrors ExpenseAttachmentDto.
 *
 * attachmentId here is dbo.ExpenseAttachment's own identity — a DIFFERENT id space from
 * the AttachmentStagingId that GET /api/attachments/{id} expects. It resolves through its
 * own route instead: GET /api/chapters/{chapterId}/expenses/{expenseId}/attachments/{attachmentId}
 * (see ExpenseDetail.tsx's viewAttachment).
 */
export interface ExpenseAttachment {
  attachmentId: number;
  fileName: string;
  fileSize: number;
  uploadedBy: number;
}

/** One instance of an expense being voided. Visible to the whole chapter. Mirrors ExpenseVoidDto. */
export interface ExpenseVoid {
  expenseVoidId: number;
  voidedBy: number;
  voidedDateUtc: string;
  reason: string;
  reversedLedgerEntryId: number | null;
}

/** The full expense: header, its receipts, and its void history. Mirrors ExpenseDetailDto. */
export interface ExpenseDetail {
  expenseId: number;
  chapterId: number;
  activityId: number | null;
  activityName: string | null;
  expenseDate: string;
  payee: string;
  description: string;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  recordedBy: number;
  approvedBy: number | null;
  isVoided: boolean;
  attachments: ExpenseAttachment[];
  voidHistory: ExpenseVoid[];
}

/**
 * One row of the chapter's donation list. Mirrors DonationListItemDto.
 *
 * isInKind is an explicit field, set by the server from whether InKindDescription is
 * present — NEVER infer "in kind" from amount === 0 here. A donation can carry a cash
 * amount, an in-kind description, or both at once.
 */
export interface DonationListItem {
  donationId: number;
  activityId: number | null;
  activityName: string | null;
  donationDate: string;
  donorName: string;
  donorType: string | null;
  amount: number;
  isInKind: boolean;
  inKindDescription: string | null;
  chapterReceiptNo: string | null;
  recordedBy: number;
  isVoided: boolean;
}

/**
 * One row of the public, unauthenticated chapter picker. Mirrors ChapterPublicDto.
 * regionName/provinceName/cityName are the council-chain names on THIS chapter's own
 * row — there is no separate hierarchical endpoint; a cascading Region -> Province ->
 * City -> Chapter picker is built client-side by grouping/filtering this flat list.
 */
export interface ChapterPublic {
  chapterId: number;
  chapterName: string;
  regionName: string | null;
  provinceName: string | null;
  cityName: string | null;
}

/** GET /api/chapters/me/invite-link. Never the raw token — see
 * ChapterInviteLinkStatusDto's own doc comment for why there is no way to recover one
 * once issued, only to replace it. */
export interface ChapterInviteLinkStatus {
  hasLink: boolean;
  createdDateUtc: string | null;
}

/** POST /api/chapters/me/invite-link/regenerate. SHOW-ONCE — joinUrl carries the raw
 * token and is returned on this ONE response only; there is no endpoint to re-fetch it. */
export interface ChapterInviteLinkIssued {
  joinUrl: string;
  createdDateUtc: string;
}

/** GET /api/chapters/invite/{token} — the public "join this chapter" landing page's
 * only data source. isValid=false for an unknown/invalidated token or an inactive
 * chapter, all reading identically (anti-enumeration). */
export interface ChapterInviteLinkResolved {
  isValid: boolean;
  chapterId: number | null;
  chapterName: string | null;
}

/**
 * The three-outcome registration flow (docs/AIS-Project-Documentation.md §4.1). Lapsed
 * is a renewal state, not this one — do not conflate the two.
 */
export type MembershipApplicationStatusName =
  | "PendingApproval" | "ReturnedForCorrection" | "Approved" | "Rejected";

/**
 * MembershipApplication.StatusId reference data, seeded at db/seed/01_reference.sql
 * (dbo.MembershipApplicationStatus), in identity-column insertion order. Same kind of
 * GAP as ATTENDANCE_STATUSES/EXPENSE_CATEGORIES above — there is no GET endpoint
 * exposing this table today; verified against the live queue (statusId=1 -> a known
 * PendingApproval row, 3 -> a known Approved row, 4 -> a known Rejected row).
 */
export const MEMBERSHIP_APPLICATION_STATUSES: ReadonlyArray<{ id: number; name: MembershipApplicationStatusName }> = [
  { id: 1, name: "PendingApproval" },
  { id: 2, name: "ReturnedForCorrection" },
  { id: 3, name: "Approved" },
  { id: 4, name: "Rejected" },
];

/** The applicant's own view of his application's current state. Mirrors MembershipApplicationStatusDto. */
export interface MembershipApplicationStatus {
  referenceNo: string;
  chapterId: number;
  chapterName: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  giftName: string;
  birthDate: string;
  mobileNo: string;
  email: string | null;
  dateSurvive: string | null;
  presidentDuringSurvive: string | null;
  masterInitiatorDuringSurvive: string | null;
  seconderNameGiven: string;
  seconderMemberNumberGiven: string | null;
  statusName: MembershipApplicationStatusName;
  submittedDateUtc: string;
  decisionReason: string | null;
}

/** One row of a chapter admin's own review queue. Mirrors MembershipApplicationQueueItemDto. */
export interface MembershipApplicationQueueItem {
  applicationId: number;
  referenceNo: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  giftName: string;
  mobileNo: string;
  email: string | null;
  statusName: MembershipApplicationStatusName;
  submittedDateUtc: string;
  decidedBy: number | null;
  decidedDateUtc: string | null;
}

/** One status-change event in an application's history. Mirrors MembershipApplicationUpdateDto. */
export interface MembershipApplicationUpdate {
  membershipApplicationUpdateId: number;
  updateDateUtc: string;
  updatedBy: number | null;
  statusName: string;
  notes: string | null;
}

/** A prior CLOSED application from the same mobile number. Mirrors MembershipApplicationPriorDto. */
export interface MembershipApplicationPrior {
  applicationId: number;
  referenceNo: string;
  chapterId: number;
  chapterName: string;
  statusName: MembershipApplicationStatusName;
  submittedDateUtc: string;
  decidedDateUtc: string | null;
  decisionReason: string | null;
}

/**
 * The full application, for the chapter admin reviewing it. Mirrors MembershipApplicationDetailDto.
 *
 * seconderMemberId/seconderResolvedGiftName/seconderResolvedMemberNumber are null until
 * an admin has confirmed the free-text seconder answer against a real member — render
 * "Not yet confirmed" in words when null, never a checkmark or any other implication
 * that it has already been verified.
 */
export interface MembershipApplicationDetail {
  applicationId: number;
  referenceNo: string;
  chapterId: number;
  firstName: string;
  middleName: string | null;
  lastName: string;
  giftName: string;
  birthDate: string;
  mobileNo: string;
  email: string | null;
  dateSurvive: string | null;
  presidentDuringSurvive: string | null;
  masterInitiatorDuringSurvive: string | null;
  seconderNameGiven: string;
  seconderMemberNumberGiven: string | null;
  seconderMemberId: number | null;
  seconderResolvedGiftName: string | null;
  seconderResolvedMemberNumber: string | null;
  statusName: MembershipApplicationStatusName;
  submittedDateUtc: string;
  decidedBy: number | null;
  decidedDateUtc: string | null;
  decisionReason: string | null;
  createdMemberId: number | null;
  history: MembershipApplicationUpdate[];
  priorApplications: MembershipApplicationPrior[];
}

/**
 * SHOW-ONCE. Mirrors ApproveMembershipApplicationResponseDto. enrolmentUrl carries the
 * raw enrolment token and is returned on this ONE response only — there is no endpoint
 * to re-fetch it. Never persist this outside the panel that displays it once.
 */
export interface ApproveMembershipApplicationResponse {
  memberId: number;
  memberNumber: string;
  enrolmentUrl: string;
  expiresOnUtc: string;
}

/**
 * SHOW-ONCE. Mirrors ReissueMemberEnrolmentLinkResponseDto — POST
 * /api/members/{id}/enrolment-link, the "forgot my password" recovery path (CLAUDE.md
 * invariant #16: recovery is a new link, never a transmitted or admin-set password).
 * enrolmentUrl carries the raw token and is returned on this ONE response only — there
 * is no endpoint to re-fetch it. Never persist this outside the panel that displays it once.
 */
export interface ReissueMemberEnrolmentLinkResponse {
  memberId: number;
  enrolmentUrl: string;
  expiresOnUtc: string;
}

/**
 * SHOW-ONCE. Mirrors MemberPasswordResetDto — POST /api/members/{id}/reset-password,
 * National Council only (client decision 2026-09-21). Never a password itself, only a
 * fresh one-time enrolment link (CLAUDE.md invariant #16) — the member's account is
 * locked (dbo.UserAccount.IsDisabled) until he redeems it and sets his own new password.
 */
export interface MemberPasswordReset {
  memberId: number;
  enrolmentUrl: string;
  expiresOnUtc: string;
}

/**
 * GET /api/members/blocked — National Council only. Mirrors BlockedMemberDto. One row
 * per currently-blocked member, derived from dbo.MemberAccountAction's own most-recent-
 * action state (never dbo.UserAccount.IsDisabled directly — a member blocked before his
 * first enrolment has no UserAccount row yet and still appears here).
 */
export interface BlockedMember {
  memberId: number;
  giftName: string;
  memberNumber: string;
  chapterName: string | null;
  reason: string;
  performedDateUtc: string;
  blockedByGiftName: string | null;
}

/**
 * CorrectiveAction.CategoryId reference data — GET /api/corrective-action-categories,
 * returning CorrectiveActionCategoryDto[]. A live endpoint (unlike ATTENDANCE_STATUSES/
 * EXPENSE_CATEGORIES above), so this is fetched with a plain useQuery, never hardcoded.
 */
export interface CorrectiveActionCategoryOption { categoryId: number; categoryName: string }

/** The four corrective-action statuses, exact strings the server uses. */
export type CorrectiveActionStatusName = "Pending" | "Under Review" | "Reconciled" | "Dismissed";

export const CORRECTIVE_ACTION_STATUSES: readonly CorrectiveActionStatusName[] =
  ["Pending", "Under Review", "Reconciled", "Dismissed"];

/**
 * A corrective action case — CLAUDE.md invariant #6, the single most important shape
 * distinction in this codebase. GET .../corrective-actions (list) and the `case` field of
 * GET .../corrective-actions/{caseId} (detail) return ONE of these two STRUCTURALLY
 * DIFFERENT shapes per case, decided server-side by ScopeGuard.CanSeeCaseNarrative — never
 * the same object with content/resolutionNotes/filedBy/filedByGiftName set to null. Detect
 * which shape arrived with hasNarrative() below; never check a field for null/undefined,
 * because a summary-shape payload never had the key to begin with. Mirrors
 * CorrectiveActionSummaryDto / CorrectiveActionFullDto.
 */
export interface CorrectiveActionSummary {
  caseId: number; memberId: number; giftName: string; memberNumber: string;
  categoryId: number; categoryName: string;
  statusName: CorrectiveActionStatusName | string;
  dateFiled: string; resolutionDate: string | null;
}

export interface CorrectiveActionDetail extends CorrectiveActionSummary {
  content: string; resolutionNotes: string | null; filedBy: number; filedByGiftName: string;
}

export type CorrectiveActionCase = CorrectiveActionSummary | CorrectiveActionDetail;

/** True only when the narrative fields are actually present on the payload — not a null check. */
export function hasNarrative(c: CorrectiveActionCase): c is CorrectiveActionDetail {
  return "content" in c;
}

/**
 * One status-history entry. Same two-shape rule as the case header above, decided by the
 * SAME CanSeeNarrative flag — not a second, independent visibility decision — but tested
 * per-entry here since the timeline is an array. statusName/updateDateUtc are ALWAYS
 * present; updatedBy/updatedByGiftName/notes are present or absent together. Mirrors
 * CorrectiveActionTimelineEntrySummaryDto / CorrectiveActionTimelineEntryFullDto.
 */
export interface CorrectiveActionTimelineEntrySummary {
  updateId: number; updateDateUtc: string; statusName: string;
}

export interface CorrectiveActionTimelineEntryDetail extends CorrectiveActionTimelineEntrySummary {
  updatedBy: number; updatedByGiftName: string; notes: string | null;
}

export type CorrectiveActionTimelineEntry =
  CorrectiveActionTimelineEntrySummary | CorrectiveActionTimelineEntryDetail;

export function timelineEntryHasDetail(e: CorrectiveActionTimelineEntry): e is CorrectiveActionTimelineEntryDetail {
  return "updatedBy" in e;
}

/** GET .../corrective-actions/{caseId} — the case header plus its full status-history. */
export interface CorrectiveActionCaseResponse {
  case: CorrectiveActionCase;
  timeline: CorrectiveActionTimelineEntry[];
}

/** One instance of a donation being voided. Visible to the whole chapter. Mirrors DonationVoidDto. */
export interface DonationVoid {
  donationVoidId: number;
  voidedBy: number;
  voidedDateUtc: string;
  reason: string;
  reversedLedgerEntryId: number | null;
}

/** The full donation: header and its void history. Mirrors DonationDetailDto. */
export interface DonationDetail {
  donationId: number;
  chapterId: number;
  activityId: number | null;
  activityName: string | null;
  donationDate: string;
  donorName: string;
  donorType: string | null;
  amount: number;
  isInKind: boolean;
  inKindDescription: string | null;
  chapterReceiptNo: string | null;
  recordedBy: number;
  isVoided: boolean;
  voidHistory: DonationVoid[];
}

/**
 * GET /api/chapters/{chapterId}/dashboard?from=&to= — the chapter-wide, date-ranged
 * overview visible to EVERY member, not officer-only. Mirrors DashboardFinancialDto.
 *
 * openingBalance/periodIn/periodOut/closingBalance describe the SELECTED PERIOD only.
 * currentBalance is the real, all-time chapter balance (the same figure the Ledger
 * screen shows), computed independently of the period — CLAUDE.md invariant #5's
 * texture for this screen specifically: never collapse the two into one label, and
 * never render either as "the balance" without saying which one it is.
 */
export interface DashboardFinancial {
  openingBalance: number;
  periodIn: number;
  periodOut: number;
  closingBalance: number;
  currentBalance: number;
  inFromMeetings: number;
  inFromDonations: number;
  inOther: number;
  outOnExpenses: number;
  outOther: number;
}

/** Headcounts by dbo.MemberStatus for the period, plus newThisPeriod. No per-member row. Mirrors DashboardMembershipDto. */
export interface DashboardMembership {
  total: number;
  pending: number;
  approved: number;
  active: number;
  inactive: number;
  suspended: number;
  rejected: number;
  newThisPeriod: number;
}

/**
 * Attendance as a headcount FIRST. Mirrors DashboardActivityDto. averagePresentPerMeeting
 * is a chapter-wide mean — the one sanctioned participation-style figure in this app
 * (CLAUDE.md invariant #5) — and must never be rendered without totalPresent/
 * totalOnSheets alongside it, and never as a bare percentage.
 */
export interface DashboardActivity {
  meetingsHeld: number;
  totalPresent: number;
  totalOnSheets: number;
  averagePresentPerMeeting: number;
}

/** One of the four canonical corrective-action statuses. Always present, even at 0 — never hidden. Mirrors CorrectiveActionStatusCountDto. */
export interface CorrectiveActionStatusCount {
  statusName: CorrectiveActionStatusName | string;
  caseCount: number;
}

/** GET /api/chapters/{chapterId}/dashboard response. fromDate/toDate echo the range actually applied. Mirrors DashboardDto. */
export interface DashboardSummary {
  fromDate: string;
  toDate: string;
  financial: DashboardFinancial;
  membership: DashboardMembership;
  activity: DashboardActivity;
  correctiveActionCounts: CorrectiveActionStatusCount[];
}

/**
 * GET /api/councils/statistics and GET /api/councils/{councilId}/statistics — one
 * council's rollup, computed over its ENTIRE subtree, not just direct children (a
 * National-focused view has zero direct chapters in the real org structure; chapters
 * hang off City/Municipal councils several levels down). Mirrors CouncilRollupDto,
 * used both for the focus council itself and, per row, for its direct child councils.
 *
 * hasRenewalData/renewedCount/lapsedCount/exemptCount/notRecordedCount: when
 * hasRenewalData is false, render "No renewal season recorded yet" — never "0%
 * renewed". A chapter never asked to renew is not a chapter that failed to (CLAUDE.md
 * "Renewed / Lapsed / Exempt" vocabulary — Lapsed is not disciplinary, and absence of
 * a season is not Lapsed either).
 *
 * detachedMemberCount (invariant #14) is homed on this council directly and is
 * SEPARATE from every chapter's own member counts below — never add it into a chapter
 * total or a member-status tile that already sums chapter rolls.
 */
export interface CouncilRollupDto {
  councilId: number;
  councilName: string;
  levelName: string;
  parentCouncilId: number | null;
  depth: number;
  hasSeatedOfficers: boolean;
  directChildCouncilCount: number;
  totalCouncilsInSubtree: number;
  directChapterCount: number;
  totalChaptersInSubtree: number;
  activeChapterCount: number;
  inactiveChapterCount: number;
  memberTotal: number;
  memberPending: number;
  memberApproved: number;
  memberActive: number;
  memberInactive: number;
  memberSuspended: number;
  memberRejected: number;
  newThisPeriod: number;
  detachedMemberCount: number;
  renewedCount: number;
  lapsedCount: number;
  exemptCount: number;
  notRecordedCount: number;
  hasRenewalData: boolean;
  regSubmittedCount: number;
  regReturnedForCorrectionCount: number;
  regApprovedCount: number;
  meetingsHeld: number;
  totalPresent: number;
  totalOnSheets: number;
  averagePresentPerMeeting: number;
}

/**
 * One row of Set 3 — every chapter in the focus council's entire subtree, paged.
 * Mirrors ChapterStatisticsDto.
 *
 * openingBalance/periodIn/periodOut/closingBalance: AGGREGATE ONLY, per
 * docs/AIS-Project-Documentation.md §3/§10 Decision #7 as amended 2026-09-20 — never
 * a drill-down to an individual ledger entry, and these four columns are the entire
 * financial surface a council ever sees for a chapter it does not belong to. Label
 * the balance column with the date range actually applied ("Balance as at <toDate>"),
 * never the bare word "Balance" — outside the default (future-dated) range these are
 * NOT the chapter's live current balance, only usp_Dashboard_GetChapterSummary's own
 * currentBalance is that, and this DTO deliberately has no such field.
 *
 * caseCount* fields are per-chapter corrective-action counts by status, alongside the
 * council-wide totals in CouncilStatisticsResponse.correctiveActionTotals — counts
 * only, never a case list or narrative (invariant #6).
 */
export interface ChapterStatisticsDto {
  chapterId: number;
  chapterName: string;
  barangay: string | null;
  parentCouncilId: number;
  parentCouncilName: string;
  isActive: boolean;
  memberTotal: number;
  memberPending: number;
  memberApproved: number;
  memberActive: number;
  memberInactive: number;
  memberSuspended: number;
  memberRejected: number;
  newThisPeriod: number;
  renewedCount: number;
  lapsedCount: number;
  exemptCount: number;
  notRecordedCount: number;
  hasRenewalData: boolean;
  meetingsHeld: number;
  totalPresent: number;
  totalOnSheets: number;
  averagePresentPerMeeting: number;
  openingBalance: number;
  periodIn: number;
  periodOut: number;
  closingBalance: number;
  caseCountPending: number;
  caseCountUnderReview: number;
  caseCountReconciled: number;
  caseCountDismissed: number;
}

/**
 * GET /api/councils/statistics?from=&to=&skip=&take= (the caller's own seat) and
 * GET /api/councils/{councilId}/statistics?from=&to=&skip=&take= (explicit focus).
 * fromDate/toDate echo the range actually applied, same convention as DashboardSummary.
 * chapters is PAGED (skip/take against totalChapterCount) — it is every chapter in the
 * focus council's subtree, which can be large at National scope.
 */
export interface CouncilStatisticsResponse {
  fromDate: string;
  toDate: string;
  focus: CouncilRollupDto;
  childCouncils: CouncilRollupDto[];
  chapters: ChapterStatisticsDto[];
  totalChapterCount: number;
  correctiveActionTotals: CorrectiveActionStatusCount[];
}

/**
 * Member.StatusId reference data, seeded at db/seed/01_reference.sql (dbo.MemberStatus),
 * in identity-column insertion order (Pending=1, Approved=2, Active=3, Inactive=4,
 * Suspended=5, Rejected=6) — confirmed against MemberSearchRequest's own doc comment in
 * MemberDtos.cs (statusId=4 -> a known Inactive drill-down) and
 * usp_Dashboard_GetChapterSummary's own bucket order. Same kind of GAP as
 * ATTENDANCE_STATUSES/EXPENSE_CATEGORIES above — there is no GET endpoint exposing
 * dbo.MemberStatus today. Used to drive the Chapter Dashboard's membership tile links
 * (GET /api/members?statusId={id}).
 */
/**
 * GET /api/chapters/{chapterId}/chat/room result. Mirrors ChatRoomDto. The room is
 * lazily created on the first call this endpoint ever receives for a chapter —
 * wasCreated is true only for the caller who happened to make that first call, not a
 * meaningful ongoing UI state.
 */
export interface ChatRoom {
  roomId: number;
  chapterId: number;
  roomName: string;
  retentionMonths: number;
  wasCreated: boolean;
  isMuted: boolean;
}

/**
 * One public chat message. Mirrors ChatMessageDto. body is null when the message has
 * been removed and the caller isn't an officer of this chapter — withheld by the
 * stored procedure itself, never filtered client-side. canSeeRemovedBody is a hint for
 * how THIS screen should render a removed message, not a decision the client makes:
 * an officer who can see it still gets the "removed" tombstone, plus the original text
 * underneath for his own review.
 */
export interface ChatMessage {
  messageId: number;
  senderId: number;
  senderGiftName: string;
  senderMemberNumber: string;
  body: string | null;
  sentDateUtc: string;
  isDeleted: boolean;
  deletedDateUtc: string | null;
  flagCount: number;
  hasFlagged: boolean;
  canSeeRemovedBody: boolean;
}

/**
 * POST .../messages/{id}/flag result, and the SignalR "MessageFlagged" broadcast
 * payload — officers/admins only; a plain member's connection never receives this
 * event at all (see ChatHub.cs's own header comment). Mirrors ChatMessageFlaggedDto.
 */
export interface ChatMessageFlagged {
  messageId: number;
  flagCount: number;
}

/**
 * POST .../messages/{id}/remove result, and the SignalR "MessageRemoved" broadcast
 * payload — sent to every member of the chapter. Mirrors ChatMessageRemovedDto.
 * Deliberately messageId + deletedDate only, never the body.
 */
export interface ChatMessageRemoved {
  messageId: number;
  deletedDateUtc: string;
}

/** POST .../messages/{id}/resolve-flags result. Mirrors ChatMessageResolvedDto. Not broadcast. */
export interface ChatMessageResolved {
  messageId: number;
  resolvedCount: number;
}

/**
 * One flagged-message row in the officer moderation queue. Mirrors
 * ChatFlaggedMessageDto. Body is always present here — this screen is officer-only,
 * so there is no restricted second shape the way there is for corrective actions.
 */
export interface ChatFlaggedMessage {
  messageId: number;
  senderId: number;
  senderGiftName: string;
  senderMemberNumber: string;
  body: string | null;
  sentDateUtc: string;
  isDeleted: boolean;
  flagCount: number;
  openFlagCount: number;
}

/** One (message, flagger) pair in the moderation queue. Mirrors ChatFlagDto. */
export interface ChatFlag {
  messageId: number;
  memberId: number;
  flaggerGiftName: string;
  reason: string | null;
  flaggedDateUtc: string;
  resolvedDateUtc: string | null;
  resolvedBy: number | null;
}

/**
 * GET .../chat/moderation-queue result. Mirrors ChatModerationQueueDto. total/skip/take
 * describe the `messages` result set's own paging only, not `flags`.
 */
export interface ChatModerationQueue {
  messages: ChatFlaggedMessage[];
  flags: ChatFlag[];
  total: number;
  skip: number;
  take: number;
}

/**
 * One row of GET /api/conversations — the caller's own private-message inbox, newest
 * activity first. Mirrors ConversationSummaryDto. lastMessageId/lastMessagePreview/
 * lastMessageDate are null TOGETHER — a brand-new conversation with nothing sent yet
 * — never coerced to empty string/"—" here; the screen renders its own "No messages
 * yet" copy for that case.
 */
export interface ConversationSummary {
  roomId: number;
  otherMemberId: number;
  otherGiftName: string;
  otherChapterName: string | null;
  lastMessageId: number | null;
  lastMessagePreview: string | null;
  lastMessageDate: string | null;
  unreadCount: number;
  isMuted: boolean;
}

/** POST /api/conversations result. Mirrors ConversationStartedDto. */
export interface ConversationStarted {
  roomId: number;
  otherMemberId: number;
  otherGiftName: string;
  otherMemberNumber: string;
  otherChapterId: number;
  otherChapterName: string;
  otherStatusName: string;
  isMuted: boolean;
  wasCreated: boolean;
}

/**
 * GET/PUT /api/notifications/preferences. Governs in-app relevance too, not just
 * push delivery — these stay meaningful even on a platform that cannot receive push
 * at all (see push.ts's own header comment), so this toggle is never gated on
 * isPushSupported().
 */
export interface NotificationPreference {
  privateMessagePush: boolean;
  mentionPush: boolean;
}

/** GET /api/notifications/vapid-key result. The VAPID key is public; never a secret. */
export interface VapidPublicKey {
  publicKey: string;
}

/** POST /api/notifications/subscriptions result. */
export interface PushSubscriptionRegistered {
  subscriptionId: number;
}

export const MEMBER_STATUSES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1, name: "Pending" },
  { id: 2, name: "Approved" },
  { id: 3, name: "Active" },
  { id: 4, name: "Inactive" },
  { id: 5, name: "Suspended" },
  { id: 6, name: "Rejected" },
];

/* ============================================================================
 * Chapter registration (docs/AIS-Project-Documentation.md §7A.4). Mirrors
 * src/Akrho.Api/Features/ChapterRegistrations/ChapterRegistrationDtos.cs field-for-field —
 * read that file first if either drifts.
 * ========================================================================== */

/**
 * dbo.ChapterOffice — the eight offices of §7A.4's paper form, in form order. Seeded at
 * db/seed/01_reference.sql, in identity-column insertion order (President=1 ... Master
 * Initiator III=8). Same kind of GAP as MEMBER_STATUSES/EXPENSE_CATEGORIES above — there
 * is no GET endpoint exposing dbo.ChapterOffice today (confirmed against
 * ReferenceEndpoints.cs and ChapterRegistrationValidators.cs, whose own comment says the
 * exact row count is deliberately never hardcoded server-side — this client list is a
 * hint only, never authoritative; the server's own count is what actually gates
 * submission). grantsLogin=false for the three Master Initiator seats only — "recorded
 * office, no login" per §7A.4.
 */
export interface ChapterOfficeOption { officeId: number; officeName: string; grantsLogin: boolean }

export const CHAPTER_OFFICES: readonly ChapterOfficeOption[] = [
  { officeId: 1, officeName: "President", grantsLogin: true },
  { officeId: 2, officeName: "Vice President", grantsLogin: true },
  { officeId: 3, officeName: "Secretary", grantsLogin: true },
  { officeId: 4, officeName: "Treasurer", grantsLogin: true },
  { officeId: 5, officeName: "Auditor", grantsLogin: true },
  { officeId: 6, officeName: "Master Initiator I", grantsLogin: false },
  { officeId: 7, officeName: "Master Initiator II", grantsLogin: false },
  { officeId: 8, officeName: "Master Initiator III", grantsLogin: false },
];

/**
 * dbo.ChapterAccent — the six-colour approved chapter-mark palette (§7A.3, "not a colour
 * picker, free colour choice breaks text contrast"). Seeded at db/seed/01_reference.sql,
 * in identity-column insertion order.
 *
 * GAP, more serious than the other hardcoded reference lists in this file: there is no
 * GET /api/chapter-accents endpoint today (confirmed against ReferenceEndpoints.cs — only
 * /api/regions, /api/provinces, /api/municipalities are public there). Unlike
 * MEMBER_STATUSES/EXPENSE_CATEGORIES, a wrong AccentId here does not just mis-render a
 * dropdown — it permanently assigns the WRONG colour to a real chapter's mark on
 * approval, with no correction path built in this slice. This list is inferred from the
 * seed script's own insertion order (db/seed/01_reference.sql, dbo.ChapterAccent MERGE)
 * and cross-checked against the six names/hexes named in this module's own brief; it has
 * NOT been confirmed against a live AccentId value returned by the API. Flagged for
 * backend/tech-lead: add a small GET /api/chapter-accents (mirrors ListRegions et al.
 * exactly) before this goes anywhere near production data.
 */
export interface ChapterAccentOption { accentId: number; accentName: string; hexValue: string }

export const CHAPTER_ACCENTS: readonly ChapterAccentOption[] = [
  { accentId: 1, accentName: "Brass", hexValue: "#C39A3E" },
  { accentId: 2, accentName: "Slate", hexValue: "#39424F" },
  { accentId: 3, accentName: "Forest", hexValue: "#2E6B52" },
  { accentId: 4, accentName: "Maroon", hexValue: "#A6392E" },
  { accentId: 5, accentName: "Navy", hexValue: "#1F3A5F" },
  { accentId: 6, accentName: "Ochre", hexValue: "#B4801E" },
];

/**
 * dbo.ChapterRegistrationStatus has exactly three rows, seeded at db/seed/01_reference.sql
 * in this insertion order, and per that schema file's own header comment none may ever be
 * added. Same kind of GAP as MEMBERSHIP_APPLICATION_STATUSES above — no GET endpoint
 * exists for this table either.
 */
export type ChapterRegistrationStatusName = "Submitted" | "ReturnedForCorrection" | "Approved";

export const CHAPTER_REGISTRATION_STATUSES: ReadonlyArray<{ id: number; name: ChapterRegistrationStatusName }> = [
  { id: 1, name: "Submitted" },
  { id: 2, name: "ReturnedForCorrection" },
  { id: 3, name: "Approved" },
];

export type ChapterRegistrationType = "Charter" | "Turnover";

/**
 * One typed-in officer on a Charter petition — nobody exists yet (no MemberId). Mirrors
 * ChapterCharterOfficerInputDto. A mobile number is required for every officer, including
 * the three Master Initiators, who receive no login (§7A.4).
 */
export interface ChapterCharterOfficerInput {
  officeId: number;
  firstName: string;
  middleName: string | null;
  lastName: string;
  giftName: string;
  birthDate: string;
  mobileNo: string;
  email: string | null;
  dateSurvive: string | null;
  presidentDuringSurvive: string | null;
  masterInitiatorDuringSurvive: string | null;
}

/** POST /api/chapter-registrations request body. Mirrors SubmitChapterRegistrationRequest. */
export interface SubmitChapterRegistrationRequest {
  proposedChapterName: string;
  barangay: string | null;
  regionId: number;
  provinceId: number;
  municipalityId: number;
  markAccentId: number | null;
  officers: ChapterCharterOfficerInput[];
}

export interface SubmitChapterRegistrationResponse { referenceNo: string }

/**
 * The petitioner's own view of a registration's current state. Mirrors
 * ChapterRegistrationStatusDto. Deliberately thin — NEVER carries the officer roster, and
 * (unlike MembershipApplicationStatus) also never carries geography/accent/barangay, so a
 * resubmission screen built against this cannot pre-fill anything beyond
 * proposedChapterName; see RegisterChapterStatus.tsx's own header comment.
 */
export interface ChapterRegistrationStatus {
  referenceNo: string;
  registrationType: ChapterRegistrationType;
  proposedChapterName: string | null;
  chapterId: number | null;
  chapterName: string | null;
  statusName: ChapterRegistrationStatusName;
  submittedDateUtc: string;
  decidedDateUtc: string | null;
  decisionReason: string | null;
  actingCouncilId: number;
  actingCouncilName: string;
}

/**
 * Every field a returned Charter petition may correct — the WHOLE form, roster and
 * location included. Mirrors ResubmitChapterRegistrationRequest.
 */
export interface ResubmitChapterRegistrationRequest {
  proposedChapterName: string;
  barangay: string | null;
  regionId: number;
  provinceId: number;
  municipalityId: number;
  markAccentId: number | null;
  officers: ChapterCharterOfficerInput[];
}

export interface ResubmitChapterRegistrationResponse {
  registrationId: number;
  referenceNo: string;
  statusName: string;
}

/**
 * One office/existing-member pair on a chapter's officer-turnover filing — selected from
 * that same chapter's own roster, never typed-in text. Mirrors ChapterTurnoverOfficerInputDto.
 */
export interface ChapterTurnoverOfficerInput { officeId: number; memberId: number }

/** POST /api/chapter-registrations/turnover request body. NO chapterId — the filer's own
 * chapter is always re-derived server-side from his ChapterAdmin role. Mirrors
 * SubmitChapterTurnoverRequest. */
export interface SubmitChapterTurnoverRequest { officers: ChapterTurnoverOfficerInput[] }

export interface SubmitChapterTurnoverResponse { referenceNo: string }

/**
 * One row of a council officer's own registration queue. Mirrors
 * ChapterRegistrationQueueItemDto. canAct is a display convenience only, never itself a
 * permission boundary — the server enforces the real gate regardless.
 */
export interface ChapterRegistrationQueueItem {
  registrationId: number;
  referenceNo: string;
  registrationType: ChapterRegistrationType;
  proposedChapterName: string | null;
  chapterId: number | null;
  chapterName: string | null;
  statusName: ChapterRegistrationStatusName;
  submittedDateUtc: string;
  actingCouncilId: number;
  actingCouncilName: string;
  intendedCouncilId: number | null;
  routingReason: string;
  decidedBy: number | null;
  decidedDateUtc: string | null;
  canAct: boolean;
}

/**
 * One of the eight seats, resolved identity included, for the council officer reviewing
 * the registration. Mirrors ChapterRegistrationOfficerDto.
 */
export interface ChapterRegistrationOfficer {
  registrationOfficerId: number;
  officeId: number;
  officeName: string;
  sortOrder: number;
  grantsLogin: boolean;
  memberId: number | null;
  memberNumber: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  giftName: string;
  birthDate: string;
  mobileNo: string;
  email: string | null;
  dateSurvive: string | null;
  presidentDuringSurvive: string | null;
  masterInitiatorDuringSurvive: string | null;
  verifiedBy: number | null;
  verifiedByGiftName: string | null;
  verifiedDateUtc: string | null;
  verifyNote: string | null;
  createdMemberId: number | null;
  /** Drives the "Resend enrolment link" action on an already-decided registration —
   * offered only for a real member (memberId set) who has none yet. Mirrors
   * usp_Enrolment_Issue's own "Bounded Council Issuer" branch, which only ever succeeds
   * for a member with no UserAccount AND who has never redeemed a link. */
  hasAccount: boolean;
}

/** One status-change event in a registration's history. Mirrors ChapterRegistrationUpdateDto. */
export interface ChapterRegistrationUpdate {
  chapterRegistrationUpdateId: number;
  updateDateUtc: string;
  updatedBy: number | null;
  statusName: string;
  notes: string | null;
}

/** How/why this registration is being decided at ActingCouncilId rather than
 * IntendedCouncilId. Mirrors ChapterRegistrationRoutingDto. */
export interface ChapterRegistrationRouting {
  routingId: number;
  intendedCouncilId: number | null;
  actingCouncilId: number;
  routingReason: string;
  actorMemberId: number | null;
  actedOnUtc: string;
  remarks: string | null;
}

/**
 * The full registration, for the council officer reviewing it. Mirrors
 * ChapterRegistrationDetailDto — never shown to the wider membership.
 */
export interface ChapterRegistrationDetail {
  registrationId: number;
  referenceNo: string;
  registrationType: ChapterRegistrationType;
  chapterId: number | null;
  chapterName: string | null;
  proposedChapterName: string | null;
  barangay: string | null;
  regionId: number | null;
  provinceId: number | null;
  municipalityId: number | null;
  markAccentId: number | null;
  accentName: string | null;
  hexValue: string | null;
  intendedCouncilId: number | null;
  intendedCouncilName: string | null;
  actingCouncilId: number;
  actingCouncilName: string;
  routingReason: string;
  submittedByMemberId: number | null;
  submittedByGiftName: string | null;
  submittedDateUtc: string;
  statusName: ChapterRegistrationStatusName;
  isOpen: boolean;
  decidedBy: number | null;
  decidedByGiftName: string | null;
  decidedDateUtc: string | null;
  decisionReason: string | null;
  createdChapterId: number | null;
  officers: ChapterRegistrationOfficer[];
  history: ChapterRegistrationUpdate[];
  routing: ChapterRegistrationRouting | null;
}

export interface VerifyChapterRegistrationOfficerResponse { registrationOfficerId: number; verified: boolean }

export interface ReturnChapterRegistrationResponse { registrationId: number; statusName: string }

/**
 * SHOW-ONCE. Mirrors ChapterCharterApprovalResultDto. enrolmentUrl carries the raw,
 * unhashed enrolment token — the one and only response that will ever hold it.
 */
export interface ChapterCharterApprovalResult {
  presidentMemberId: number;
  memberNumberPrefix: string;
  enrolmentUrl: string;
  expiresOnUtc: string;
}

/** SHOW-ONCE, one per newly-enrolled incoming Turnover officer. An officer who kept an
 * account he already held is simply absent from this list. Mirrors
 * ChapterTurnoverOfficerEnrolmentDto. */
export interface ChapterTurnoverOfficerEnrolment {
  memberId: number;
  enrolmentUrl: string;
  expiresOnUtc: string;
}

/**
 * POST .../approve response. Exactly one of charter/turnoverEnrolments is populated,
 * decided entirely by registrationType. Mirrors ApproveChapterRegistrationResponseDto.
 * Never logged, never persisted, never re-fetchable.
 */
export interface ApproveChapterRegistrationResponse {
  chapterId: number;
  registrationType: ChapterRegistrationType;
  charter: ChapterCharterApprovalResult | null;
  turnoverEnrolments: ChapterTurnoverOfficerEnrolment[] | null;
}

/**
 * POST /api/verifications — public, anonymous, what the public verify page
 * (`/verify/{token}`, CLAUDE.md's own vocabulary table: "chapter mark ... absent from the
 * public verification page") renders. Mirrors PublicVerificationDto.
 *
 * isValid collapses invalid/revoked/expired into one outcome — same posture as
 * MemberScanResultDto below; never guess which one occurred, never add a reason.
 *
 * photoUrl, when non-null, is a relative path to the anonymous
 * GET /api/verifications/{token}/photo — no Authorization header needed, so a plain
 * `<img src>` (resolved to an absolute URL) is enough. A 404 there means "no photo on
 * file", never an error — same posture as DigitalId.tsx's own photo handling.
 *
 * renewedThrough is a DateOnly ("YYYY-MM-DD"), rendered with shortDate. Being null is
 * NORMAL (CLAUDE.md invariant #5) and is simply omitted on screen.
 */
export interface PublicVerificationDto {
  isValid: boolean;
  giftName: string | null;
  chapterName: string | null;
  statusName: string | null;
  renewedThrough: string | null;
  photoUrl: string | null;
}

/**
 * POST /api/scans — authenticated, a member/officer scanning someone ELSE's card, what
 * Scan.tsx renders. Mirrors MemberScanResultDto.
 *
 * fullName/memberNumber/bloodTypeName are null unless isSameChapter — server-enforced
 * (CLAUDE.md invariant #7's cross-chapter posture carried into this scan result). Never
 * infer or backfill these client-side when isSameChapter is false.
 */
export interface MemberScanResultDto {
  isValid: boolean;
  giftName: string | null;
  chapterName: string | null;
  statusName: string | null;
  renewedThrough: string | null;
  isSameChapter: boolean;
  fullName: string | null;
  memberNumber: string | null;
  bloodTypeName: string | null;
}

/**
 * GET /api/members/me/scans — the caller's own "who checked my ID" history. Mirrors
 * ScanLogEntryDto. scannerGiftName/scannerChapterName are null TOGETHER for an anonymous
 * public-page scan of the caller's own card — render "Not signed in", never a blank line.
 */
export interface ScanLogEntryDto {
  scanDate: string;
  resultCode: string;
  wasOffline: boolean;
  scannerGiftName: string | null;
  scannerChapterName: string | null;
}

/** GET /api/regions — public, unauthenticated. Mirrors RegionDto. */
export interface RegionOption { regionId: number; regionCode: string; regionName: string }

/** GET /api/provinces?regionId= — public, unauthenticated. Mirrors ProvinceDto. */
export interface ProvinceOption { provinceId: number; regionId: number; provinceCode: number; provinceName: string }

/** GET /api/municipalities?provinceId= — public, unauthenticated. Mirrors MunicipalityDto. */
export interface MunicipalityOption {
  municipalityId: number;
  provinceId: number;
  municipalityCode: number;
  municipalityName: string;
  zipCode: string | null;
}

/* ============================================================================
 * Council registration and officer seating. Mirrors
 * src/Akrho.Api/Features/Councils/CouncilsDtos.cs field-for-field — read that file
 * first if either drifts.
 * ========================================================================== */

/** The six council offices, form order. Mirrors dbo.CouncilOffice — no GET endpoint
 * exposes this list separately (same GAP as CHAPTER_OFFICES above); a hint only. */
export interface CouncilOfficeOption { councilOfficeId: number; officeName: string }
export const COUNCIL_OFFICES: readonly CouncilOfficeOption[] = [
  { councilOfficeId: 1, officeName: "President" },
  { councilOfficeId: 2, officeName: "Vice President" },
  { councilOfficeId: 3, officeName: "Secretary" },
  { councilOfficeId: 4, officeName: "Treasurer" },
  { councilOfficeId: 5, officeName: "Auditor" },
  { councilOfficeId: 6, officeName: "Public Information Officer" },
];

/**
 * GET /api/councils?councilId= — one row per council in the requested subtree.
 * Three no/low-officer states, deliberately NOT collapsed into one boolean:
 *   - neverConstituted: no MemberRole row has EVER existed here (auto-created to give
 *     a chapter a parent, or just created, nobody seated yet).
 *   - isDormant: it HAD seated officers once; their terms have all ended.
 *   - hasSeatedOfficers: currently has at least one seated officer.
 * Render each as its own plain sentence — never a bare officer count standing in for
 * "never constituted" vs "dormant", and never a green tick for either.
 */
export interface CouncilRegistry {
  councilId: number;
  councilName: string;
  levelName: string;
  parentCouncilId: number | null;
  depth: number;
  isActive: boolean;
  isDissolved: boolean;
  hasSeatedOfficers: boolean;
  neverConstituted: boolean;
  isDormant: boolean;
  seatedOfficerCount: number;
  directChildCouncilCount: number;
  directChapterCount: number;
  directMemberCount: number;
}

/** GET /api/councils/{councilId}/eligible-officers?search= — an in-jurisdiction
 * candidate. Never contact details, blood type or anything outside invariant #7's
 * cross-chapter shape. */
export interface CouncilOfficerCandidate {
  memberId: number;
  giftName: string;
  memberNumber: string;
  fullName: string;
  chapterId: number;
  chapterName: string;
  renewedThrough: string | null;
  isCurrent: boolean;
  isLapsed: boolean;
  noMobileNumber: boolean;
}

/** GET /api/councils/member-lookup?councilId=&memberNumber= — an out-of-jurisdiction
 * nominee, found by exact number only, never a browsable list (invariant #7). */
export interface CouncilMemberLookup {
  memberId: number;
  giftName: string;
  memberNumber: string;
  chapterName: string | null;
  statusName: string;
  renewedThrough: string | null;
  isCurrent: boolean;
  isLapsed: boolean;
  noMobileNumber: boolean;
}

/** POST /api/councils — geography-driven; exactly one of regionId/provinceId/
 * municipalityId, matching the level this council will be created at. */
export interface CreateCouncilRequest {
  parentCouncilId: number;
  councilName: string;
  regionId: number | null;
  provinceId: number | null;
  municipalityId: number | null;
}

export interface CouncilCreated { councilId: number; wasCreated: boolean }

/** POST /api/councils/{councilId}/officers. outsideJurisdictionReason is required by
 * the server itself when the nominee is not from a chapter in this council's own
 * subtree — never a waiver, always a permanent record (invariant #13b). */
export interface SeatCouncilOfficerRequest {
  memberId: number;
  councilOfficeId: number;
  termStart: string;
  termEnd: string | null;
  outsideJurisdictionReason: string | null;
}

/**
 * SHOW-ONCE when enrolmentUrl is non-null — the nominee's very first enrolment link,
 * issued in the same transaction as the seat itself, only when he had no account yet
 * and had never redeemed one. A null enrolmentUrl means he already has a working login
 * elsewhere and needs none — never a password either way (invariant #16).
 */
export interface CouncilSeatResult {
  memberRoleId: number;
  wasInJurisdiction: boolean;
  enrolmentUrl: string | null;
  expiresOnUtc: string | null;
}

/** One row of GET /api/councils/{councilId}/officers's seats array — current or ended. */
export interface CouncilRosterSeat {
  memberRoleId: number;
  councilOfficeId: number | null;
  officeName: string | null;
  roleName: string;
  memberId: number;
  giftName: string;
  memberNumber: string;
  fullName: string;
  homeChapterName: string | null;
  termStart: string;
  termEnd: string | null;
  isCurrent: boolean;
  renewedThrough: string | null;
  hasAccount: boolean;
}

/** One row of GET /api/councils/{councilId}/officers's overrides array — permanent,
 * never filtered out (invariant #13b: "no waiver, no approval step, just a permanent
 * record"). Render with a visible, permanent badge — never the words "approved",
 * "waived" or "exception". */
export interface CouncilSeatOverride {
  seatOverrideId: number;
  memberRoleId: number;
  giftName: string;
  memberNumber: string;
  homeChapterName: string | null;
  reason: string;
  seatedOnUtc: string;
  seatedByGiftName: string;
}

export interface CouncilRoster {
  seats: CouncilRosterSeat[];
  overrides: CouncilSeatOverride[];
}
