import { api, type Paged } from "@/shared/api";
import { peso } from "@/shared/format";
import { canVoidMoney, canWriteActivities, canWriteDonations, canWriteExpenses } from "@/shared/roles";
import type { ExpenseListItem } from "@/shared/types";
import { lazyOnce, type GuideDefinition } from "@/shared/tour/guides";
import {
  BadgeSketch, FieldSketch, IconBadge, Pic, PhoneFrame, SketchButton, SketchRow, StepStrip,
} from "@/shared/tour/illustrations";
import type { GuideContext, TourStep } from "@/shared/tour/types";

/**
 * guide-money — "Record money". The real New forms, one box at a time: expense (with its
 * required receipt), donation (cash, goods or both) and activity, then how a mistake is
 * put right: never edited, but voided with a reason, which posts a reversing entry.
 *
 * Which sections appear follows the same role helpers the screens use, so a Treasurer is
 * not walked through "New activity" and an officer is not walked through expenses.
 * Nothing is saved: the engine blocks every tap and submit.
 *
 * Targets (data-tour) live on: ExpenseList (expenses-new-button), ExpenseNew
 * (expense-field-payee, expense-field-amount, expense-receipt), DonationList
 * (donations-new-button), DonationNew (donation-field-donor, donation-gift), ActivityList
 * (activities-new-button), ActivityNew (activity-field-name), ExpenseDetail (expense-void),
 * AppShell (tab-funds).
 */
export function buildMoneyGuideSteps(ctx: GuideContext): TourStep[] {
  const wait = 5000;
  const roles = ctx.roles;
  const findVoidable = lazyOnce(async () => {
    const chapterId = ctx.claims?.chapterId;
    if (!chapterId) return null;
    const res = await api.get<Paged<ExpenseListItem>>(`/api/chapters/${chapterId}/expenses?skip=0&take=25`);
    const x = (res.items ?? []).find(e => !e.isVoided);
    return x ? `/expenses/${x.expenseId}` : null;
  });
  const voidRoute = () => findVoidable();

  const steps: TourStep[] = [
    {
      id: "intro",
      title: "Recording money",
      body: "As an officer you write the chapter's books. We will look at each form together. Nothing is saved while the guide runs.",
      illustration: <Pic><IconBadge kind="money" /></Pic>,
    },
    {
      id: "tab", route: "/", target: "tab-funds",
      title: "Everything starts in Funds",
      body: "Tap Funds at the bottom of the screen. Expenses, Donations and Activities each have their own list and a New button.",
      illustration: (
        <Pic>
          <PhoneFrame highlight={{ left: 52, top: 74, width: 30, height: 20 }}>
            <SketchButton>+ NEW</SketchButton><SketchRow /><SketchRow />
          </PhoneFrame>
        </Pic>
      ),
    },
  ];

  if (canWriteExpenses(roles)) {
    steps.push(
      {
        id: "expense-button", route: "/expenses", target: "expenses-new-button", waitMs: wait,
        title: "Record an expense",
        body: "On the Expenses list, tap + New expense when the chapter has paid someone.",
        illustration: <Pic><PhoneFrame highlight={{ left: 52, top: 26, width: 42, height: 22 }}><SketchButton>+ NEW EXPENSE</SketchButton><SketchRow /><SketchRow /></PhoneFrame></Pic>,
      },
      {
        id: "expense-payee", route: "/expenses/new", target: "expense-field-payee", waitMs: 4000,
        title: "Who was paid",
        body: "Write the person or shop that received the money, for example ABC Hardware.",
        illustration: <Pic><FieldSketch label="Paid to" value="ABC Hardware" highlight /></Pic>,
      },
      {
        id: "expense-amount", route: "/expenses/new", target: "expense-field-amount",
        title: "How much",
        body: "Type the amount in pesos. Below it you can also pick a date, a category and the activity it belongs to.",
        illustration: <Pic><FieldSketch label="Amount" value={peso(1250)} highlight width={140} /></Pic>,
      },
      {
        id: "expense-receipt", route: "/expenses/new", target: "expense-receipt",
        title: "A receipt is required",
        body: "Tap here to add a photo or PDF of the receipt. Save expense stays dim until at least one receipt is added. This keeps the books open to checking.",
        illustration: <Pic><StepStrip steps={["Fill in", "Add receipt", "Save"]} active={1} /></Pic>,
      },
    );
  }

  if (canWriteDonations(roles)) {
    steps.push(
      {
        id: "donation-button", route: "/donations", target: "donations-new-button", waitMs: wait,
        title: "Record a donation",
        body: "When someone gives to the chapter, tap + New donation on the Donations list. Gifts are always voluntary.",
      },
      {
        id: "donation-donor", route: "/donations/new", target: "donation-field-donor", waitMs: 4000,
        title: "Who gave",
        body: "Write the donor's name. You can also pick what kind of donor he or she is, though this is optional.",
        illustration: <Pic><FieldSketch label="Donor's name" value="Mayor Juan Dela Cruz" highlight /></Pic>,
      },
      {
        id: "donation-gift", route: "/donations/new", target: "donation-gift",
        title: "Cash, goods, or both",
        body: "Fill in a cash amount, a description of goods such as 20 sacks of rice, or both. At least one is needed.",
        illustration: <Pic gap={8}><BadgeSketch tone="ok">Cash</BadgeSketch><BadgeSketch tone="info">Goods</BadgeSketch></Pic>,
      },
    );
  }

  if (canWriteActivities(roles)) {
    steps.push(
      {
        id: "activity-button", route: "/activities", target: "activities-new-button", waitMs: wait,
        title: "Start an activity",
        body: "An activity is a project, like a clean-up drive. Tap + New activity so its donations and expenses can be grouped together.",
      },
      {
        id: "activity-name", route: "/activities/new", target: "activity-field-name", waitMs: 4000,
        title: "Name it",
        body: "Give the activity a name. The date and a short description are optional. Donations and expenses are added to it afterwards.",
        illustration: <Pic><FieldSketch label="Activity name" value="Barangay Clean-Up Drive" highlight /></Pic>,
      },
    );
  }

  steps.push({
    id: "corrections",
    title: "Mistakes are never edited",
    body: "A posted entry is never changed or deleted. If something was recorded wrongly, it is voided with a reason, and a reversing entry cancels it in the ledger. Both stay visible.",
    illustration: <Pic gap={8}><BadgeSketch tone="neutral">Entry</BadgeSketch><BadgeSketch tone="warn">REVERSAL</BadgeSketch></Pic>,
    tip: "Check the amount and receipt before you save. It is easier than correcting later.",
  });

  if (canVoidMoney(roles)) {
    steps.push({
      id: "void", route: voidRoute, target: "expense-void", waitMs: 6000,
      title: "Voiding an expense",
      body: "Your chapter admin can tap Void this expense on its page, then give a reason of at least 10 characters. Donations are voided the same way. We will not press it.",
    });
  }

  steps.push({
    id: "done",
    title: "That's recording money",
    body: "Everything you record is open to every member of the chapter. You can run this guide again from Help & guides.",
    illustration: <Pic><IconBadge kind="check" /></Pic>,
  });
  return steps;
}

export const moneyGuide: GuideDefinition = {
  key: "guide-money",
  title: "Record money",
  summary: "Record an expense, a donation or an activity, and see how mistakes are put right.",
  group: "For chapter officers",
  version: 1,
  audience: ctx =>
    ctx.isFeatureOpen("Funds")
    && (canWriteExpenses(ctx.roles) || canWriteDonations(ctx.roles) || canWriteActivities(ctx.roles)),
  buildSteps: buildMoneyGuideSteps,
};
