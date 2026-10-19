/**
 * The member-app how-to guides: step lists per audience, who is offered each guide, and
 * registry hygiene (unique keys, only keys from the server catalogue).
 */
import { describe, expect, it } from "vitest";
import { AIS_GUIDES } from "./index";
import { membersGuide } from "./members";
import { fundsGuide } from "./funds";
import { announcementsGuide } from "./announcements";
import { digitalIdGuide } from "./digitalId";
import { profileGuide } from "./profile";
import { moneyGuide } from "./money";
import { postAnnouncementGuide } from "./postAnnouncement";
import { approvalsGuide } from "./approvals";
import type { GuideContext, TourStep } from "@/shared/tour/types";

const CATALOGUE = [
  "guide-meetings", "guide-members", "guide-funds", "guide-announcements", "guide-digital-id",
  "guide-profile", "guide-money", "guide-post-announcement", "guide-approvals",
];

function ctxFor(roles: string[], closed: string[] = []): GuideContext {
  return {
    claims: { memberId: 5, chapterId: 1, chapterName: "Test", giftName: "TANGLAW", roles, councilSeats: [] },
    roles,
    seats: [],
    isFeatureOpen: key => !closed.includes(key),
  };
}

const member = ctxFor(["Member"]);
const officer = ctxFor(["Member", "ChapterOfficer"]);
const treasurer = ctxFor(["Member", "ChapterTreasurer"]);
const admin = ctxFor(["Member", "ChapterAdmin"]);
const trialOver = (roles: string[]) => ctxFor(roles, ["Members", "Funds", "Meetings", "Memos", "DigitalId", "ChapterAdmin", "CorrectiveActions", "PrivateMessages"]);

const ids = (steps: TourStep[]) => steps.map(s => s.id);

