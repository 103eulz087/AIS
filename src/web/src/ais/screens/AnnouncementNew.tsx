import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Paged } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canWriteComms } from "@/shared/roles";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { URGENT_TYPES, type Announcement, type BloodTypeOption } from "@/shared/types";

interface AnnouncementCreated { announcementId: number }

const BLOOD_REQUEST_ID = URGENT_TYPES.find(t => t.name === "BloodRequest")!.id;

/**
 * POST /api/chapters/{chapterId}/announcements when the URL carries no
 * :announcementId (route "/announcements/new"), or
 * PUT /api/chapters/{chapterId}/announcements/{announcementId} when it does
 * (route "/announcements/:announcementId/edit") — one form, two modes, so the
 * fields never drift apart between create and correction.
 *
 * There is no GET-by-id endpoint for a single announcement (only the chapter's
 * list). Edit mode fetches that list (including withdrawn, so a stale link to an
 * edit form for a since-withdrawn post still resolves to a clear message rather
 * than a blank screen) and finds the row locally to pre-fill the form.
 *
 * Officer-only route: a plain member landing here sees a plain "you don't have
 * access" state, same pattern as MeetingNew.
 */
export function AnnouncementNew({ chapterId }: { chapterId: number }) {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const isOfficer = canWriteComms(roles);
  const navigate = useNavigate();

  const { announcementId: idParam } = useParams<{ announcementId?: string }>();
  const isEdit = idParam !== undefined;
  const announcementId = isEdit ? Number(idParam) : null;

  const source = useQuery({
    queryKey: ["announcements-source-for-edit", chapterId],
    queryFn: () => api.get<Paged<Announcement>>(
      `/api/chapters/${chapterId}/announcements?take=500&includeWithdrawn=true`),
    enabled: isEdit && isOfficer && Number.isFinite(announcementId),
  });

  const existing = isEdit
    ? source.data?.items.find(a => a.announcementId === announcementId) ?? null
    : null;

  // GET /api/blood-types — see shared/types.ts's BloodTypeOption. Guarded with
  // Array.isArray rather than trusting the generic type param: this is a bare array
  // response (not the {items,total,...} Paged<T> shape most GETs in this app use), so
  // a malformed or unexpected body must fall back to an empty list, never throw.
  const bloodTypes = useQuery({
    queryKey: ["blood-types"],
    queryFn: () => api.get<BloodTypeOption[]>("/api/blood-types"),
    staleTime: 5 * 60_000,
  });
  const bloodTypeOptions = Array.isArray(bloodTypes.data) ? bloodTypes.data : [];

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [urgentTypeId, setUrgentTypeId] = useState<number>(BLOOD_REQUEST_ID);
  const [bloodTypeId, setBloodTypeId] = useState<number | "">("");
  const [expiryDate, setExpiryDate] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing && !prefilled) {
      setTitle(existing.title);
      setBody(existing.body);
      setIsUrgent(existing.isUrgent);
      if (existing.urgentTypeId != null) setUrgentTypeId(existing.urgentTypeId);
      setBloodTypeId(existing.bloodTypeId ?? "");
      setExpiryDate(existing.expiryDate ?? "");
      setPrefilled(true);
    }
  }, [existing, prefilled]);

  if (!isOfficer) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only a chapter officer can post or edit an announcement. Ask your Secretary or President."
      />
    );
  }

  if (isEdit && !Number.isFinite(announcementId)) {
    return <EmptyState title="This announcement could not be found" body="Check the link and try again." />;
  }

  if (isEdit && source.isLoading) return <ScreenSkeleton rows={6} />;

  if (isEdit && source.error) {
    return <ErrorState message={(source.error as Error).message} onRetry={() => source.refetch()} />;
  }

  if (isEdit && !existing) {
    return (
      <EmptyState
        title="This announcement could not be found"
        body="It may have been removed, or you may not have access to it."
      />
    );
  }

  if (isEdit && existing?.isWithdrawn) {
    return (
      <EmptyState
        title="This announcement has been withdrawn"
        body="A withdrawn announcement can no longer be edited."
      />
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !body.trim()) {
      setError("Title and body are required.");
      return;
    }

    const payload = {
      title: title.trim(),
      body: body.trim(),
      isUrgent,
      urgentTypeId: isUrgent ? urgentTypeId : null,
      bloodTypeId: isUrgent && urgentTypeId === BLOOD_REQUEST_ID && bloodTypeId !== "" ? bloodTypeId : null,
      expiryDate: expiryDate || null,
    };

    setSubmitting(true);
    try {
      if (isEdit && announcementId != null) {
        await api.put(`/api/chapters/${chapterId}/announcements/${announcementId}`, payload);
        navigate(`/announcements/${announcementId}`, { replace: true });
      } else {
        const created = await api.post<AnnouncementCreated>(
          `/api/chapters/${chapterId}/announcements`, payload);
        navigate(`/announcements/${created.announcementId}`, { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 409)) {
        // The server's own message — e.g. "already withdrawn" on a stale edit form.
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
        {isEdit ? "Edit announcement" : "New announcement"}
      </h1>

      <form onSubmit={handleSubmit}>
        <label htmlFor="title" style={labelStyle}>Title</label>
        <input
          id="title" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="General assembly next Sunday" style={fieldStyle}
        />

        <label htmlFor="body" style={labelStyle}>Body</label>
        <textarea
          id="body" value={body} onChange={e => setBody(e.target.value)} rows={6}
          placeholder="Write the announcement" style={{ ...fieldStyle, height: "auto", padding: 12, resize: "vertical" }}
        />

        <label style={toggleRowStyle}>
          <input type="checkbox" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} />
          <span>This is urgent</span>
        </label>

        {isUrgent && (
          <div style={urgentPanelStyle}>
            <label htmlFor="urgentType" style={labelStyle}>Type</label>
            <select
              id="urgentType" value={urgentTypeId}
              onChange={e => setUrgentTypeId(Number(e.target.value))}
              style={fieldStyle}
            >
              {URGENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>

            {urgentTypeId === BLOOD_REQUEST_ID && (
              <>
                <label htmlFor="bloodType" style={labelStyle}>Blood type needed</label>
                <select
                  id="bloodType" value={bloodTypeId}
                  onChange={e => setBloodTypeId(e.target.value === "" ? "" : Number(e.target.value))}
                  style={fieldStyle}
                >
                  <option value="">Any / not specified</option>
                  {bloodTypeOptions.map(b => (
                    <option key={b.bloodTypeId} value={b.bloodTypeId}>{b.bloodTypeName}</option>
                  ))}
                </select>
              </>
            )}

            <p style={hintStyle}>
              {urgentTypeId === BLOOD_REQUEST_ID
                ? "A blood request reads first in the feed, before the general announcements."
                : "An assistance request reads first in the feed, before the general announcements."}
            </p>
          </div>
        )}

        <label htmlFor="expiryDate" style={labelStyle}>Expires (optional)</label>
        <input
          id="expiryDate" type="date" value={expiryDate}
          onChange={e => setExpiryDate(e.target.value)} style={fieldStyle}
        />

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Post announcement"}
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

const toggleRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, marginTop: 18, minHeight: "var(--tap)", fontSize: 14,
};

const urgentPanelStyle: CSSProperties = {
  marginTop: 4, padding: 14, borderRadius: "var(--r)",
  background: "var(--paper)", border: "1px solid var(--line)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 8, lineHeight: 1.6 };

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};
