import { type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Paged } from "@/shared/api";
import { peso, shortDate } from "@/shared/format";
import { useAuth } from "@/shared/auth";
import {
  canWriteComms, canWriteDonations, canWriteExpenses, canWriteMeetings,
} from "@/shared/roles";
import type { Announcement, ConversationSummary, LedgerSummary, MeetingListItem } from "@/shared/types";

const PREVIEW_TAKE = 4;

/**
 * The role-aware landing page after sign-in, at "/".
 *
 * Endpoints:
 *  - GET /api/chapters/{chapterId}/meetings?skip=0&take=4        (first few, newest first)
 *  - GET /api/chapters/{chapterId}/announcements?skip=0&take=4   (first few, newest first)
 *  - GET /api/chapters/{chapterId}/ledger/summary                (officer view only)
 *
 * Empty state: a brand-new chapter with no meetings or announcements yet shows a
 * plain "nothing here yet" line in each section — never an error — and an officer
 * still sees the quick-actions row so he has an obvious way to create the first one.
 *
 * CLAUDE.md invariant #5 (contributions are voluntary): the ledger summary's
 * `balance` is the only money aggregate this screen renders, and it is the same
 * chapter-wide total the Ledger screen already implies — never a per-member
 * figure, never an attendance/collection rate. Meeting rows here show subject,
 * date and location only, on purpose — no headcount, no rate.
 */
export function Home({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const giftName = claims?.giftName;

  const canMeetings = canWriteMeetings(roles);
  const canExpenses = canWriteExpenses(roles);
  const canDonations = canWriteDonations(roles);
  const canComms = canWriteComms(roles);
  const isOfficer = canMeetings || canExpenses || canDonations || canComms;

  const meetings = useQuery({
    queryKey: ["meetings", chapterId, "home"],
    queryFn: () => api.get<Paged<MeetingListItem>>(
      `/api/chapters/${chapterId}/meetings?skip=0&take=${PREVIEW_TAKE}`),
  });

  const announcements = useQuery({
    queryKey: ["announcements", chapterId, "home"],
    queryFn: () => api.get<Paged<Announcement>>(
      `/api/chapters/${chapterId}/announcements?skip=0&take=${PREVIEW_TAKE}`),
  });

  // Only fetched for an officer — a plain member is not shown the chapter balance
  // front-and-center on login, though he can still reach it via the Funds tab.
  const ledgerSummary = useQuery({
    queryKey: ["ledger-summary", chapterId],
    queryFn: () => api.get<LedgerSummary>(`/api/chapters/${chapterId}/ledger/summary`),
    enabled: isOfficer,
  });

  // A small, free unread badge — summed client-side from data this screen is already
  // fetching for the Messages link below, never a new endpoint just for this count
  // (private messaging isn't chapter-scoped, so this is fetched for every member,
  // never gated on isOfficer or on chapterId).
  const conversations = useQuery({
    queryKey: ["conversations", "home"],
    queryFn: () => api.get<Paged<ConversationSummary>>("/api/conversations?skip=0&take=20"),
  });
  const unreadMessages = conversations.data?.items.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0;

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={greetingStyle}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" }}>
          {giftName ? `Kumusta, ${giftName}` : "Kumusta!"}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 3 }}>
          {claims?.chapterName ?? "Welcome back."}
        </div>
      </div>

      {/* The Chapter Dashboard is a separate screen (how the chapter is doing over a
          period) from this one (what needs your attention right now) — every member
          reaches it from this single link, never officers-only. */}
      <div style={{ padding: "0 16px 4px" }}>
        <Link to="/dashboard" style={dashboardLinkStyle}>
          <span>See how your chapter is doing</span>
          <span style={{ color: "var(--brass-soft)" }}>›</span>
        </Link>
      </div>

      {/* Every member has his own Digital ID, not just officers — same reasoning as the
          dashboard link above, so this is never gated on isOfficer. */}
      <div style={{ padding: "8px 16px 4px" }}>
        <Link to="/digital-id" style={directoryLinkStyle}>
          <span>View your Digital ID</span>
          <span style={{ color: "var(--mute)" }}>›</span>
        </Link>
      </div>

      {/* Public chat (docs/AIS-Project-Documentation.md §4.8) belongs on the landing
          page, not a 6th bottom-nav tab — AppShell.tsx is already at its documented
          tab cap. Every member of the chapter can post here, so this is never gated
          on isOfficer, same reasoning as the Digital ID link above. No unread badge:
          that would need a new backend endpoint this module doesn't have yet.
          Gated on chapterId, though: a detached member (CLAUDE.md invariant #14 — his
          chapter went dormant, his home of record is now a council) has no chapter
          chat room to open, so he isn't invited into a room that doesn't exist for
          him. See routes.tsx's ChatRoomForCurrentChapter for the matching /chat guard. */}
      {chapterId ? (
        <div style={{ padding: "8px 16px 4px" }}>
          <Link to="/chat" style={directoryLinkStyle}>
            <span>Open the chapter chat</span>
            <span style={{ color: "var(--mute)" }}>›</span>
          </Link>
        </div>
      ) : null}

      {/* Private messages — never gated on chapterId/isOfficer: a private conversation
          isn't chapter-scoped, so even a detached member (CLAUDE.md invariant #14)
          can still see and reply to his own. */}
      <div style={{ padding: "8px 16px 4px" }}>
        <Link to="/conversations" style={directoryLinkStyle}>
          <span>Messages{unreadMessages > 0 ? ` (${unreadMessages})` : ""}</span>
          <span style={{ color: "var(--mute)" }}>›</span>
        </Link>
      </div>

      {isOfficer && (
        <>
          <QuickActions
            canMeetings={canMeetings} canExpenses={canExpenses}
            canDonations={canDonations} canComms={canComms}
          />
          <FundBalanceCard summary={ledgerSummary.data} isLoading={ledgerSummary.isLoading} isError={ledgerSummary.isError} />
        </>
      )}

      <SectionLabel to="/announcements">Notices</SectionLabel>
      <AnnouncementsPreview
        items={announcements.data?.items} isLoading={announcements.isLoading} isError={announcements.isError}
        onRetry={() => announcements.refetch()}
      />

      <SectionLabel to="/meetings">Meetings</SectionLabel>
      <MeetingsPreview
        items={meetings.data?.items} isLoading={meetings.isLoading} isError={meetings.isError}
        onRetry={() => meetings.refetch()} canCreate={canMeetings}
      />

      {!isOfficer && (
        <div style={{ padding: "16px 16px 4px" }}>
          <Link to="/members" style={directoryLinkStyle}>
            <span>Look up a brother in the member directory</span>
            <span style={{ color: "var(--mute)" }}>›</span>
          </Link>
        </div>
      )}
    </div>
  );
}

