import { useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canWriteDonations } from "@/shared/roles";
import { EmptyState } from "@/shared/states";
import { DONOR_TYPES, type ActivityListItem } from "@/shared/types";

interface DonationCreated { donationId: number; ledgerEntryId: number | null }

/**
 * POST /api/chapters/{chapterId}/donations. Officer route (canWriteDonations —
 * ChapterTreasurer or ChapterAdmin); a plain member sees the plain "you don't have
 * access" state, same pattern as ExpenseNew/MeetingNew.
 *
 * A donation must carry a cash amount, an in-kind description, or both — never
 * neither. The form mirrors the server's own rule (usp_Donation_Create /
 * CK_Donation_CashOrKind) rather than letting the member hit its 400.
 *
 * "Chapter receipt no." is this chapter's own receipt-book number — deliberately
 * never called an "AR number" anywhere in this screen; that term names a different
 * document elsewhere in the system.
 */
export function DonationNew({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetActivityId = searchParams.get("activityId") ?? "";

  const activities = useQuery({
    queryKey: ["activities-for-new-donation", chapterId],
    queryFn: () => api.get<Paged<ActivityListItem>>(`/api/chapters/${chapterId}/activities?take=500`),
  });

  const [donorName, setDonorName] = useState("");
  const [donorTypeId, setDonorTypeId] = useState("");
  const [amount, setAmount] = useState("");
  const [inKindDescription, setInKindDescription] = useState("");
  const [chapterReceiptNo, setChapterReceiptNo] = useState("");
  const [activityId, setActivityId] = useState(presetActivityId);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWriteDonations(roles)) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only the chapter treasurer or admin can record a donation."
      />
    );
  }

  const hasCash = amount.trim() !== "" && Number(amount) > 0;
  const hasInKind = inKindDescription.trim() !== "";
  const canSubmit = hasCash || hasInKind;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!donorName.trim()) {
      setError("The donor's name is required.");
      return;
    }
    if (!canSubmit) {
      setError("Record a cash amount, an in-kind description, or both.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.post<DonationCreated>(`/api/chapters/${chapterId}/donations`, {
        donorName: donorName.trim(),
        donorTypeId: donorTypeId ? Number(donorTypeId) : null,
        amount: hasCash ? Number(amount) : null,
        inKindDescription: hasInKind ? inKindDescription.trim() : null,
        chapterReceiptNo: chapterReceiptNo.trim() || null,
        activityId: activityId ? Number(activityId) : null,
        notes: notes.trim() || null,
      });
      navigate(`/donations/${created.donationId}`, { replace: true });
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
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" }}>New donation</h1>

      <form onSubmit={handleSubmit}>
        <label htmlFor="donorName" style={labelStyle}>Donor's name</label>
        <input
          id="donorName" value={donorName} onChange={e => setDonorName(e.target.value)}
          placeholder="Mayor Juan Dela Cruz" style={fieldStyle}
        />

        <label htmlFor="donorType" style={labelStyle}>Donor type (optional)</label>
        <select id="donorType" value={donorTypeId} onChange={e => setDonorTypeId(e.target.value)} style={fieldStyle}>
          <option value="">Not specified</option>
          {DONOR_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <div style={panelStyle}>
          <p style={{ fontSize: 12.5, color: "var(--slate)", lineHeight: 1.6, marginBottom: 12 }}>
            A donation can be cash, in-kind (goods), or both. Fill in at least one.
          </p>

          <label htmlFor="amount" style={labelStyle}>Cash amount (optional)</label>
          <input
            id="amount" className="num" inputMode="decimal" value={amount}
            onChange={e => setAmount(e.target.value)} placeholder="0.00" style={fieldStyle}
          />

          <label htmlFor="inKindDescription" style={labelStyle}>In-kind description (optional)</label>
          <textarea
            id="inKindDescription" value={inKindDescription} onChange={e => setInKindDescription(e.target.value)}
            rows={2} placeholder="20 sacks of rice" style={{ ...fieldStyle, height: "auto", padding: 12, resize: "vertical" }}
          />
        </div>

        <label htmlFor="chapterReceiptNo" style={labelStyle}>Chapter receipt no. (optional)</label>
        <input
          id="chapterReceiptNo" value={chapterReceiptNo} onChange={e => setChapterReceiptNo(e.target.value)}
          placeholder="CR-0042" style={fieldStyle}
        />
        <p style={hintStyle}>The number from this chapter's own receipt book, if one was issued.</p>

        <label htmlFor="activity" style={labelStyle}>Activity (optional)</label>
        <select id="activity" value={activityId} onChange={e => setActivityId(e.target.value)} style={fieldStyle}>
          <option value="">Not tied to an activity</option>
          {(activities.data?.items ?? []).map(a => (
            <option key={a.activityId} value={a.activityId}>{a.activityName}</option>
          ))}
        </select>

        <label htmlFor="notes" style={labelStyle}>Notes (optional)</label>
        <textarea
          id="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          style={{ ...fieldStyle, height: "auto", padding: 12, resize: "vertical" }}
        />

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Saving…" : "Save donation"}
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

const panelStyle: CSSProperties = {
  marginTop: 18, padding: 14, borderRadius: "var(--r)",
  background: "var(--paper)", border: "1px solid var(--line)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6, lineHeight: 1.5 };

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};
