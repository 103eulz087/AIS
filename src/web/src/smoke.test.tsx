/**
 * ROUTE SMOKE TEST — the highest-value test in this repo.
 *
 * WHY IT EXISTS: twice during design, a single-token mistake took down an entire page.
 * Neither was visible to ESLint, to TypeScript, or to a syntax check, because
 * A PARSE CHECK IS NOT A LOAD CHECK. This actually mounts every route.
 *
 * WHAT IT CANNOT DO: it renders components in a module scope, not a browser global
 * scope, so it will NOT catch a top-level identifier colliding with a `window`
 * property (`top`, `name`, `status`, `self`, `parent`, `length`). Bundled modules are
 * mostly immune to that, but any code injected as a classic script — an index.html
 * inline block, a third-party embed — is not. Keep that rule in review; this file
 * cannot enforce it for you.
 *
 * Every route in routes.tsx must appear here, added in the same commit as the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Home } from "@/ais/screens/Home";
import { Dashboard } from "@/ais/screens/Dashboard";
import { MemberDirectory } from "@/ais/screens/MemberDirectory";
import { Ledger } from "@/ais/screens/Ledger";
import { MeetingList } from "@/ais/screens/MeetingList";
import { MeetingNew } from "@/ais/screens/MeetingNew";
import { MeetingDetail } from "@/ais/screens/MeetingDetail";
import { AnnouncementList } from "@/ais/screens/AnnouncementList";
import { AnnouncementNew } from "@/ais/screens/AnnouncementNew";
import { AnnouncementDetail } from "@/ais/screens/AnnouncementDetail";
import { MemoList } from "@/ais/screens/MemoList";
import { MemoNew } from "@/ais/screens/MemoNew";
import { MemoDetail } from "@/ais/screens/MemoDetail";
import { ActivityList } from "@/ais/screens/ActivityList";
import { ActivityNew } from "@/ais/screens/ActivityNew";
import { ExpenseList } from "@/ais/screens/ExpenseList";
import { ExpenseNew } from "@/ais/screens/ExpenseNew";
import { ExpenseDetail } from "@/ais/screens/ExpenseDetail";
import { DonationList } from "@/ais/screens/DonationList";
import { DonationNew } from "@/ais/screens/DonationNew";
import { DonationDetail } from "@/ais/screens/DonationDetail";
import { SignIn } from "@/ais/screens/SignIn";
import { Enrol } from "@/ais/screens/Enrol";
import { Apply } from "@/ais/screens/Apply";
import { JoinChapter } from "@/ais/screens/JoinChapter";
import { ApplyStatus } from "@/ais/screens/ApplyStatus";
import { ApplicationQueue } from "@/ais/screens/ApplicationQueue";
import { ApplicationDetail } from "@/ais/screens/ApplicationDetail";
import { RegisterChapter } from "@/ais/screens/RegisterChapter";
import { RegisterChapterStatus } from "@/ais/screens/RegisterChapterStatus";
import { OfficerRoster } from "@/ais/screens/OfficerRoster";
import { InviteMembers } from "@/ais/screens/InviteMembers";
import { ChapterRegistrationQueue } from "@/portal/screens/ChapterRegistrationQueue";
import { ChapterRegistrationDetail } from "@/portal/screens/ChapterRegistrationDetail";
import { IdCardExport } from "@/portal/screens/IdCardExport";
import { CouncilStatistics } from "@/portal/screens/CouncilStatistics";
import { BlockedMembers } from "@/portal/screens/BlockedMembers";
import { CouncilRegistry } from "@/portal/screens/CouncilRegistry";
import { CouncilRoster } from "@/portal/screens/CouncilRoster";
import { CaseList } from "@/ais/screens/CaseList";
import { CaseNew } from "@/ais/screens/CaseNew";
import { CaseDetail } from "@/ais/screens/CaseDetail";
import { Profile } from "@/ais/screens/Profile";
import { DigitalId } from "@/ais/screens/DigitalId";
import { ChatRoom } from "@/ais/screens/ChatRoom";
import { ChatModeration } from "@/ais/screens/ChatModeration";
import { Conversations } from "@/ais/screens/Conversations";
import { Conversation } from "@/ais/screens/Conversation";
import { Scan } from "@/ais/screens/Scan";
import { VerifyCard } from "@/public/VerifyCard";
import { AuthProvider, RequireAuth } from "@/shared/auth";

// The chat module's SignalR connection (shared/chat-connection.ts) must never open a
// real WebSocket inside jsdom — there is no server here, and a real HubConnection
// failing to connect would otherwise spam console.error, which this file's own
// zero-console-errors assertion (below) would then fail on every route. This fake
// mirrors just enough of @microsoft/signalr's shape for useChatConnection to run its
// full success path: build() -> start() resolves immediately -> on()/off() are no-ops.
vi.mock("@microsoft/signalr", () => {
  class FakeHubConnection {
    start() { return Promise.resolve(); }
    stop() { return Promise.resolve(); }
    on() { /* no-op */ }
    off() { /* no-op */ }
    onreconnecting() { /* no-op */ }
    onreconnected() { /* no-op */ }
    onclose() { /* no-op */ }
  }
  class FakeHubConnectionBuilder {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { return new FakeHubConnection(); }
  }
  return {
    HubConnectionBuilder: FakeHubConnectionBuilder,
    LogLevel: { None: 0 },
  };
});

