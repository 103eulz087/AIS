import { useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canWriteDiscipline } from "@/shared/roles";
import { EmptyState } from "@/shared/states";
import type { CorrectiveActionCategoryOption, DirectoryRow } from "@/shared/types";
import { isSameChapter } from "@/shared/types";

interface FiledCase { caseId: number }

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * POST /api/chapters/{chapterId}/corrective-actions — ChapterAdmin only
 * (canWriteDiscipline). Filing defaults the new case's status to "Pending" by omitting
 * initialStatusName, the normal case; there is no status picker here on purpose, to
 * keep filing a single, deliberate act.
 *
 * The subject picker reuses GET /api/members (the same call MemberDirectory already
 * makes) rather than a new autocomplete component — with no chapterId in the query it
 * returns this chapter's own members only (usp_Member_Search's own default), so this
 * list is already correctly scoped.
 *
 * There is no PUT/PATCH on a filed case anywhere in this feature — once filed, a
 * narrative cannot be edited through any endpoint that exists or ever will
 * (CLAUDE.md invariant #2). Submitting navigates straight to the new case's detail page.
 */
export function CaseNew({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const navigate = useNavigate();

  const members = useQuery({
    queryKey: ["members-for-new-case", chapterId],
    queryFn: () => api.get<Paged<DirectoryRow>>("/api/members?take=500"),
  });

  const [subjectMemberId, setSubjectMemberId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [dateFiled, setDateFiled] = useState(today());
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GET /api/corrective-action-categories — a bare array response (not the
  // {items,total,...} Paged<T> shape most GETs in this app use), same guard as
  // AnnouncementNew's blood-types call: fall back to an empty list rather than throw
  // on a malformed or unexpected body.
  const categories = useQuery({
    queryKey: ["corrective-action-categories"],
    queryFn: () => api.get<CorrectiveActionCategoryOption[]>("/api/corrective-action-categories"),
    staleTime: 5 * 60_000,
  });
  const categoryOptions = Array.isArray(categories.data) ? categories.data : [];

  if (!canWriteDiscipline(roles)) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only the chapter admin can file a corrective action."
      />
    );
  }

  const subjects = (members.data?.items ?? []).filter(isSameChapter);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!subjectMemberId || !categoryId || !dateFiled || !content.trim()) {
      setError("A member, a category, a date and a narrative are all required.");
      return;
    }

    setSubmitting(true);
    try {
      const filed = await api.post<FiledCase>(`/api/chapters/${chapterId}/corrective-actions`, {
        subjectMemberId: Number(subjectMemberId),
        categoryId: Number(categoryId),
        dateFiled,
        content: content.trim(),
      });
      navigate(`/corrective-actions/${filed.caseId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 403)) {
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
        File a corrective action
      </h1>
      <p style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
        This cannot be undone. A corrective action is never deleted — a status change or a
        correction is added to its timeline instead, and stays visible beside the original.
      </p>

      <form onSubmit={e => { void handleSubmit(e); }}>
        <label htmlFor="subjectMemberId" style={labelStyle}>Brother concerned</label>
        <select
          id="subjectMemberId" value={subjectMemberId}
          onChange={e => setSubjectMemberId(e.target.value)} style={fieldStyle}
        >
          <option value="">Choose a member</option>
          {subjects.map(m => (
            <option key={m.memberId} value={m.memberId}>{m.giftName} — {m.memberNumber}</option>
          ))}
        </select>

        <label htmlFor="categoryId" style={labelStyle}>Category</label>
        <select id="categoryId" value={categoryId} onChange={e => setCategoryId(e.target.value)} style={fieldStyle}>
          <option value="">Choose a category</option>
          {categoryOptions.map(c => (
            <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>
          ))}
        </select>
        <p style={hintStyle}>The category and the status are what the whole chapter sees. Choose it carefully.</p>

        <label htmlFor="dateFiled" style={labelStyle}>Date filed</label>
        <input
          id="dateFiled" type="date" value={dateFiled}
          onChange={e => setDateFiled(e.target.value)} style={fieldStyle}
        />

        <label htmlFor="content" style={labelStyle}>What happened</label>
        <textarea
          id="content" value={content} onChange={e => setContent(e.target.value)} rows={7}
          placeholder="State the facts, the dates, and what has already been done."
          style={{ ...fieldStyle, height: "auto", padding: 12, resize: "vertical" }}
        />
        <p style={hintStyle}>Visible to officers and to the brother concerned only.</p>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Filing…" : "File case"}
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

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6, lineHeight: 1.5 };

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};
