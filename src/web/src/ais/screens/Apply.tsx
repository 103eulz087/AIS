import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import type { ChapterPublic } from "@/shared/types";
import {
  ApplicationFormFields, EMPTY_APPLICATION_FORM, validateApplicationForm,
  type ApplicationFormValues,
} from "./ApplicationFormFields";

interface SubmitResponse { referenceNo: string }

/**
 * GET /api/chapters — the public, unauthenticated cascading picker (Region -> Province ->
 * City -> Chapter). There is no separate hierarchical endpoint; this builds the cascade
 * client-side from the flat list of chapter rows, each carrying its own council-chain names.
 *
 * POST /api/membership-applications — the public submission itself. A double-submit
 * (the same mobile number applying to the same chapter again) is NOT an error: the
 * server hands back the SAME reference number, and this screen treats any success the
 * same way regardless.
 *
 * No chapter mark anywhere on this screen (docs/AIS-Project-Documentation.md §7A.3) —
 * the applicant is choosing his chapter on this very screen, so there is no identity
 * yet for the interface to carry. Mirrors SignIn.tsx's own reasoning.
 */
export function Apply() {
  const chapters = useQuery({
    queryKey: ["public-chapters"],
    queryFn: () => api.get<ChapterPublic[]>("/api/chapters"),
    retry: false,
  });

  const [region, setRegion] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [chapterId, setChapterId] = useState("");

  const [mobileNo, setMobileNo] = useState("");
  const [form, setForm] = useState<ApplicationFormValues>(EMPTY_APPLICATION_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceNo, setReferenceNo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The server's own array shape, guarded rather than trusted — a screen must not
  // throw on an unexpected payload shape.
  const rows = Array.isArray(chapters.data) ? chapters.data : [];

  const regions = useMemo(
    () => Array.from(new Set(rows.map(r => r.regionName).filter((x): x is string => !!x))).sort(),
    [rows],
  );
  const provinces = useMemo(
    () => Array.from(new Set(
      rows.filter(r => r.regionName === region).map(r => r.provinceName).filter((x): x is string => !!x),
    )).sort(),
    [rows, region],
  );
  const cities = useMemo(
    () => Array.from(new Set(
      rows.filter(r => r.regionName === region && r.provinceName === province)
        .map(r => r.cityName).filter((x): x is string => !!x),
    )).sort(),
    [rows, region, province],
  );
  const chapterOptions = useMemo(
    () => rows.filter(r => r.regionName === region && r.provinceName === province && r.cityName === city),
    [rows, region, province, city],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!chapterId) { setError("Choose the chapter you are applying to join."); return; }
    if (!mobileNo.trim()) { setError("A mobile number is required."); return; }
    const formError = validateApplicationForm(form);
    if (formError) { setError(formError); return; }

    setSubmitting(true);
    try {
      const res = await api.post<SubmitResponse>("/api/membership-applications", {
        chapterId: Number(chapterId),
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
        // Surfaces the server's own message verbatim — e.g. an impossible birthdate.
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
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

  if (chapters.isLoading) return <ScreenSkeleton rows={6} />;
  if (chapters.error) {
    return <ErrorState message={(chapters.error as Error).message} onRetry={() => chapters.refetch()} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No chapters are open for applications"
        body="There is nothing to apply to right now. Please check back later."
      />
    );
  }

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Apply to join a chapter</h1>
      <p style={{ ...bodyTextStyle, marginTop: 8 }}>
        Your chapter's officers will review this. There is no fee to apply.
      </p>

      <form onSubmit={e => { void handleSubmit(e); }} style={{ marginTop: 20 }}>
        <div style={sectionLabelStyle}>Chapter</div>

        <label htmlFor="region" style={labelStyle}>Region</label>
        <select
          id="region" value={region} style={fieldStyle}
          onChange={e => { setRegion(e.target.value); setProvince(""); setCity(""); setChapterId(""); }}
        >
          <option value="">Select a region</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <label htmlFor="province" style={labelStyle}>Province</label>
        <select
          id="province" value={province} disabled={!region} style={fieldStyle}
          onChange={e => { setProvince(e.target.value); setCity(""); setChapterId(""); }}
        >
          <option value="">Select a province</option>
          {provinces.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <label htmlFor="city" style={labelStyle}>City / Municipality</label>
        <select
          id="city" value={city} disabled={!province} style={fieldStyle}
          onChange={e => { setCity(e.target.value); setChapterId(""); }}
        >
          <option value="">Select a city</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <label htmlFor="chapter" style={labelStyle}>Chapter</label>
        <select
          id="chapter" value={chapterId} disabled={!city} style={fieldStyle}
          onChange={e => setChapterId(e.target.value)}
        >
          <option value="">Select a chapter</option>
          {chapterOptions.map(c => <option key={c.chapterId} value={c.chapterId}>{c.chapterName}</option>)}
        </select>

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
