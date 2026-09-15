import { useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canWriteExpenses } from "@/shared/roles";
import { EmptyState } from "@/shared/states";
import { EXPENSE_CATEGORIES, type ActivityListItem } from "@/shared/types";

interface ExpenseCreated { expenseId: number; ledgerEntryId: number }
interface AttachmentStaged { attachmentStagingId: number }

type UploadStatus = "uploading" | "staged" | "error";

interface PendingAttachment {
  localId: string;
  file: File;
  status: UploadStatus;
  attachmentStagingId?: number;
  error?: string;
}

// Mirrors AttachmentsEndpoints.AllowedContentTypes / MaxFileSizeBytes — matched here so
// the picker itself steers a member away from a file the server will reject, rather
// than letting every rejection round-trip through the network first.
const ACCEPT = "image/jpeg,image/png,image/heic,application/pdf";
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

function newLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * POST /api/chapters/{chapterId}/expenses, with receipts staged first via one
 * POST /api/attachments call per file (field name "file"). Officer route, narrower
 * than most: ChapterTreasurer or ChapterAdmin (canWriteExpenses) — a plain member,
 * or even a Secretary/President with no money role, sees the plain "you don't have
 * access" state, same pattern as MeetingNew.
 *
 * Each picked file uploads as soon as it's chosen and is tracked independently, so
 * one rejected file (too large, wrong type) shows its own inline error and can be
 * removed or retried without blocking the others. The submit button mirrors the
 * server's own "at least one receipt" rule — it stays disabled until at least one
 * file has finished staging, rather than letting the member hit that 400 himself.
 */
