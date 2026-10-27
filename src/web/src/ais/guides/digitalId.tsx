import type { GuideDefinition } from "@/shared/tour/guides";
import {
  BadgeSketch, IconBadge, Pic, PhoneFrame, SketchButton, SketchLine, SketchRow, StepStrip,
} from "@/shared/tour/illustrations";
import type { TourStep } from "@/shared/tour/types";

/**
 * guide-digital-id — "Your digital ID". Home link -> the card (front) -> turn it over (QR)
 * -> how it stays current -> showing it -> checking another brother's ID with the Scan screen.
 *
 * Honest about what the real screens do: the Scan screen reports verified (green), not valid
 * (red) or "can't check right now" (grey, no signal). Grey is never presented as green.
 * The camera starts when the Scan screen opens, so a step warns about the permission prompt
 * before going there. The guide never turns the card or presses anything.
 *
 * Targets (data-tour) live on: Home (home-digital-id), DigitalId (digital-id-card,
 * digital-id-flip-hint, digital-id-status-note, digital-id-scan-link), Scan (scan-viewfinder).
 */
export function buildDigitalIdGuideSteps(): TourStep[] {
  const wait = 5000;
  return [
    {
      id: "intro",
      title: "Your digital ID",
      body: "Your ID card lives in your phone. It shows who you are and, when scanned, proves your standing to another brother.",
      illustration: <Pic><IconBadge kind="card" /></Pic>,
    },
    {
      id: "home-link", route: "/", target: "home-digital-id", waitMs: 3000,
      title: "Start from Home",
      body: "On the Home screen, tap View your Digital ID. Every member has one, not only officers.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 6, top: 26, width: 88, height: 18 }}>
            <SketchLine w="50%" strong /><SketchButton tone="light">VIEW YOUR DIGITAL ID</SketchButton><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "card", route: "/digital-id", target: "digital-id-card", waitMs: wait,
      title: "The front of your card",
      body: "Your photo, full name, chapter and member number are here. A seated officer's card also shows his office and is coloured differently.",
      illustration: <Pic><span className="num" style={{ fontSize: 12, color: "var(--ink)" }}>AKR-04-0117-001</span></Pic>,
      tip: "No photo yet? Add one from your Profile.",
    },
    {
      id: "flip", route: "/digital-id", target: "digital-id-flip-hint", waitMs: wait,
      title: "Turn it over",
      body: "Tap the card to flip it. The back holds a QR code. When someone scans it, a public page opens showing your photo, name, chapter and current status.",
      illustration: <Pic><StepStrip steps={["Front", "Back: QR"]} active={1} /></Pic>,
    },
    {
      id: "qr-private", route: "/digital-id", target: "digital-id-card", waitMs: wait,
      title: "The code holds no personal details",
      body: "The QR code is only a private reference number. Your name, address and phone are never inside it. We will not turn the card for you.",
    },
    {
      id: "current", route: "/digital-id", target: "digital-id-status-note", waitMs: wait,
      title: "It keeps itself up to date",
      body: "If your status changes, your ID changes with it. A suspended card can never be shown as active.",
      illustration: <Pic><BadgeSketch tone="ok">Active</BadgeSketch></Pic>,
    },
    {
      id: "refresh", route: "/digital-id", target: "digital-id-refresh", waitMs: wait,
      title: "Just paid? Tap Refresh",
      body: "Your card checks for changes every time you open it. If you were just marked Paid, tap Refresh to check again right away. \"Updated\" shows when it last checked.",
      tip: "No signal? You still see your last saved card.",
      illustration: <Pic><SketchButton>Refresh</SketchButton></Pic>,
    },
    {
      id: "showing",
      title: "Showing your ID",
      body: "Open this screen, turn the card to the QR side, and let the other brother scan it. Turn your screen brightness up, and keep your thumb off the code.",
      illustration: <Pic><StepStrip steps={["Open ID", "Show QR", "He scans"]} active={1} /></Pic>,
    },
    {
      id: "scan-link", route: "/digital-id", target: "digital-id-scan-link", waitMs: wait,
      title: "Checking another brother's ID",
      body: "Tap Scan a brother's ID to check someone else's card. It uses your camera to read the QR code on the back of his.",
    },
    {
      id: "camera",
      title: "Your phone will ask for the camera",
      body: "On the next screen the camera opens. If your phone asks to use it, tap Allow. The pictures are only used to read the code and are not saved.",
      illustration: <Pic><BadgeSketch tone="info">Allow camera</BadgeSketch></Pic>,
      tip: "If you tapped Don't allow before, turn the camera back on in your browser's site settings.",
    },
    {
      id: "viewfinder", route: "/scan", target: "scan-viewfinder", waitMs: 4000,
      title: "Point at the QR code",
      body: "Hold the phone steady so the QR code on his card fills the frame. It reads by itself. There is no button to press.",
      illustration: <Pic><PhoneFrame highlight={{ left: 20, top: 24, width: 60, height: 50 }}><SketchRow /><SketchRow /></PhoneFrame></Pic>,
    },
    {
      id: "results",
      title: "What the answer means",
      body: "Green: checked just now, and you see his gift name, chapter and status. Red: the ID is not valid. Grey: no signal, so it could not be checked. Grey is not a pass.",
      illustration: (
        <Pic gap={6}>
          <BadgeSketch tone="ok">Verified</BadgeSketch>
          <BadgeSketch tone="danger">Not valid</BadgeSketch>
          <BadgeSketch tone="neutral">Can't check</BadgeSketch>
        </Pic>
      ),
    },
    {
      id: "done",
      title: "That's the digital ID",
      body: "Keep your phone charged and your photo up to date. You can run this guide again from Help & guides.",
      illustration: <Pic><IconBadge kind="check" /></Pic>,
    },
  ];
}

export const digitalIdGuide: GuideDefinition = {
  key: "guide-digital-id",
  title: "Your digital ID",
  summary: "Open your card, show its QR code, and check another brother's ID.",
  group: "For every member",
  version: 1,
  audience: ctx => ctx.isFeatureOpen("DigitalId"),
  buildSteps: buildDigitalIdGuideSteps,
};
