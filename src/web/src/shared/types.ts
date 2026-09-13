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
