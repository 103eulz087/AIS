import { useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canWriteMeetings } from "@/shared/roles";
import { EmptyState } from "@/shared/states";

interface MeetingCreated { meetingId: number }

/**
 * POST /api/chapters/{chapterId}/meetings.
 * Officer-only route: a plain member landing here (a stale link, a bookmark) sees a
 * plain "you don't have access" state rather than a raw 403 or a half-working form.
 */
export function MeetingNew({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const navigate = useNavigate();

  const [subject, setSubject] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [location, setLocation] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWriteMeetings(roles)) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only a chapter officer can create a meeting. Ask your Secretary or President to set one up."
      />
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!subject.trim() || !meetingDate) {
      setError("Subject and meeting date are required.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.post<MeetingCreated>(`/api/chapters/${chapterId}/meetings`, {
        subject: subject.trim(),
        meetingDate,
        location: location.trim() || null,
        body: body.trim() || null,
      });
      navigate(`/meetings/${created.meetingId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only a chapter officer can create a meeting.");
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
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" }}>New meeting</h1>

      <form onSubmit={handleSubmit}>
        <label htmlFor="subject" style={labelStyle}>Subject / agenda title</label>
        <input
          id="subject" value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="Regular Chapter Meeting — September" style={fieldStyle}
        />

        <label htmlFor="meetingDate" style={labelStyle}>Meeting date</label>
        <input
          id="meetingDate" type="date" value={meetingDate}
          onChange={e => setMeetingDate(e.target.value)} style={fieldStyle}
        />

        <label htmlFor="location" style={labelStyle}>Venue</label>
        <input
          id="location" value={location} onChange={e => setLocation(e.target.value)}
          placeholder="Barangay Hall, San Isidro" style={fieldStyle}
        />

        <label htmlFor="body" style={labelStyle}>Agenda / notes</label>
        <textarea
          id="body" value={body} onChange={e => setBody(e.target.value)} rows={6}
          placeholder="1. Reading of previous minutes&#10;2. Treasurer's report&#10;3. ..."
          style={{ ...fieldStyle, height: "auto", padding: 12, resize: "vertical" }}
        />

        <p style={{ fontSize: 12, color: "var(--info)", marginTop: 14, lineHeight: 1.6 }}>
          Attendance and contributions are recorded separately, after the meeting. Saving here
          creates a draft the whole chapter can already see.
        </p>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Saving…" : "Save meeting"}
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
