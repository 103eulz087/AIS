import { useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import type { ChapterInviteLinkResolved } from "@/shared/types";
import {
  ApplicationFormFields, EMPTY_APPLICATION_FORM, validateApplicationForm,
  type ApplicationFormValues,
} from "./ApplicationFormFields";

interface SubmitResponse { referenceNo: string }

/**
 * The public "join this chapter" landing page reached from a chapter's own join
 * link/QR code (GET /api/chapters/invite/{token}) — the chapter is already fixed by
 * the token, so this form skips straight to "about you." This is now the ONLY way to
 * apply (the generic Region -> Province -> City -> Chapter picker that used to live at
 * /apply was removed deliberately — every applicant comes through a chapter's own
 * invite link, matching the org's seconder-based joining model).
 *
 * An invalid, regenerated, or inactive-chapter token all read as isValid=false, reading
 * identically on purpose (anti-enumeration — same posture as VerifyCard.tsx's own
 * unknown-token case): this page never distinguishes "wrong token" from "old token" from
 * "chapter no longer active."
 *
 * POST /api/membership-applications is the same endpoint the old /apply picker used to
 * submit to, with chapterId supplied from the resolved token rather than a picker.
 */
export function JoinChapter() {
  const { token } = useParams<{ token: string }>();

  const resolveQuery = useQuery({
    queryKey: ["chapter-invite-resolve", token],
    queryFn: () => api.get<ChapterInviteLinkResolved>(`/api/chapters/invite/${token}`),
    enabled: !!token,
    retry: false,
  });

  const [mobileNo, setMobileNo] = useState("");
  const [form, setForm] = useState<ApplicationFormValues>(EMPTY_APPLICATION_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceNo, setReferenceNo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!resolveQuery.data?.chapterId) { setError("This join link isn't valid."); return; }
    if (!mobileNo.trim()) { setError("A mobile number is required."); return; }
    const formError = validateApplicationForm(form);
    if (formError) { setError(formError); return; }

    setSubmitting(true);
    try {
      const res = await api.post<SubmitResponse>("/api/membership-applications", {
        chapterId: resolveQuery.data.chapterId,
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        lastName: form.lastName.trim(),
        giftName: form.giftName.trim(),
        birthDate: form.birthDate,
        mobileNo: mobileNo.trim(),
        email: form.email.trim() || null,
        dateSurvive: form.dateSurvive || null,
        presidentDuringSurvive: form.presidentDuringSurvive.trim() || null,
        masterInitiatorDuringSurvive: form.masterInitiatorDuringSurvive.trim() || null,
        seconderNameGiven: form.seconderNameGiven.trim(),
        seconderMemberNumberGiven: form.seconderMemberNumberGiven.trim() || null,
      });
      setReferenceNo(res.referenceNo);
    } catch (err) {
      if (err instanceof ApiError && err.errors) {
        setError(Object.values(err.errors).flat().join(" "));
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  if (resolveQuery.isLoading) return <ScreenSkeleton rows={6} />;
  if (resolveQuery.error) {
    return <ErrorState message={(resolveQuery.error as Error).message} onRetry={() => resolveQuery.refetch()} />;
  }
  if (!resolveQuery.data?.isValid) {
    return (
      <EmptyState
        title="This join link isn't valid"
        body="It may have been replaced with a newer one. Ask your chapter for their current join link."
      />
    );
  }

  if (referenceNo) {
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Application submitted</h1>
        <p style={bodyTextStyle}>
          Save this reference number together with your mobile number — you will need both to check
          your application's status.
        </p>

        <div style={referenceCardStyle}>
          <div className="num" style={referenceTextStyle}>{referenceNo}</div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(referenceNo)
                .then(() => setCopied(true))
                .catch(() => { /* clipboard permission denied — the number is still on screen */ });
            }}
            style={copyButtonStyle}
          >
            {copied ? "Copied" : "Copy reference number"}
          </button>
        </div>

        <p style={{ ...bodyTextStyle, marginTop: 18 }}>
          Nobody will text or email you about this. Your chapter's officers will reach you directly
          once a decision is made.
        </p>

        <Link to="/apply/status" style={primaryLinkStyle}>Check application status</Link>
        <Link to="/sign-in" style={ghostLinkStyle}>Back to sign in</Link>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Join {resolveQuery.data.chapterName}</h1>
      <p style={{ ...bodyTextStyle, marginTop: 8 }}>
        You're applying directly to this chapter. Its officers will review this. There is no fee to apply.
      </p>

      <form onSubmit={e => { void handleSubmit(e); }} style={{ marginTop: 20 }}>
        <div style={sectionLabelStyle}>About you</div>

        <ApplicationFormFields values={form} onChange={(field, value) => setForm(f => ({ ...f, [field]: value }))} />

        <label htmlFor="mobileNo" style={labelStyle}>Mobile number</label>
        <input
          id="mobileNo" value={mobileNo} onChange={e => setMobileNo(e.target.value)}
          inputMode="tel" placeholder="09XXXXXXXXX" style={fieldStyle}
        />
        <p style={hintStyle}>This is how your chapter reaches you once you're approved.</p>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? "Submitting…" : "Submit application"}
        </button>

        <p style={{ marginTop: 20, fontSize: 12.5, color: "var(--mute)", textAlign: "center" }}>
          Already applied? <Link to="/apply/status" style={{ color: "var(--info)" }}>Check your status</Link>
        </p>
      </form>
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: "100dvh", padding: "28px 20px 40px", background: "var(--bond)" };

const titleStyle: CSSProperties = { fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" };

const bodyTextStyle: CSSProperties = { fontSize: 13.5, color: "var(--slate)", lineHeight: 1.6 };

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "14px 0 4px",
};

const labelStyle: CSSProperties = {
  display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6, marginTop: 18,
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};

const referenceCardStyle: CSSProperties = {
  marginTop: 20, padding: 18, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", textAlign: "center",
};

const referenceTextStyle: CSSProperties = { fontSize: 26, fontWeight: 700, letterSpacing: ".04em" };

const copyButtonStyle: CSSProperties = {
  marginTop: 14, minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase",
};

const primaryLinkStyle: CSSProperties = {
  display: "block", marginTop: 24, minHeight: "var(--tap)", lineHeight: "var(--tap)", textAlign: "center",
  borderRadius: 8, background: "var(--deep)", color: "var(--brass-soft)", textDecoration: "none",
  fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".06em", textTransform: "uppercase",
};

const ghostLinkStyle: CSSProperties = {
  display: "block", marginTop: 10, minHeight: "var(--tap)", lineHeight: "var(--tap)", textAlign: "center",
  borderRadius: 8, border: "1px solid var(--line)", color: "var(--info)", textDecoration: "none",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase",
};
