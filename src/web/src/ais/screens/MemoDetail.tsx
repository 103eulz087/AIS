import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Paged } from "@/shared/api";
import { shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canWriteComms } from "@/shared/roles";
import type { Memo, ReadReceipt } from "@/shared/types";

/**
 * There is no GET-by-id endpoint for a single memo — only
 * GET /api/chapters/{chapterId}/memos (the chapter's list). This screen fetches
 * that list and finds the row locally, which also lets it resolve the memo number
 * of whichever memo THIS one supersedes (supersedesMemoId is only an id on the
 * DTO; its number is looked up from the same list).
 *
 * Marks itself read once, on mount, via POST /api/documents/Memo/{id}/read —
 * fire-and-forget, but a real failure shows a small non-blocking note.
 */
export function MemoDetail({ chapterId }: { chapterId: number }) {
  const { memoId: idParam } = useParams<{ memoId: string }>();
  const memoId = Number(idParam);

  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const isOfficer = canWriteComms(roles);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["memos-source", chapterId],
    queryFn: () => api.get<Paged<Memo>>(`/api/chapters/${chapterId}/memos?take=500`),
    enabled: Number.isFinite(memoId),
  });

  const memo = data?.items.find(m => m.memoId === memoId) ?? null;
  const supersedes = memo?.supersedesMemoId != null
    ? data?.items.find(m => m.memoId === memo.supersedesMemoId) ?? null
    : null;

  const [readNotice, setReadNotice] = useState<string | null>(null);
  const markedRef = useRef(false);
  useEffect(() => {
    if (!Number.isFinite(memoId) || markedRef.current) return;
    markedRef.current = true;
    api.post(`/api/documents/Memo/${memoId}/read`).catch(() => {
      setReadNotice("Could not record that you've opened this. It's only used for the read count officers see.");
    });
  }, [memoId]);

  const receipts = useQuery({
    queryKey: ["memo-read-receipts", memoId],
    queryFn: () => api.get<ReadReceipt[]>(`/api/documents/Memo/${memoId}/read-receipts`),
    enabled: isOfficer && Number.isFinite(memoId),
  });

  if (!Number.isFinite(memoId)) {
    return <EmptyState title="This memo could not be found" body="Check the link and try again." />;
  }

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (!memo) {
    return (
      <EmptyState
        title="This memo could not be found"
        body="It may have been removed, or you may not have access to it."
      />
    );
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: 16 }}>
        <div className="num" style={{ fontSize: 12.5, color: "var(--brass-dk)", letterSpacing: ".08em" }}>
          {memo.memoNumber}
        </div>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 22, lineHeight: 1.2, marginTop: 6 }}>
          {memo.subject}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 8 }}>
          {shortDate(memo.publishDateUtc)}
        </div>

        {memo.isSuperseded && (
          <div style={bannerStyle}>
            Superseded by{" "}
            {memo.supersededByMemoId != null ? (
              <Link to={`/memos/${memo.supersededByMemoId}`} style={bannerLinkStyle}>
                {memo.supersededByMemoNumber ?? "a later memo"}
              </Link>
            ) : (memo.supersededByMemoNumber ?? "a later memo")}
          </div>
        )}

        {memo.supersedesMemoId != null && (
          <div style={bannerStyle}>
            This supersedes{" "}
            <Link to={`/memos/${memo.supersedesMemoId}`} style={bannerLinkStyle}>
              {supersedes?.memoNumber ?? "an earlier memo"}
            </Link>
          </div>
        )}

        <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--slate)", marginTop: 14, whiteSpace: "pre-wrap" }}>
          {memo.body}
        </div>

        {readNotice && <p style={noticeStyle}>{readNotice}</p>}
      </div>

      {isOfficer && (
        <div style={{ padding: "0 16px 16px" }}>
          <Link to={`/memos/${memoId}/supersede`} style={ghostButtonStyle}>Supersede this memo</Link>
        </div>
      )}

      {isOfficer && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={sectionLabelStyle}>Who's read this</div>
          {receipts.isLoading && <ScreenSkeleton rows={2} />}
          {receipts.error && (
            <ErrorState message={(receipts.error as Error).message} onRetry={() => receipts.refetch()} />
          )}
          {receipts.data && receipts.data.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--mute)" }}>Nobody has opened this yet.</p>
          )}
          {receipts.data && receipts.data.length > 0 && (
            <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "var(--r)" }}>
              {receipts.data.map(r => (
                <div key={r.memberId} style={receiptRowStyle}>
                  <span style={{ fontSize: 13.5 }}>{r.giftName}</span>
                  <span style={{ fontSize: 11.5, color: "var(--mute)" }}>
                    {shortDate(r.readDateUtc)} · {shortTime(r.readDateUtc)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const bannerStyle: CSSProperties = {
  marginTop: 12, padding: 12, borderRadius: "var(--r)", fontSize: 13, lineHeight: 1.6,
  color: "var(--slate)", background: "var(--bond)", border: "1px solid var(--line)",
};

const bannerLinkStyle: CSSProperties = { color: "var(--info)", textDecoration: "underline" };

const noticeStyle: CSSProperties = { fontSize: 11.5, color: "var(--mute)", marginTop: 14, lineHeight: 1.5 };

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "0 0 8px",
};

const receiptRowStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "10px 12px", borderBottom: "1px solid var(--line)",
};

const ghostButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--slate)", textDecoration: "none",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase",
  display: "inline-flex", alignItems: "center",
};