function QuickActions({ canMeetings, canExpenses, canDonations, canComms }: {
  canMeetings: boolean; canExpenses: boolean; canDonations: boolean; canComms: boolean;
}) {
  const actions: Array<{ to: string; label: string; icon: string }> = [];
  if (canMeetings) actions.push({ to: "/meetings/new", label: "New meeting", icon: "▤" });
  if (canExpenses) actions.push({ to: "/expenses/new", label: "New expense", icon: "₱" });
  if (canDonations) actions.push({ to: "/donations/new", label: "New donation", icon: "🎁" });
  if (canComms) actions.push({ to: "/announcements/new", label: "New announcement", icon: "🔔" });

  if (actions.length === 0) return null;

  return (
    <div>
      <div style={sectionLabelStyle}>Quick actions</div>
      <div style={quickActionsGridStyle}>
        {actions.map(a => (
          <Link key={a.to} to={a.to} style={quickActionStyle}>
            <span style={{ fontSize: 17 }}>{a.icon}</span>
            <span>{a.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function FundBalanceCard({ summary, isLoading, isError }: {
  summary: LedgerSummary | undefined; isLoading: boolean; isError: boolean;
}) {
  return (
    <Link to="/ledger" style={fundCardStyle}>
      <div style={{ fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".14em", color: "var(--brass)" }}>
        CHAPTER FUNDS
      </div>
      <div className="num" style={{ fontSize: 26, fontWeight: 600, color: "#fff", marginTop: 5 }}>
        {isLoading ? "…" : isError ? "—" : peso(summary?.balance)}
      </div>
      <div style={{ fontSize: 11.5, color: "#8B95A3", marginTop: 4 }}>
        {isError ? "Could not load — tap to open the ledger" : "Tap to see every entry behind this figure"}
      </div>
    </Link>
  );
}

function SectionLabel({ to, children }: { to: string; children: ReactNode }) {
  return (
    <div style={sectionLabelRowStyle}>
      <span>{children}</span>
      <Link to={to} style={seeAllStyle}>See all</Link>
    </div>
  );
}

function AnnouncementsPreview({ items, isLoading, isError, onRetry }: {
  items: Announcement[] | undefined; isLoading: boolean; isError: boolean; onRetry: () => void;
}) {
  if (isLoading) return <PreviewSkeleton />;
  if (isError) return <PreviewError onRetry={onRetry} />;

  const list = items ?? [];
  if (list.length === 0) {
    return <PreviewEmpty text="Nothing posted yet. Once your chapter posts an announcement, it appears here." />;
  }

  // Same "urgent, still-live posts read first" ordering as AnnouncementList — a
  // blood or assistance request is the reason someone opened this screen.
  const ordered = [...list].sort((a, b) =>
    Number(b.isUrgent && !b.isWithdrawn) - Number(a.isUrgent && !a.isWithdrawn));

  return (
    <div>
      {ordered.map(a => {
        const isLiveUrgent = a.isUrgent && !a.isWithdrawn;
        return (
          <Link key={a.announcementId} to={`/announcements/${a.announcementId}`} style={previewRowStyle}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flex: "none",
              display: "grid", placeItems: "center", fontFamily: "var(--f-disp)", fontSize: 14,
              background: isLiveUrgent ? "#FBF4E4" : "var(--brass-soft)",
              color: isLiveUrgent ? "var(--warn)" : "var(--brass-dk)",
            }}>
              {isLiveUrgent ? "!" : "📣"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 2 }}>
                {shortDate(a.publishDateUtc)}
                {!a.hasRead && !a.isWithdrawn && <span style={newPillStyle}>New</span>}
              </div>
            </div>
            <span style={{ color: "var(--mute)", flex: "none" }}>›</span>
          </Link>
        );
      })}
    </div>
  );
}

function MeetingsPreview({ items, isLoading, isError, onRetry, canCreate }: {
  items: MeetingListItem[] | undefined; isLoading: boolean; isError: boolean;
  onRetry: () => void; canCreate: boolean;
}) {
  if (isLoading) return <PreviewSkeleton />;
  if (isError) return <PreviewError onRetry={onRetry} />;

  const list = items ?? [];
  if (list.length === 0) {
    return (
      <PreviewEmpty
        text="No meetings recorded yet."
        action={canCreate ? <Link to="/meetings/new" style={emptyActionStyle}>+ New meeting</Link> : undefined}
      />
    );
  }

  return (
    <div>
      {list.map(m => (
        // Subject, date and location only — no headcount or collection figure here.
        // The full row (with attendance and the meeting's own collection total) lives
        // on MeetingList/MeetingDetail, one tap away.
        <Link key={m.meetingId} to={`/meetings/${m.meetingId}`} style={previewRowStyle}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flex: "none",
            display: "grid", placeItems: "center", fontSize: 14,
            background: "#EFF4F9", color: "var(--info)",
          }}>▤</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.subject}</div>
            <div style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 2 }}>
              {shortDate(m.meetingDate)}{m.location ? ` · ${m.location}` : ""}
            </div>
          </div>
          <span style={{ color: "var(--mute)", flex: "none" }}>›</span>
        </Link>
      ))}
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div style={{ padding: "0 16px" }}>
      {[0, 1].map(i => (
        <div key={i} style={{
          height: 52, marginBottom: 8, borderRadius: "var(--r)",
          background: "var(--paper)", border: "1px solid var(--line)", opacity: 0.6,
        }} />
      ))}
    </div>
  );
}

