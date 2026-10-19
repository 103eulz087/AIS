import { describe, expect, it } from "vitest";
import { COUNCIL_PERMISSION } from "@/shared/roles";
import type { CouncilSeatPermissions } from "@/shared/types";
import type { GuideContext, TourStep } from "@/shared/tour/types";
import { PORTAL_GUIDES } from "./index";
import { seatingGuide } from "./seating";
import { permissionsGuide } from "./permissions";
import { paymentsGuide } from "./payments";
import { membersGuide } from "./members";
import { settingsGuide } from "./settings";

function seat(permissions: string[] = []): CouncilSeatPermissions {
  return { councilId: 1, councilName: "National Council", officeName: "President", canManagePermissions: false, permissions };
}
function ctx(roles: string[] = [], seats: CouncilSeatPermissions[] = []): GuideContext {
  return { claims: null, roles, seats, isFeatureOpen: () => true };
}
const ids = (steps: TourStep[]) => steps.map(s => s.id);
const P = COUNCIL_PERMISSION;

describe("portal guide registry", () => {
  it("lists every guide once, with the server catalogue keys", () => {
    const keys = PORTAL_GUIDES.map(g => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining([
      "guide-portal-registrations", "guide-portal-seating", "guide-portal-permissions",
      "guide-portal-payments", "guide-portal-members", "guide-portal-settings",
    ]));
  });

  it("uses the Help page headings and has unique step ids, centred intro and wrap-up", () => {
    const all = ctx(["CouncilAdmin"], [seat([P.MemberPaymentTagRead, P.MemberPaymentTagSet, P.MemberPaymentTagReport, P.AppSettingsManage, P.CouncilMemberSearchRead])]);
    for (const g of PORTAL_GUIDES) {
      expect(["Chapters", "Members", "Councils", "Settings"]).toContain(g.group);
      const steps = g.buildSteps(all);
      expect(steps.length).toBeGreaterThanOrEqual(6);
      expect(steps.length).toBeLessThanOrEqual(14);
      expect(new Set(ids(steps)).size).toBe(steps.length);
      expect(steps[0]!.target).toBeUndefined();
      expect(steps[steps.length - 1]!.target).toBeUndefined();
      for (const s of steps) expect(s.title.length).toBeGreaterThan(0);
    }
  });
});

describe("guide-portal-seating", () => {
  it("is for council admins only", () => {
    expect(seatingGuide.audience(ctx(["CouncilAdmin"]))).toBe(true);
    expect(seatingGuide.audience(ctx(["CouncilSecretary"]))).toBe(false);
    expect(seatingGuide.audience(ctx())).toBe(false);
  });
  it("walks registry, roster, seating panel, link, unseat and dormancy", () => {
    expect(ids(seatingGuide.buildSteps(ctx(["CouncilAdmin"])))).toEqual([
      "intro", "registry", "child", "manage", "roster", "seat", "this-jurisdiction", "all-records",
      "reason", "confirm", "link", "unseat", "last-officer", "done",
    ]);
  });
});

describe("guide-portal-permissions", () => {
  it("is for anyone holding a council seat", () => {
    expect(permissionsGuide.audience(ctx([], [seat()]))).toBe(true);
    expect(permissionsGuide.audience(ctx(["CouncilAdmin"], []))).toBe(false);
  });
  it("covers picker, president, requires rules, national-only and save", () => {
    expect(ids(permissionsGuide.buildSteps(ctx([], [seat()])))).toEqual([
      "intro", "picker", "header", "president", "office", "requires", "national", "save", "history", "done",
    ]);
  });
});

describe("guide-portal-payments", () => {
  const tagsOnly = ctx([], [seat([P.MemberPaymentTagRead])]);
  const tagsAndSet = ctx([], [seat([P.MemberPaymentTagRead, P.MemberPaymentTagSet])]);
  const reportOnly = ctx([], [seat([P.MemberPaymentTagReport])]);

  it("is shown to tags-viewers or report-viewers, nobody else", () => {
    expect(paymentsGuide.audience(tagsOnly)).toBe(true);
    expect(paymentsGuide.audience(reportOnly)).toBe(true);
    expect(paymentsGuide.audience(ctx([], [seat([P.CouncilMemberSearchRead])]))).toBe(false);
    expect(paymentsGuide.audience(ctx())).toBe(false);
  });
  it("tags-only: tag steps, read-only note, no report steps", () => {
    const got = ids(paymentsGuide.buildSteps(tagsOnly));
    expect(got).toEqual(["intro", "tags-tabs", "tags-search", "tags-filter", "tags-readonly", "done"]);
  });
  it("tags + set: shows the Paid / Free / Unpaid buttons step", () => {
    expect(ids(paymentsGuide.buildSteps(tagsAndSet))).toContain("tags-buttons");
    expect(ids(paymentsGuide.buildSteps(tagsAndSet))).not.toContain("tags-readonly");
  });
  it("report-only: report steps, no tag steps", () => {
    const got = ids(paymentsGuide.buildSteps(reportOnly));
    expect(got).toEqual([
      "intro", "report-search", "report-filters-phone", "report-place", "report-year", "report-sort",
      "report-chips", "report-tiles", "report-csv", "done",
    ]);
  });
  it("uses the folded Filters button on phones and the separate controls elsewhere", () => {
    const steps = paymentsGuide.buildSteps(reportOnly);
    const phone = steps.filter(s => !s.when || s.when({ narrow: true, standalone: false })).map(s => s.id);
    const desk = steps.filter(s => !s.when || s.when({ narrow: false, standalone: false })).map(s => s.id);
    expect(phone).toContain("report-filters-phone");
    expect(phone).not.toContain("report-place");
    expect(desk).toContain("report-place");
    expect(desk).not.toContain("report-filters-phone");
  });
});

describe("guide-portal-members", () => {
  it("follows the Members link rule: search permission or council admin", () => {
    expect(membersGuide.audience(ctx([], [seat([P.CouncilMemberSearchRead])]))).toBe(true);
    expect(membersGuide.audience(ctx(["CouncilAdmin"]))).toBe(true);
    expect(membersGuide.audience(ctx(["CouncilSecretary"], [seat()]))).toBe(false);
  });
  it("shows block / reset / blocked-tab only to council admins", () => {
    expect(ids(membersGuide.buildSteps(ctx([], [seat([P.CouncilMemberSearchRead])])))).toEqual([
      "intro", "search", "results", "details", "done",
    ]);
    expect(ids(membersGuide.buildSteps(ctx(["CouncilAdmin"])))).toEqual([
      "intro", "search", "results", "details", "block", "reset", "blocked-tab", "done",
    ]);
  });
});

describe("guide-portal-settings", () => {
  it("is for whoever may manage app settings", () => {
    expect(settingsGuide.audience(ctx([], [seat([P.AppSettingsManage])]))).toBe(true);
    expect(settingsGuide.audience(ctx(["CouncilAdmin"], [seat()]))).toBe(false);
  });
  it("covers toggle, days, open features, preview, warning, save", () => {
    expect(ids(settingsGuide.buildSteps(ctx([], [seat([P.AppSettingsManage])])))).toEqual([
      "intro", "toggle", "days", "open", "preview", "warning", "save", "done",
    ]);
  });
});
