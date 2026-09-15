import { useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canWriteComms } from "@/shared/roles";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import type { Memo } from "@/shared/types";

interface MemoPublished { memoId: number; memoNumber: string }

/**
 * POST /api/chapters/{chapterId}/memos.
 *
 * One form, two routes: "/memos/new" publishes a fresh memo; "/memos/:memoId/supersede"
 * publishes a new one with supersedesMemoId set to the memo being corrected. There is
 * no PUT — a memo is immutable once published (enforced at the database level), so a
 * correction is always a brand-new numbered document, never an edit of the original.
 *
 * The memo being superseded is fetched from the chapter's memo list (there is no
 * GET-by-id endpoint) and shown at the top, so the officer knows exactly what he is
 * replacing before he writes the correction.
 *
 * Officer-only route: a plain member landing here sees a plain "you don't have
 * access" state, same pattern as MeetingNew.
 */
export function MemoNew({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const isOfficer = canWriteComms(roles);
  const navigate = useNavigate();

  const { memoId: idParam } = useParams<{ memoId?: string }>();
  const isSupersede = idParam !== undefined;
  const supersedesMemoId = isSupersede ? Number(idParam) : null;

  const source = useQuery({
    queryKey: ["memos-source-for-supersede", chapterId],
    queryFn: () => api.get<Paged<Memo>>(`/api/chapters/${chapterId}/memos?take=500`),
    enabled: isSupersede && isOfficer && Number.isFinite(supersedesMemoId),
  });

  const beingCorrected = isSupersede
    ? source.data?.items.find(m => m.memoId === supersedesMemoId) ?? null
    : null;

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOfficer) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only a chapter officer can publish a memo. Ask your Secretary or President."
      />
    );
  }

  if (isSupersede && !Number.isFinite(supersedesMemoId)) {
    return <EmptyState title="That memo could not be found" body="Check the link and try again." />;
  }

  if (isSupersede && source.isLoading) return <ScreenSkeleton rows={4} />;

  if (isSupersede && source.error) {
    return <ErrorState message={(source.error as Error).message} onRetry={() => source.refetch()} />;
  }

  if (isSupersede && !beingCorrected) {
    return (
      <EmptyState
        title="That memo could not be found"
        body="It may have been removed, or you may not have access to it."
      />
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!subject.trim() || !body.trim()) {
      setError("Subject and body are required.");
      return;
    }

    setSubmitting(true);
    try {
      const published = await api.post<MemoPublished>(`/api/chapters/${chapterId}/memos`, {
        subject: subject.trim(),
        body: body.trim(),
        supersedesMemoId,
      });
      navigate(`/memos/${published.memoId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        // usp_Memo_Publish's own message if supersedesMemoId turned out to be stale.
        setError(err.message);
      } else if (err instanceof ApiError && err.errors) {
        setError(Object.values(err.errors).flat().join(" "));
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: "20px 20px 40px" }}>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" }}>
        {isSupersede ? "Supersede a memo" : "New memo"}
      </h1>

      {isSupersede && beingCorrected && (
        <div style={correctingCardStyle}>
          <div style={{ fontSize: 11.5, color: "var(--mute)", textTransform: "uppercase", letterSpacing: ".08em" }}>
            Replacing
          </div>
          <div className="num" style={{ fontSize: 12.5, color: "var(--brass-dk)", marginTop: 4 }}>
            {beingCorrected.memoNumber}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{beingCorrected.subject}</div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <label htmlFor="subject" style={labelStyle}>Subject</label>
        <input
          id="subject" value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="Guidelines on chapter fund handling" style={fieldStyle}
        />

        <label htmlFor="body" style={labelStyle}>Body</label>
        <textarea
          id="body" value={body} onChange={e => setBody(e.target.value)} rows={8}
          placeholder="Write the memo" style={{ ...fieldStyle, height: "auto", padding: 12, resize: "vertical" }}
        />

        <p style={{ fontSize: 12, color: "var(--info)", marginTop: 14, lineHeight: 1.6 }}>
          A memo is numbered and permanent once published — it can never be edited or
          removed. To correct it later, publish a new memo that supersedes this one.
        </p>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Publishing…" : "Publish memo"}
        </button>
      </form>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6, marginTop: 18,
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const correctingCardStyle: CSSProperties = {
  marginTop: 16, padding: 14, borderRadius: "var(--r)",
  background: "var(--paper)", border: "1px solid var(--brass)",
};

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};
