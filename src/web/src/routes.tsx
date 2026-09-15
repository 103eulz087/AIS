import { createBrowserRouter } from "react-router-dom";
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
import { ApplyStatus } from "@/ais/screens/ApplyStatus";
import { ApplicationQueue } from "@/ais/screens/ApplicationQueue";
import { ApplicationDetail } from "@/ais/screens/ApplicationDetail";
import { CaseList } from "@/ais/screens/CaseList";
import { CaseNew } from "@/ais/screens/CaseNew";
import { CaseDetail } from "@/ais/screens/CaseDetail";
import { Profile } from "@/ais/screens/Profile";
import { DigitalId } from "@/ais/screens/DigitalId";
import { ChatRoom } from "@/ais/screens/ChatRoom";
import { ChatModeration } from "@/ais/screens/ChatModeration";
import { Conversations } from "@/ais/screens/Conversations";
import { Conversation } from "@/ais/screens/Conversation";
import { AppShell } from "@/shared/AppShell";
import { RequireAuth, useAuth } from "@/shared/auth";
import { EmptyState } from "@/shared/states";

function HomeForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <Home chapterId={claims.chapterId} />;
}

/** Open to every signed-in member, not just officers — see Dashboard.tsx's own doc comment. */
function DashboardForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <Dashboard chapterId={claims.chapterId} />;
}

/** Reads the signed-in officer's own chapter — never a hardcoded or request-supplied id. */
function LedgerForCurrentChapter() {
  const { claims } = useAuth();
  // RequireAuth guarantees claims are loaded before this renders; defensive only.
  if (!claims) return null;
  return <Ledger chapterId={claims.chapterId} />;
}

function MeetingListForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <MeetingList chapterId={claims.chapterId} />;
}

function MeetingNewForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <MeetingNew chapterId={claims.chapterId} />;
}

function MeetingDetailForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <MeetingDetail chapterId={claims.chapterId} />;
}

function AnnouncementListForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <AnnouncementList chapterId={claims.chapterId} />;
}

function AnnouncementNewForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <AnnouncementNew chapterId={claims.chapterId} />;
}

function AnnouncementDetailForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <AnnouncementDetail chapterId={claims.chapterId} />;
}

function MemoListForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <MemoList chapterId={claims.chapterId} />;
}

function MemoNewForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <MemoNew chapterId={claims.chapterId} />;
}

function MemoDetailForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <MemoDetail chapterId={claims.chapterId} />;
}

function ActivityListForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <ActivityList chapterId={claims.chapterId} />;
}

function ActivityNewForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <ActivityNew chapterId={claims.chapterId} />;
}

function ExpenseListForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <ExpenseList chapterId={claims.chapterId} />;
}

function ExpenseNewForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <ExpenseNew chapterId={claims.chapterId} />;
}

function ExpenseDetailForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <ExpenseDetail chapterId={claims.chapterId} />;
}

function DonationListForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <DonationList chapterId={claims.chapterId} />;
}

function DonationNewForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <DonationNew chapterId={claims.chapterId} />;
}

function DonationDetailForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <DonationDetail chapterId={claims.chapterId} />;
}

function CaseListForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <CaseList chapterId={claims.chapterId} />;
}

function CaseNewForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <CaseNew chapterId={claims.chapterId} />;
}

function CaseDetailForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <CaseDetail chapterId={claims.chapterId} />;
}

/**
 * A detached member (CLAUDE.md invariant #14 — his chapter went dormant, so his home
 * of record is now a council) has claims.chapterId of 0/falsy. There is no chapter
 * chat room for him to open, and none will exist again unless his chapter is
 * reconstituted — so this is never a transient failure and never shown as one. No
 * ErrorState/Retry here on purpose: retrying can never succeed, and telling him he
 * isn't "permitted" would be both alarming and untrue (see ChatHub.OnConnectedAsync,
 * which already treats an absent chapter this same calm way — no group, no error).
 */
function ChatRoomForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  if (!claims.chapterId) {
    return (
      <EmptyState
        title="Chapter chat isn't available"
        body="Your chapter chat isn't available right now. If your chapter has gone dormant, ask your council for help."
      />
    );
  }
  return <ChatRoom chapterId={claims.chapterId} />;
}