const ROUTES: Array<[path: string, element: React.ReactNode]> = [
  ["/", <Home key="h" chapterId={1} />],
  ["/dashboard", <Dashboard key="dash" chapterId={1} />],
  ["/members", <MemberDirectory key="m" />],
  ["/profile", <Profile key="pr" />],
  ["/digital-id", <DigitalId key="did" />],
  ["/ledger", <Ledger key="l" chapterId={1} />],
  ["/meetings", <MeetingList key="ml" chapterId={1} />],
  ["/meetings/new", <MeetingNew key="mn" chapterId={1} />],
  ["/meetings/some-meeting-id", <MeetingDetail key="md" chapterId={1} />],
  ["/announcements", <AnnouncementList key="al" chapterId={1} />],
  ["/announcements/new", <AnnouncementNew key="an" chapterId={1} />],
  ["/announcements/some-announcement-id", <AnnouncementDetail key="ad" chapterId={1} />],
  ["/memos", <MemoList key="ml2" chapterId={1} />],
  ["/memos/new", <MemoNew key="mn2" chapterId={1} />],
  ["/memos/some-memo-id", <MemoDetail key="mdet" chapterId={1} />],
  ["/activities", <ActivityList key="acl" chapterId={1} />],
  ["/activities/new", <ActivityNew key="acn" chapterId={1} />],
  ["/expenses", <ExpenseList key="exl" chapterId={1} />],
  ["/expenses/new", <ExpenseNew key="exn" chapterId={1} />],
  ["/expenses/some-expense-id", <ExpenseDetail key="exd" chapterId={1} />],
  ["/donations", <DonationList key="dol" chapterId={1} />],
  ["/donations/new", <DonationNew key="don" chapterId={1} />],
  ["/donations/some-donation-id", <DonationDetail key="dod" chapterId={1} />],
  ["/sign-in", <SignIn key="si" />],
  ["/enrol/some-token", <Enrol key="e" />],
  ["/apply", <Apply key="ap" />],
  ["/apply/status", <ApplyStatus key="aps" />],
  ["/j/some-invite-token", <JoinChapter key="jc" />],
  ["/applications", <ApplicationQueue key="aq" />],
  ["/applications/some-application-id", <ApplicationDetail key="ad2" />],
  ["/register-chapter", <RegisterChapter key="rc" />],
  ["/register-chapter/status", <RegisterChapterStatus key="rcs" />],
  ["/officers", <OfficerRoster key="or" />],
  ["/invite", <InviteMembers key="inv" />],
  ["/portal/chapter-registrations", <ChapterRegistrationQueue key="prq" />],
  ["/portal/chapter-registrations/some-registration-id", <ChapterRegistrationDetail key="prd" />],
  ["/portal/id-card-export", <IdCardExport key="pice" />],
  // No session in jsdom -> canViewCouncilStatistics(roles=[]) is false, so this
  // deterministically exercises the "you don't have access" empty state without ever
  // calling GET /api/councils/statistics — same reasoning as every other role-gated
  // Portal screen above.
  ["/portal/statistics", <CouncilStatistics key="pcs" />],
  // No session in jsdom -> canManageMemberAccounts(roles=[]) is false, so this
  // deterministically exercises the "you don't have access" empty state without ever
  // calling GET /api/members/blocked — same reasoning as every other role-gated Portal
  // screen above.
  ["/portal/blocked-members", <BlockedMembers key="pbm" />],
  // No session in jsdom -> canViewCouncilRegistry(roles=[]) is false, so both
  // deterministically exercise the "you don't have access" empty state — same
  // reasoning as every other role-gated Portal screen above.
  ["/portal/councils", <CouncilRegistry key="pcr" />],
  ["/portal/councils/1", <CouncilRoster key="pcrost" />],
  ["/corrective-actions", <CaseList key="cl" chapterId={1} />],
  ["/corrective-actions/new", <CaseNew key="cn" chapterId={1} />],
  ["/corrective-actions/some-case-id", <CaseDetail key="cd" chapterId={1} />],
  ["/chat", <ChatRoom key="chat" chapterId={1} />],
  ["/chat/moderation", <ChatModeration key="chatmod" chapterId={1} />],
  ["/conversations", <Conversations key="conv" />],
  ["/conversations/some-room-id", <Conversation key="convd" />],
  // No navigator.mediaDevices in jsdom, so this deterministically lands on the grey
  // "can't check right now" state — exactly the empty-of-camera state a plain-HTTP
  // deployment (CLAUDE.md §8.2) or a permission denial would also show.
  ["/scan", <Scan key="scan" />],
  // A well-formed guid so this exercises the real POST /api/verifications call and the
  // verified render, not just the malformed-token short-circuit.
  ["/verify/3f2a1c9e-89aa-4b7a-8f0a-000000000000", <VerifyCard key="vc" />],
];

