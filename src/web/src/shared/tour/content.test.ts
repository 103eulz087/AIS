import { describe, expect, it } from "vitest";
import { buildAisTourSteps } from "@/ais/aisTour";
import { buildPortalTourSteps } from "@/portal/portalTour";

const ids = (steps: { id: string }[]) => steps.map(s => s.id);

describe("AIS tour content", () => {
  const open = () => true;

  it("greets the member by gift name and ends with the finish card", () => {
    const steps = buildAisTourSteps({ giftName: "TANGLAW", isFeatureOpen: open, canApprove: false, canFileRoster: false });
    expect(steps[0]!.title).toBe("Welcome, TANGLAW!");
    expect(steps[steps.length - 1]!.id).toBe("done");
  });

  it("leaves out officer steps for a plain member", () => {
    const steps = buildAisTourSteps({ giftName: "X", isFeatureOpen: open, canApprove: false, canFileRoster: false });
    expect(ids(steps)).not.toContain("applications");
    expect(ids(steps)).not.toContain("officers");
  });

  it("adds officer steps for an officer", () => {
    const steps = buildAisTourSteps({ giftName: "X", isFeatureOpen: open, canApprove: true, canFileRoster: true });
    expect(ids(steps)).toContain("applications");
    expect(ids(steps)).toContain("officers");
  });

  it("skips steps whose feature the free trial has closed, but never Notices", () => {
    const closed = (k: string) => k === "Announcements";
    const steps = buildAisTourSteps({ giftName: "X", isFeatureOpen: closed, canApprove: true, canFileRoster: true });
    expect(ids(steps)).toContain("notices");
    for (const gone of ["members", "meetings", "funds", "digital-id", "applications", "officers"]) {
      expect(ids(steps)).not.toContain(gone);
    }
  });

  it("only shows the install tip when not already installed", () => {
    const steps = buildAisTourSteps({ giftName: "X", isFeatureOpen: open, canApprove: false, canFileRoster: false });
    const tip = steps.find(s => s.id === "install")!;
    expect(tip.when?.({ narrow: true, standalone: false })).toBe(true);
    expect(tip.when?.({ narrow: true, standalone: true })).toBe(false);
  });
});

describe("Portal tour content", () => {
  it("only has link steps for links the user can see", () => {
    const steps = buildPortalTourSteps({
      giftName: "SANDIGAN", canSettings: false,
      visibleLinks: new Set(["/portal/chapter-registrations", "/portal/council-permissions"]),
    });
    expect(ids(steps)).toContain("link-nav-chapter-registrations");
    expect(ids(steps)).toContain("link-nav-council-permissions");
    expect(ids(steps)).not.toContain("link-nav-members");
    expect(ids(steps)).not.toContain("link-nav-settings");
  });

  it("shows App settings only when allowed", () => {
    const links = new Set(["/portal/settings"]);
    expect(ids(buildPortalTourSteps({ giftName: "X", canSettings: true, visibleLinks: links }))).toContain("link-nav-settings");
    expect(ids(buildPortalTourSteps({ giftName: "X", canSettings: false, visibleLinks: links }))).not.toContain("link-nav-settings");
  });

  it("points at the hamburger on a phone and the sidebar on a desktop", () => {
    const steps = buildPortalTourSteps({ giftName: "X", canSettings: false, visibleLinks: new Set() });
    const phone = steps.find(s => s.id === "menu-phone")!;
    const desk = steps.find(s => s.id === "menu-desktop")!;
    expect(phone.when?.({ narrow: true, standalone: false })).toBe(true);
    expect(phone.when?.({ narrow: false, standalone: false })).toBe(false);
    expect(desk.when?.({ narrow: false, standalone: false })).toBe(true);
    expect(desk.when?.({ narrow: true, standalone: false })).toBe(false);
  });
});
