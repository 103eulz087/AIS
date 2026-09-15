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