export function ExpenseNew({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetActivityId = searchParams.get("activityId") ?? "";

  const activities = useQuery({
    queryKey: ["activities-for-new-expense", chapterId],
    queryFn: () => api.get<Paged<ActivityListItem>>(`/api/chapters/${chapterId}/activities?take=500`),
  });

  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [activityId, setActivityId] = useState(presetActivityId);
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!canWriteExpenses(roles)) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only the chapter treasurer or admin can record an expense."
      />
    );
  }

  const hasStagedAttachment = attachments.some(a => a.status === "staged");

  async function uploadOne(localId: string, file: File) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setAttachments(list => list.map(a => a.localId === localId
        ? { ...a, status: "error", error: "That file is too large. Photos and PDFs up to 8 MB are accepted." }
        : a));
      return;
    }

    const form = new FormData();
    form.append("file", file);
    try {
      const staged = await api.upload<AttachmentStaged>("/api/attachments", form);
      setAttachments(list => list.map(a => a.localId === localId
        ? { ...a, status: "staged", attachmentStagingId: staged.attachmentStagingId }
        : a));
    } catch (err) {
      setAttachments(list => list.map(a => a.localId === localId
        ? { ...a, status: "error", error: err instanceof ApiError ? err.message : "Could not upload that file." }
        : a));
    }
  }

  function handleFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // lets the same file be re-picked after a retry-by-remove-and-reselect
    const entries: PendingAttachment[] = files.map(file => ({ localId: newLocalId(), file, status: "uploading" }));
    setAttachments(list => [...list, ...entries]);
    for (const entry of entries) { void uploadOne(entry.localId, entry.file); }
  }

  function removeAttachment(localId: string) {
    setAttachments(list => list.filter(a => a.localId !== localId));
  }

  function retryAttachment(localId: string) {
    const entry = attachments.find(a => a.localId === localId);
    if (!entry) return;
    setAttachments(list => list.map(a => a.localId === localId ? { ...a, status: "uploading", error: undefined } : a));
    void uploadOne(localId, entry.file);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!payee.trim() || !amount.trim() || !expenseDate) {
      setError("Payee, amount and date are required.");
      return;
    }
    if (!hasStagedAttachment) {
      setError("At least one receipt is required to record an expense.");
      return;
    }

    const attachmentStagingIds = attachments
      .filter((a): a is PendingAttachment & { attachmentStagingId: number } => a.status === "staged")
      .map(a => a.attachmentStagingId);

    setSubmitting(true);
    try {
      const created = await api.post<ExpenseCreated>(`/api/chapters/${chapterId}/expenses`, {
        payee: payee.trim(),
        amount: Number(amount),
        expenseDate,
        categoryId: categoryId ? Number(categoryId) : null,
        activityId: activityId ? Number(activityId) : null,
        description: description.trim() || null,
        attachmentStagingIds,
      });
      navigate(`/expenses/${created.expenseId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 403)) {
        // Surfaces the server's own message verbatim — e.g. an attachment consumed by
        // another expense in the meantime, or a role check.
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
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" }}>New expense</h1>

      <form onSubmit={handleSubmit}>
        <label htmlFor="payee" style={labelStyle}>Paid to</label>
        <input
          id="payee" value={payee} onChange={e => setPayee(e.target.value)}
          placeholder="ABC Hardware" style={fieldStyle}
        />

        <label htmlFor="amount" style={labelStyle}>Amount</label>
        <input
          id="amount" className="num" inputMode="decimal" value={amount}
          onChange={e => setAmount(e.target.value)} placeholder="0.00" style={fieldStyle}
        />

        <label htmlFor="expenseDate" style={labelStyle}>Date</label>
        <input
          id="expenseDate" type="date" value={expenseDate}
          onChange={e => setExpenseDate(e.target.value)} style={fieldStyle}
        />

        <label htmlFor="category" style={labelStyle}>Category (optional)</label>
        <select id="category" value={categoryId} onChange={e => setCategoryId(e.target.value)} style={fieldStyle}>
          <option value="">Not categorized</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <label htmlFor="activity" style={labelStyle}>Activity (optional)</label>
        <select id="activity" value={activityId} onChange={e => setActivityId(e.target.value)} style={fieldStyle}>
          <option value="">Not tied to an activity</option>
          {(activities.data?.items ?? []).map(a => (
            <option key={a.activityId} value={a.activityId}>{a.activityName}</option>
          ))}
        </select>

        <label htmlFor="description" style={labelStyle}>Description (optional)</label>
        <textarea
          id="description" value={description} onChange={e => setDescription(e.target.value)} rows={3}
          placeholder="Gloves and trash bags" style={{ ...fieldStyle, height: "auto", padding: 12, resize: "vertical" }}
        />

        <label style={labelStyle}>Receipt (at least one required)</label>
        <button type="button" onClick={() => fileInputRef.current?.click()} style={pickButtonStyle}>
          + Add a photo or PDF
        </button>
        <input
          ref={fileInputRef} type="file" accept={ACCEPT} multiple
          onChange={handleFilesPicked} style={{ display: "none" }}
        />

        {attachments.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {attachments.map(a => (
              <div key={a.localId} style={attachmentRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.file.name}
                  </div>
                  {a.status === "error" && <div style={attachmentErrorStyle}>{a.error}</div>}
                </div>
                <span style={{ flex: "none", fontSize: 12 }}>
                  {a.status === "uploading" && <span style={{ color: "var(--mute)" }}>Uploading…</span>}
                  {a.status === "staged" && <span style={{ color: "var(--in)" }}>✓ Staged</span>}
                  {a.status === "error" && (
                    <button type="button" onClick={() => retryAttachment(a.localId)} style={retryLinkStyle}>
                      Retry
                    </button>
                  )}
                </span>
                <button
                  type="button" aria-label={`Remove ${a.file.name}`}
                  onClick={() => removeAttachment(a.localId)} style={removeLinkStyle}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {!hasStagedAttachment && (
          <p style={hintStyle}>The server requires at least one receipt to record an expense.</p>
        )}

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button
          type="submit" disabled={submitting || !hasStagedAttachment}
          style={{ ...buttonStyle, opacity: submitting || !hasStagedAttachment ? 0.6 : 1 }}
        >
          {submitting ? "Saving…" : "Save expense"}
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

const pickButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", width: "100%", borderRadius: 8, border: "1px dashed var(--line)",
  background: "var(--paper)", color: "var(--info)", fontSize: 14, fontWeight: 500,
};

const attachmentRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
  borderBottom: "1px solid var(--line)",
};

const attachmentErrorStyle: CSSProperties = { fontSize: 11.5, color: "var(--out)", marginTop: 2, lineHeight: 1.4 };

const retryLinkStyle: CSSProperties = {
  color: "var(--info)", textDecoration: "underline", fontSize: 12, minHeight: "auto",
};

const removeLinkStyle: CSSProperties = {
  flex: "none", color: "var(--mute)", fontSize: 14, minHeight: 32, minWidth: 32,
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 8, lineHeight: 1.6 };

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};
