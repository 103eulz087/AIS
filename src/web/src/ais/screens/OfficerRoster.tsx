import { useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canFileOfficerRoster } from "@/shared/roles";
import {
  CHAPTER_OFFICES, isSameChapter,
  type DirectoryRow, type SubmitChapterTurnoverRequest, type SubmitChapterTurnoverResponse,
} from "@/shared/types";
import {
  emptyTurnoverOfficerRoster, TurnoverOfficerFieldset, validateTurnoverOfficerRoster,
  type TurnoverOfficerFormValues,
} from "./ChapterOfficerFields";

/**
 * GET /api/members — no chapterId supplied, so usp_Member_Search defaults to the
 * caller's own chapter (see that procedure's own header: "@ChapterId IS NULL SET
 * @ChapterId = @CallerChapterId"). Every row this ChapterAdmin sees back is therefore
 * MemberDto's full same-chapter shape, never the cross-chapter one — exactly what the
 * office pickers below need (memberId + giftName + memberNumber).
 *
 * POST /api/chapter-registrations/turnover — files (or resubmits, transparently) the
 * caller's OWN chapter's annual officer roster. NO chapterId anywhere in the request; the
 * server re-derives it from the caller's own ChapterAdmin seat.
 *
 * ChapterAdmin-only (canFileOfficerRoster) — anyone else, including the read-only
 * Auditor, sees a plain "you don't have access" state, same pattern as
 * ApplicationQueue/ApplicationDetail's own canApproveApplications gate.
 */
export function OfficerRoster() {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canFile = canFileOfficerRoster(roles);

  const members = useQuery({
    queryKey: ["own-chapter-members-for-roster"],
    queryFn: () => api.get<Paged<DirectoryRow>>("/api/members?take=500"),
    enabled: canFile,
  });

  const [officers, setOfficers] = useState<TurnoverOfficerFormValues[]>(() => emptyTurnoverOfficerRoster());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [referenceNo, setReferenceNo] = useState<string | null>(null);

  function updateOfficer(index: number, memberId: number | null) {
    setOfficers(prev => prev.map((o, i) => (i === index ? { ...o, memberId } : o)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const officerError = validateTurnoverOfficerRoster(officers);
    if (officerError) { setError(officerError); return; }

    setSubmitting(true);
    try {
      const req: SubmitChapterTurnoverRequest = {
        officers: officers.map(o => ({ officeId: o.officeId, memberId: o.memberId as number })),
      };
      const res = await api.post<SubmitChapterTurnoverResponse>("/api/chapter-registrations/turnover", req);
      setReferenceNo(res.referenceNo);
    } catch (err) {
      if (err instanceof ApiError && err.errors) {
        setError(Object.values(err.errors).flat().join(" "));
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!canFile) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only the chapter admin can file the annual officer update."
      />
    );
  }

  if (referenceNo) {
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Officer update filed</h1>
        <p style={bodyTextStyle}>
          Your city council will verify each officer, then approve the update.
        </p>
        <div style={referenceCardStyle}>
          <div className="num" style={referenceTextStyle}>{referenceNo}</div>
        </div>
        <p style={{ ...bodyTextStyle, marginTop: 18 }}>
          Outgoing officers keep their member records and their history — only the office ends.
          Incoming officers each receive their own one-time enrolment link once approved, never a
          password, and never a handed-over account.
        </p>
        <Link to="/" style={primaryLinkStyle}>Back to home</Link>
      </div>
    );
  }

  if (members.isLoading) return <ScreenSkeleton rows={6} />;
  if (members.error) {
    return <ErrorState message={(members.error as Error).message} onRetry={() => members.refetch()} />;
  }

  const rows = (members.data?.items ?? []).filter(isSameChapter);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No members to choose from yet"
        body="Once your chapter has approved members, you can select them here for each office."
      />
    );
  }

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Annual officer update</h1>
      <p style={{ ...bodyTextStyle, marginTop: 8 }}>
        The same roster, filed again — pick a member of your own chapter for each of the eight
        offices. Outgoing officers keep their member records and their history; only the office
        ends. Incoming officers each get their own enrolment link, never a password, and an
        account is never handed over.
      </p>

      <form onSubmit={e => { void handleSubmit(e); }} style={{ marginTop: 20 }}>
        {CHAPTER_OFFICES.map((office, i) => (
          <TurnoverOfficerFieldset
            key={office.officeId} officeId={office.officeId}
            memberId={officers[i]?.memberId ?? null}
            members={rows}
            onChange={memberId => updateOfficer(i, memberId)}
          />
        ))}

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Filing…" : "File officer update"}
        </button>
      </form>
    </div>
  );
}

const pageStyle: CSSProperties = { padding: "20px 16px 40px" };

const titleStyle: CSSProperties = { fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" };

const bodyTextStyle: CSSProperties = { fontSize: 13.5, color: "var(--slate)", lineHeight: 1.6 };

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 10, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};

const referenceCardStyle: CSSProperties = {
  marginTop: 20, padding: 18, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", textAlign: "center",
};

const referenceTextStyle: CSSProperties = { fontSize: 26, fontWeight: 700, letterSpacing: ".04em" };

const primaryLinkStyle: CSSProperties = {
  display: "block", marginTop: 24, minHeight: "var(--tap)", lineHeight: "var(--tap)", textAlign: "center",
  borderRadius: 8, background: "var(--deep)", color: "var(--brass-soft)", textDecoration: "none",
  fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".06em", textTransform: "uppercase",
};
