import { useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canWriteActivities } from "@/shared/roles";
import { EmptyState } from "@/shared/states";

interface ActivityCreated { activityId: number }

/**
 * POST /api/chapters/{chapterId}/activities.
 * Officer-only route (ChapterOfficer or ChapterAdmin): a plain member landing here
 * (a stale link, a bookmark) sees a plain "you don't have access" state, same
 * pattern as MeetingNew/AnnouncementNew.
 */
export function ActivityNew({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [activityDate, setActivityDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWriteActivities(roles)) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only a chapter officer can start a new activity. Ask your Secretary, President or Treasurer."
      />
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Give the activity a name.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.post<ActivityCreated>(`/api/chapters/${chapterId}/activities`, {
        name: name.trim(),
        description: description.trim() || null,
        activityDate: activityDate || null,
      });
      navigate(`/expenses?activityId=${created.activityId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only a chapter officer can start a new activity.");
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
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" }}>New activity</h1>

      <form onSubmit={handleSubmit}>
        <label htmlFor="name" style={labelStyle}>Activity name</label>
        <input
          id="name" value={name} onChange={e => setName(e.target.value)}
          placeholder="Barangay Coastal Clean-Up Drive" style={fieldStyle}
        />

        <label htmlFor="activityDate" style={labelStyle}>Date (optional)</label>
        <input
          id="activityDate" type="date" value={activityDate}
          onChange={e => setActivityDate(e.target.value)} style={fieldStyle}
        />

        <label htmlFor="description" style={labelStyle}>Description (optional)</label>
        <textarea
          id="description" value={description} onChange={e => setDescription(e.target.value)} rows={5}
          placeholder="What this activity is for" style={{ ...fieldStyle, height: "auto", padding: 12, resize: "vertical" }}
        />

        <p style={{ fontSize: 12, color: "var(--info)", marginTop: 14, lineHeight: 1.6 }}>
          Donations and expenses are recorded separately, against this activity, once it
          exists. Saving here creates the activity the whole chapter can already see.
        </p>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Saving…" : "Save activity"}
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

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};