const LEAKS = /\b(undefined|NaN|\[object Object\])\b/;

let container: HTMLDivElement;
let root: Root;
let consoleErrors: string[];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args) =>
    consoleErrors.push(args.map(String).join(" ")));

  // No API during a smoke test. Empty/failed payloads are deliberate: they exercise
  // the empty and not-signed-in states, which is what a brand-new chapter — or
  // anyone who hasn't opened the app yet today — sees most often.
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);

    // No session cookie in jsdom: the silent refresh every route attempts on
    // mount always comes back signed-out here, same as a fresh install.
    if (url.includes("/api/auth/refresh") || url.includes("/api/auth/me")) {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    // A fake enrolment token: always "no longer valid", the same response the
    // real API gives for expired, redeemed AND unrecognised tokens alike.
    if (url.includes("/api/enrolment/")) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    // DigitalId's own credential — a real MyCredentialDto shape so this exercises the
    // actual loaded card (member number, chapter, QR) rather than throwing on an
    // undefined giftName/verificationUrl. /api/members/me itself is deliberately left to
    // the generic fallback below (a {items,total,...} shape with no photoUrl), the same
    // "tolerate an unrelated payload without ever rendering the word undefined" posture
    // Profile.tsx's own MemberProfileResponse doc comment documents — DigitalId only
    // reads photoUrl off it, and treats an absent one as plainly "no photo on file".
    // VerifyCard's own POST /api/verifications — a real PublicVerificationDto shape, so
    // the smoke route below exercises the actual "verified" render (photoUrl: null
    // deliberately, to exercise the initials fallback rather than depend on jsdom's
    // unimplemented <img> network loading).
    if (url.includes("/api/verifications")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          isValid: true, giftName: "TANGLAW", chapterName: "San Isidro",
          statusName: "Active", renewedThrough: "2027-08-08", photoUrl: null,
        }),
      };
    }
    if (url.includes("/api/members/me/credential")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          giftName: "TANGLAW", fullName: "Juan Dela Cruz", memberNumber: "2024-00123",
          chapterName: "San Isidro", chapterCode: "SI",
          nationalCouncilName: null, regionName: "Region IV-A", provinceName: "Laguna", cityName: "Sta. Rosa",
          dateSurvive: "2024-01-04", bloodTypeName: "O+",
          statusName: "Active", renewedThrough: "2027-08-08",
          credentialIssuedDateUtc: "2026-08-09T00:00:00Z", credentialExpiryDateUtc: "2027-08-08T00:00:00Z",
          verificationUrl: "/verify/3f2a1c9e-0000-0000-0000-000000000000",
        }),
      };
    }
    // The dashboard's shape is nothing like Paged<T> — give it a real, all-zero
    // DashboardSummary so this exercises the "brand-new chapter" empty-state path
    // in every group, rather than throwing on an undefined `financial`/`membership`.
    if (url.includes("/dashboard")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          fromDate: "2026-08-09", toDate: "2027-08-08",
          financial: {
            openingBalance: 0, periodIn: 0, periodOut: 0, closingBalance: 0, currentBalance: 0,
            inFromMeetings: 0, inFromDonations: 0, inOther: 0, outOnExpenses: 0, outOther: 0,
          },
          membership: {
            total: 0, pending: 0, approved: 0, active: 0, inactive: 0, suspended: 0, rejected: 0,
            newThisPeriod: 0,
          },
          activity: { meetingsHeld: 0, totalPresent: 0, totalOnSheets: 0, averagePresentPerMeeting: 0 },
          correctiveActionCounts: [
            { statusName: "Pending", caseCount: 0 }, { statusName: "Under Review", caseCount: 0 },
            { statusName: "Reconciled", caseCount: 0 }, { statusName: "Dismissed", caseCount: 0 },
          ],
        }),
      };
    }
    // GET /api/chapters/{id}/chat/messages and GET /api/conversations/{id}/messages —
    // both a bare array (keyset pagination), unlike every other list endpoint in this
    // app, which returns {items,total,skip,take}. The generic fallback below would
    // make ChatRoom's/Conversation's own `[...rows].reverse()` throw.
    if (url.includes("/chat/messages") || (url.includes("/conversations/") && url.includes("/messages"))) {
      return { ok: true, status: 200, json: async () => [] };
    }
    // GET /api/notifications/preferences — a real NotificationPreferenceDto shape, so
    // Profile's NotificationSettings section exercises its actual toggle state rather
    // than the generic {items,total,...} fallback below (which it would also tolerate
    // via its own `?? true` default, but this is the real contract).
    if (url.includes("/api/notifications/preferences")) {
      return { ok: true, status: 200, json: async () => ({ privateMessagePush: true, mentionPush: true }) };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ items: [], total: 0, skip: 0, take: 50 }),
    };
  }));

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("every route mounts", () => {
  for (const [path, element] of ROUTES) {
    it(`${path} renders without throwing`, async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      await act(async () => {
        root.render(
          <QueryClientProvider client={qc}>
            <AuthProvider>
              <MemoryRouter initialEntries={[path]}>
                <Routes><Route path={path} element={element} /></Routes>
              </MemoryRouter>
            </AuthProvider>
          </QueryClientProvider>,
        );
      });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });

      expect(consoleErrors.join("\n"), `console errors on ${path}`).toBe("");
      expect(container.innerHTML.length, `${path} rendered empty`).toBeGreaterThan(20);

      const leak = container.innerHTML.match(LEAKS);
      expect(leak?.[0], `${path} leaked "${leak?.[0]}" into the DOM`).toBeUndefined();
    });
  }
});

describe("a guarded route with no session", () => {
  it("redirects to /sign-in instead of throwing", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <MemoryRouter initialEntries={["/members"]}>
              <Routes>
                <Route path="/members" element={<RequireAuth><MemberDirectory /></RequireAuth>} />
                <Route path="/sign-in" element={<SignIn />} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(consoleErrors.join("\n"), "console errors while redirecting").toBe("");
    // Landed on the sign-in screen, not a blank page and not a thrown error.
    expect(container.textContent).toContain("Sign in");
    expect(container.innerHTML.length).toBeGreaterThan(20);
  });
});