describe("registry", () => {
  it("has unique keys, all from the catalogue, and every catalogue key", () => {
    const keys = AIS_GUIDES.map(g => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(CATALOGUE).toContain(k);
    expect([...keys].sort()).toEqual([...CATALOGUE].sort());
  });

  it("every guide opens and closes with a centred step and has 6 to 14 steps for an admin", () => {
    // guide-meetings is the older reference guide (17 steps); the rest are held to 14.
    for (const g of AIS_GUIDES.filter(x => x.key !== "guide-meetings")) {
      const steps = g.buildSteps(admin);
      expect(steps.length, g.key).toBeGreaterThanOrEqual(6);
      expect(steps.length, g.key).toBeLessThanOrEqual(14);
      expect(steps[0]?.target, g.key).toBeUndefined();
      expect(steps[steps.length - 1]?.target, g.key).toBeUndefined();
      expect(new Set(ids(steps)).size, g.key).toBe(steps.length);
    }
  });
});

describe("step lists", () => {
  it("members", () => {
    expect(ids(membersGuide.buildSteps(member))).toEqual([
      "intro", "tab", "blood-filter", "row", "message", "privacy", "corrective", "done",
    ]);
    expect(ids(membersGuide.buildSteps(trialOver(["Member"])))).toEqual([
      "intro", "tab", "blood-filter", "row", "privacy", "done",
    ]);
  });

  it("funds", () => {
    expect(ids(fundsGuide.buildSteps(member))).toEqual([
      "intro", "tab", "views", "balance", "council-note", "entry", "corrections",
      "expenses", "donations", "activities", "done",
    ]);
  });

  it("announcements, with and without memos", () => {
    expect(ids(announcementsGuide.buildSteps(member))).toEqual([
      "intro", "tab", "switcher", "list", "title", "body", "national", "memos", "done",
    ]);
    expect(ids(announcementsGuide.buildSteps(ctxFor(["Member"], ["Memos"])))).toEqual([
      "intro", "tab", "list", "title", "body", "national", "done",
    ]);
  });

  it("digital id", () => {
    expect(ids(digitalIdGuide.buildSteps(member))).toEqual([
      "intro", "home-link", "card", "flip", "qr-private", "current", "showing",
      "scan-link", "camera", "viewfinder", "results", "done",
    ]);
  });

  it("profile, and the install step only when the app is not installed", () => {
    const steps = profileGuide.buildSteps(member);
    expect(ids(steps)).toEqual([
      "intro", "link", "record", "details", "photo", "password", "alerts", "tour", "help", "install", "done",
    ]);
    const install = steps.find(s => s.id === "install")!;
    expect(install.when?.({ narrow: true, standalone: false })).toBe(true);
    expect(install.when?.({ narrow: true, standalone: true })).toBe(false);
  });

  it("money follows the role: treasurer, officer, admin", () => {
    expect(ids(moneyGuide.buildSteps(treasurer))).toEqual([
      "intro", "tab", "expense-button", "expense-payee", "expense-amount", "expense-receipt",
      "donation-button", "donation-donor", "donation-gift", "corrections", "done",
    ]);
    expect(ids(moneyGuide.buildSteps(officer))).toEqual([
      "intro", "tab", "activity-button", "activity-name", "corrections", "done",
    ]);
    expect(ids(moneyGuide.buildSteps(admin))).toEqual([
      "intro", "tab", "expense-button", "expense-payee", "expense-amount", "expense-receipt",
      "donation-button", "donation-donor", "donation-gift", "activity-button", "activity-name",
      "corrections", "void", "done",
    ]);
  });

  it("post an announcement, with and without memos", () => {
    expect(ids(postAnnouncementGuide.buildSteps(officer))).toEqual([
      "intro", "tab", "new-button", "title", "body", "urgent", "expiry", "post",
      "memo-button", "memo-subject", "memo-permanent", "done",
    ]);
    expect(ids(postAnnouncementGuide.buildSteps(ctxFor(["Member", "ChapterOfficer"], ["Memos"])))).toEqual([
      "intro", "tab", "new-button", "title", "body", "urgent", "expiry", "post", "done",
    ]);
  });

  it("approvals", () => {
    expect(ids(approvalsGuide.buildSteps(admin))).toEqual([
      "intro", "tab", "filter", "row", "check", "name", "applicant", "seconder",
      "approve", "return", "reject", "invite-link", "invite-generate", "done",
    ]);
  });

  it("no step mentions arrears or something owed", () => {
    for (const g of AIS_GUIDES) {
      for (const s of g.buildSteps(admin)) {
        const text = `${s.title} ${typeof s.body === "string" ? s.body : ""} ${s.tip ?? ""}`;
        expect(text, `${g.key}/${s.id}`).not.toMatch(/arrears|overdue|delinquen/i);
        expect(typeof s.body === "string" ? s.body.split(/\s+/).length : 0, `${g.key}/${s.id} body length`).toBeLessThanOrEqual(48);
      }
    }
  });
});

describe("audience", () => {
  const offered = (g: { audience: (c: GuideContext) => boolean }, c: GuideContext) => g.audience(c);

  it("every-member guides: a plain member sees them", () => {
    for (const g of [membersGuide, fundsGuide, announcementsGuide, digitalIdGuide, profileGuide]) {
      expect(offered(g, member), g.key).toBe(true);
    }
  });

  it("every-member guides: a closed free-trial feature hides its guide, but never Profile or Announcements", () => {
    const closed = trialOver(["Member"]);
    expect(offered(membersGuide, closed)).toBe(false);
    expect(offered(fundsGuide, closed)).toBe(false);
    expect(offered(digitalIdGuide, closed)).toBe(false);
    expect(offered(announcementsGuide, closed)).toBe(true);
    expect(offered(profileGuide, closed)).toBe(true);
  });

  it("officer guides are hidden from a plain member", () => {
    for (const g of [moneyGuide, postAnnouncementGuide, approvalsGuide]) {
      expect(offered(g, member), g.key).toBe(false);
    }
  });

  it("money: treasurer, officer and admin yes; funds closed no", () => {
    expect(offered(moneyGuide, treasurer)).toBe(true);
    expect(offered(moneyGuide, officer)).toBe(true);
    expect(offered(moneyGuide, admin)).toBe(true);
    expect(offered(moneyGuide, trialOver(["Member", "ChapterAdmin"]))).toBe(false);
  });

  it("post announcement: officer and admin yes, treasurer no", () => {
    expect(offered(postAnnouncementGuide, officer)).toBe(true);
    expect(offered(postAnnouncementGuide, admin)).toBe(true);
    expect(offered(postAnnouncementGuide, treasurer)).toBe(false);
  });

  it("approvals: admin only, and not once ChapterAdmin is closed", () => {
    expect(offered(approvalsGuide, admin)).toBe(true);
    expect(offered(approvalsGuide, officer)).toBe(false);
    expect(offered(approvalsGuide, treasurer)).toBe(false);
    expect(offered(approvalsGuide, trialOver(["Member", "ChapterAdmin"]))).toBe(false);
  });
});