function PreviewError({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ padding: "10px 16px 18px" }}>
      <p style={{ fontSize: 12.5, color: "var(--slate)" }}>That did not load.</p>
      <button type="button" onClick={onRetry} style={retryLinkStyle}>Try again</button>
    </div>
  );
}

function PreviewEmpty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div style={{ padding: "10px 16px 20px" }}>
      <p style={{ fontSize: 12.5, color: "var(--mute)", lineHeight: 1.6 }}>{text}</p>
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

const greetingStyle: CSSProperties = {
  padding: "20px 16px 6px",
};

const sectionLabelStyle: CSSProperties = {
  padding: "16px 16px 8px", fontFamily: "var(--f-disp)", fontSize: 13,
  letterSpacing: ".08em", textTransform: "uppercase", color: "var(--slate)",
};

const sectionLabelRowStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "18px 16px 8px", fontFamily: "var(--f-disp)", fontSize: 13,
  letterSpacing: ".08em", textTransform: "uppercase", color: "var(--slate)",
};

const seeAllStyle: CSSProperties = {
  fontSize: 11.5, letterSpacing: "normal", textTransform: "none",
  color: "var(--info)", textDecoration: "none", fontFamily: "var(--f-body, inherit)",
};

const quickActionsGridStyle: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, padding: "0 16px",
};

const quickActionStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, minHeight: "var(--tap)",
  padding: "0 12px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--ink)", fontSize: 13, textDecoration: "none",
};

const fundCardStyle: CSSProperties = {
  display: "block", margin: "12px 16px 4px", padding: 14, borderRadius: "var(--r)",
  background: "var(--deep)", color: "var(--brass-soft)", textDecoration: "none",
};

const dashboardLinkStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)", textDecoration: "none", fontSize: 13.5,
};

const directoryLinkStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  minHeight: "var(--tap)", padding: "0 14px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)",
  color: "var(--ink)", fontSize: 13.5, textDecoration: "none",
};

const previewRowStyle: CSSProperties = {
  display: "flex", gap: 10, alignItems: "center", padding: "10px 16px",
  background: "var(--paper)", borderBottom: "1px solid var(--line)",
  minHeight: "var(--tap)", textDecoration: "none", color: "inherit",
};

const newPillStyle: CSSProperties = {
  marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 8,
  background: "var(--brass-soft)", color: "var(--brass-dk)",
};

const emptyActionStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 36, padding: "0 14px",
  borderRadius: 8, background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em",
  textTransform: "uppercase", textDecoration: "none",
};

const retryLinkStyle: CSSProperties = {
  marginTop: 4, fontSize: 12.5, color: "var(--info)", textDecoration: "underline",
  minHeight: "var(--tap)",
};