function ChatModerationForCurrentChapter() {
  const { claims } = useAuth();
  if (!claims) return null;
  return <ChatModeration chapterId={claims.chapterId} />;
}

/**
 * Every route added here MUST also be added to src/smoke.test.tsx.
 * A route that is not in the smoke list is a route nobody checks.
 */
export const router = createBrowserRouter([
  // Public: identity is not known yet, so no chapter mark and no app chrome.
  { path: "/sign-in", element: <SignIn /> },
  { path: "/enrol/:token", element: <Enrol /> },
  { path: "/apply", element: <Apply /> },
  { path: "/apply/status", element: <ApplyStatus /> },

  {
    path: "/",
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { index: true, element: <HomeForCurrentChapter /> },
      { path: "dashboard", element: <DashboardForCurrentChapter /> },
      { path: "members", element: <MemberDirectory /> },
      // Self-scoped: no chapterId anywhere, the caller's own identity comes from the
      // JWT alone (ICurrentUser), so no "ForCurrentChapter" wrapper is needed here.
      { path: "profile", element: <Profile /> },
      { path: "digital-id", element: <DigitalId /> },
      // ChapterAdmin-only; the screens themselves gate on canApproveApplications and
      // render a plain "you don't have access" state for anyone else, same pattern
      // as ExpenseNew's own role check — no chapterId in the route, the API scopes
      // this to the caller's own chapter from the JWT.
      { path: "applications", element: <ApplicationQueue /> },
      { path: "applications/:applicationId", element: <ApplicationDetail /> },
      { path: "ledger", element: <LedgerForCurrentChapter /> },
      { path: "meetings", element: <MeetingListForCurrentChapter /> },
      { path: "meetings/new", element: <MeetingNewForCurrentChapter /> },
      { path: "meetings/:meetingId", element: <MeetingDetailForCurrentChapter /> },
      { path: "announcements", element: <AnnouncementListForCurrentChapter /> },
      { path: "announcements/new", element: <AnnouncementNewForCurrentChapter /> },
      { path: "announcements/:announcementId/edit", element: <AnnouncementNewForCurrentChapter /> },
      { path: "announcements/:announcementId", element: <AnnouncementDetailForCurrentChapter /> },
      { path: "memos", element: <MemoListForCurrentChapter /> },
      { path: "memos/new", element: <MemoNewForCurrentChapter /> },
      { path: "memos/:memoId/supersede", element: <MemoNewForCurrentChapter /> },
      { path: "memos/:memoId", element: <MemoDetailForCurrentChapter /> },
      { path: "activities", element: <ActivityListForCurrentChapter /> },
      { path: "activities/new", element: <ActivityNewForCurrentChapter /> },
      { path: "expenses", element: <ExpenseListForCurrentChapter /> },
      { path: "expenses/new", element: <ExpenseNewForCurrentChapter /> },
      { path: "expenses/:expenseId", element: <ExpenseDetailForCurrentChapter /> },
      { path: "donations", element: <DonationListForCurrentChapter /> },
      { path: "donations/new", element: <DonationNewForCurrentChapter /> },
      { path: "donations/:donationId", element: <DonationDetailForCurrentChapter /> },
      // Reading the list/detail is open to every chapter member; canWriteDiscipline
      // (ChapterAdmin only) gates filing/status-updates within the screens themselves,
      // same pattern as ApplicationQueue/ApplicationDetail's canApproveApplications gate.
      { path: "corrective-actions", element: <CaseListForCurrentChapter /> },
      { path: "corrective-actions/new", element: <CaseNewForCurrentChapter /> },
      { path: "corrective-actions/:caseId", element: <CaseDetailForCurrentChapter /> },
      { path: "chat", element: <ChatRoomForCurrentChapter /> },
      { path: "chat/moderation", element: <ChatModerationForCurrentChapter /> },
      // Private (1:1) messages — self-scoped, no chapterId anywhere (a private room
      // isn't chapter-scoped; see Features/Conversations' own header comment), so
      // neither needs a "ForCurrentChapter" wrapper.
      { path: "conversations", element: <Conversations /> },
      { path: "conversations/:roomId", element: <Conversation /> },
      // TODO next: /scan, /seals, /portal/*
    ],
  },
]);
