import { peso, pesoSigned } from "@/shared/format";
import type { GuideDefinition } from "@/shared/tour/guides";
import {
  BadgeSketch, IconBadge, Pic, PhoneFrame, SketchLine, SketchRow, StepStrip,
} from "@/shared/tour/illustrations";
import type { TourStep } from "@/shared/tour/types";

/**
 * guide-funds — "Read your chapter's books". Funds tab -> balance -> a posting -> how a
 * correction shows up (a REVERSAL line beside the original; nothing is ever edited) ->
 * a look at expenses, donations and activities.
 *
 * Read-only: nothing here is ever changed. Steps whose target is not on screen (an empty
 * ledger has no balance card or rows) are dropped by the engine, so the explaining steps
 * (views, corrections) carry the story on their own.
 *
 * Targets (data-tour) live on: AppShell (tab-funds), FundsTabs (funds-tabs), Ledger
 * (funds-balance, funds-first-entry, funds-append-note, funds-council-note), ExpenseList
 * (expenses-first-row), DonationList (donations-first-row).
 */
export function buildFundsGuideSteps(): TourStep[] {
  const wait = 5000;
  return [
    {
      id: "intro",
      title: "Reading the books",
      body: "Every member of the chapter sees the same books. We will look at the balance, the entries behind it, and how a mistake is put right.",
      illustration: <Pic><IconBadge kind="book" /></Pic>,
    },
    {
      id: "tab", route: "/", target: "tab-funds",
      title: "Open Funds",
      body: "Tap Funds at the bottom of the screen. It opens the ledger, the chapter's running record of money in and money out.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 52, top: 74, width: 30, height: 20 }}>
            <SketchLine w="50%" strong /><SketchRow /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
    {
      id: "views", route: "/ledger", target: "funds-tabs", waitMs: wait,
      title: "Four ways to look",
      body: "Ledger shows every posting. Activities are projects. Expenses and Donations list each one with its details. Tap a name to switch.",
      illustration: <Pic gap={5}><BadgeSketch tone="brass">Ledger</BadgeSketch><BadgeSketch>Activities</BadgeSketch><BadgeSketch>Expenses</BadgeSketch></Pic>,
    },
    {
      id: "balance", route: "/ledger", target: "funds-balance", waitMs: wait,
      title: "Current balance",
      body: "This is what the chapter has right now: all money in, less all money out. It is always worked out from the entries below it.",
      illustration: <Pic><BalanceCard /></Pic>,
    },
    {
      id: "council-note", route: "/ledger", target: "funds-council-note", waitMs: wait,
      title: "Who else can see it",
      body: "Your council sees the chapter's overall balance and totals for a period. They cannot see the individual entries. Those stay with your chapter.",
    },
    {
      id: "entry", route: "/ledger", target: "funds-first-entry", waitMs: wait,
      title: "One line, one posting",
      body: "Each line says what it was for, the date, and where it came from, such as a meeting or an expense. Green plus is money in, red minus is money out.",
      illustration: (
        <Pic gap={14}>
          <span className="num" style={{ color: "var(--in)", fontSize: 13 }}>{pesoSigned(500, "In")}</span>
          <span className="num" style={{ color: "var(--out)", fontSize: 13 }}>{pesoSigned(350, "Out")}</span>
        </Pic>
      ),
    },
    {
      id: "corrections", route: "/ledger", target: "funds-append-note", waitMs: wait,
      title: "Mistakes are never erased",
      body: "Nothing in the ledger is edited or deleted. If something was entered wrongly, a new line marked REVERSAL cancels it, and both stay visible.",
      illustration: (
        <Pic gap={8}>
          <span className="num" style={{ color: "var(--out)", fontSize: 12.5 }}>{pesoSigned(350, "Out")}</span>
          <BadgeSketch tone="warn">REVERSAL</BadgeSketch>
          <span className="num" style={{ color: "var(--in)", fontSize: 12.5 }}>{pesoSigned(350, "In")}</span>
        </Pic>
      ),
      tip: "A reversal is not an accusation. It is simply how the books stay honest.",
    },
    {
      id: "expenses", route: "/expenses", target: "expenses-first-row", waitMs: wait,
      title: "Expenses",
      body: "Each expense shows who was paid, the date, and what for. Tap one to open it and see its receipt. A voided expense stays on the list, marked as voided.",
    },
    {
      id: "donations", route: "/donations", target: "donations-first-row", waitMs: wait,
      title: "Donations",
      body: "Each donation shows the donor and the date, as cash, goods, or both. Giving is always voluntary and always welcome. Nobody is expected to give.",
    },
    {
      id: "activities", route: "/activities", target: "funds-tabs", waitMs: wait,
      title: "Activities",
      body: "An activity is a project, like a clean-up drive. Each shows how much came in for it and how much was spent, with links to its donations and expenses.",
      illustration: (
        <Pic gap={14}>
          <span className="num" style={{ color: "var(--in)", fontSize: 12.5 }}>{peso(5000)}</span>
          <span className="num" style={{ color: "var(--out)", fontSize: 12.5 }}>{peso(3200)}</span>
        </Pic>
      ),
    },
    {
      id: "done",
      title: "That's the books",
      body: "Every figure you see can be opened down to the entry behind it. You can run this guide again from Help & guides.",
      illustration: <Pic><StepStrip steps={["Balance", "Entries", "Receipts"]} active={2} /></Pic>,
    },
  ];
}

/** A tiny balance card in the style of the real one. */
function BalanceCard() {
  return (
    <span aria-hidden="true" style={{ display: "block", padding: "8px 14px", borderRadius: 8, background: "var(--deep)", color: "var(--brass-soft)" }}>
      <span style={{ display: "block", fontSize: 8.5, letterSpacing: ".14em", color: "var(--brass)" }}>CURRENT BALANCE</span>
      <span className="num" style={{ display: "block", fontSize: 17, color: "#fff", marginTop: 2 }}>{peso(12345.5)}</span>
    </span>
  );
}

export const fundsGuide: GuideDefinition = {
  key: "guide-funds",
  title: "Read your chapter's books",
  summary: "See the balance, the entries behind it, and how a mistake is corrected.",
  group: "For every member",
  version: 1,
  audience: ctx => ctx.isFeatureOpen("Funds"),
  buildSteps: buildFundsGuideSteps,
};
