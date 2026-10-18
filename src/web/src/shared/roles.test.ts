/**
 * Phase 1 "dynamic council office permissions" (2026-10-17): the four council-facing
 * helpers below gate on the caller's own CouncilSeatPermissions array (GET /api/auth/me's
 * councilSeats), never on role name. These tests build seats by hand rather than
 * importing any role constant — the whole point of phase 1 is that a role name no longer
 * determines the outcome.
 */
import { describe, expect, it } from "vitest";
import {
  canApproveChapterRegistrations, canManageAppSettings, canManageCouncilPermissions, canReviewChapterRegistrations,
  canSearchMembersByJurisdiction, canSetPaymentTags, canViewCouncilStatistics, canViewPaymentTags, COUNCIL_PERMISSION, hasCouncilPermission,
} from "./roles";
import type { CouncilSeatPermissions } from "./types";

function seat(overrides: Partial<CouncilSeatPermissions> = {}): CouncilSeatPermissions {
  return {
    councilId: 10, councilName: "Sta. Rosa City Council", officeName: "Secretary",
    canManagePermissions: false, permissions: [],
    ...overrides,
  };
}

describe("hasCouncilPermission", () => {
  it("is false with no seats at all", () => {
    expect(hasCouncilPermission([], COUNCIL_PERMISSION.ChapterRegistrationReview)).toBe(false);
  });

  it("is false when no seat carries the key", () => {
    const seats = [seat({ permissions: [COUNCIL_PERMISSION.CouncilMemberSearchRead] })];
    expect(hasCouncilPermission(seats, COUNCIL_PERMISSION.ChapterRegistrationReview)).toBe(false);
  });

  it("is true when ANY one seat carries the key, even among several", () => {
    const seats = [
      seat({ councilId: 1, permissions: [COUNCIL_PERMISSION.CouncilMemberSearchRead] }),
      seat({ councilId: 2, permissions: [COUNCIL_PERMISSION.ChapterRegistrationReview] }),
    ];
    expect(hasCouncilPermission(seats, COUNCIL_PERMISSION.ChapterRegistrationReview)).toBe(true);
  });
});

describe("canManageCouncilPermissions", () => {
  it("is false for a seat that is not the presiding office", () => {
    expect(canManageCouncilPermissions([seat({ canManagePermissions: false })])).toBe(false);
  });

  it("is true for a seat that IS a council's own currently-seated President", () => {
    expect(canManageCouncilPermissions([seat({ officeName: "President", canManagePermissions: true })])).toBe(true);
  });

  it("is false with no council seat at all", () => {
    expect(canManageCouncilPermissions([])).toBe(false);
  });
});

describe("canReviewChapterRegistrations", () => {
  it("is false with no seats", () => {
    expect(canReviewChapterRegistrations([])).toBe(false);
  });

  it("is true for a seat holding ChapterRegistration.Review, regardless of office name", () => {
    const seats = [seat({ officeName: "Auditor", permissions: [COUNCIL_PERMISSION.ChapterRegistrationReview] })];
    expect(canReviewChapterRegistrations(seats)).toBe(true);
  });

  it("is false for a seat that holds other keys but not Review", () => {
    const seats = [seat({ permissions: [COUNCIL_PERMISSION.CouncilMemberSearchRead, COUNCIL_PERMISSION.CouncilStatisticsRead] })];
    expect(canReviewChapterRegistrations(seats)).toBe(false);
  });
});

describe("canApproveChapterRegistrations", () => {
  it("is true only once the Approve key itself is granted, not merely Review", () => {
    const reviewOnly = [seat({ permissions: [COUNCIL_PERMISSION.ChapterRegistrationReview] })];
    expect(canApproveChapterRegistrations(reviewOnly)).toBe(false);

    const withApprove = [seat({ permissions: [COUNCIL_PERMISSION.ChapterRegistrationReview, COUNCIL_PERMISSION.ChapterRegistrationApprove] })];
    expect(canApproveChapterRegistrations(withApprove)).toBe(true);
  });
});

describe("canViewCouncilStatistics", () => {
  it("is driven by CouncilStatistics.Read alone", () => {
    expect(canViewCouncilStatistics([seat({ permissions: [COUNCIL_PERMISSION.CouncilStatisticsRead] })])).toBe(true);
    expect(canViewCouncilStatistics([seat({ permissions: [COUNCIL_PERMISSION.CouncilMemberSearchRead] })])).toBe(false);
  });
});

describe("canSearchMembersByJurisdiction", () => {
  it("is driven by CouncilMemberSearch.Read alone", () => {
    expect(canSearchMembersByJurisdiction([seat({ permissions: [COUNCIL_PERMISSION.CouncilMemberSearchRead] })])).toBe(true);
    expect(canSearchMembersByJurisdiction([seat({ permissions: [] })])).toBe(false);
  });

  it("reproduces the default grant's shape: Treasurer/Vice President/PIO hold ONLY this key by default, not the chapter-registration keys", () => {
    const treasurer = [seat({ officeName: "Treasurer", permissions: [COUNCIL_PERMISSION.CouncilMemberSearchRead] })];
    expect(canSearchMembersByJurisdiction(treasurer)).toBe(true);
    expect(canReviewChapterRegistrations(treasurer)).toBe(false);
    expect(canViewCouncilStatistics(treasurer)).toBe(false);
  });

  it("an Auditor seat with the default empty grant passes none of the four phase 1 checks", () => {
    const auditor = [seat({ officeName: "Auditor", permissions: [] })];
    expect(canReviewChapterRegistrations(auditor)).toBe(false);
    expect(canApproveChapterRegistrations(auditor)).toBe(false);
    expect(canViewCouncilStatistics(auditor)).toBe(false);
    expect(canSearchMembersByJurisdiction(auditor)).toBe(false);
  });
});

describe("canViewPaymentTags / canSetPaymentTags", () => {
  const read = COUNCIL_PERMISSION.MemberPaymentTagRead;
  const set = COUNCIL_PERMISSION.MemberPaymentTagSet;

  it("view is driven by MemberPaymentTag.Read alone", () => {
    expect(canViewPaymentTags([seat({ permissions: [read] })])).toBe(true);
    expect(canViewPaymentTags([seat({ permissions: [set] })])).toBe(false);
    expect(canViewPaymentTags([seat({ permissions: [] })])).toBe(false);
  });

  it("set is driven by MemberPaymentTag.Set alone", () => {
    expect(canSetPaymentTags([seat({ permissions: [read, set] })])).toBe(true);
    expect(canSetPaymentTags([seat({ permissions: [read] })])).toBe(false);
  });

  it("either key on any one seat is enough, and no seats means neither", () => {
    expect(canViewPaymentTags([seat(), seat({ permissions: [read] })])).toBe(true);
    expect(canViewPaymentTags([])).toBe(false);
    expect(canSetPaymentTags([])).toBe(false);
  });
});

describe("canManageAppSettings", () => {
  it("is driven by AppSettings.Manage alone", () => {
    expect(canManageAppSettings([seat({ permissions: ["AppSettings.Manage"] })])).toBe(true);
    expect(canManageAppSettings([seat({ permissions: [COUNCIL_PERMISSION.MemberPaymentTagSet] })])).toBe(false);
    expect(canManageAppSettings([])).toBe(false);
  });
});
