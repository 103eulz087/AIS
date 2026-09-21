import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import {
  CHAPTER_ACCENTS, CHAPTER_OFFICES, type MunicipalityOption, type ProvinceOption, type RegionOption,
  type SubmitChapterRegistrationRequest, type SubmitChapterRegistrationResponse,
} from "@/shared/types";
import { ChapterMonogram } from "./ChapterMonogram";
import {
  CharterOfficerFieldset, emptyCharterOfficerForm, emptyCharterOfficerRoster,
  PRESIDENT_OFFICE_ID, toCharterOfficerInput, validateCharterOfficerRoster,
  type CharterOfficerFormValues,
} from "./ChapterOfficerFields";

type FormStep = "chapter" | "officers" | "review";

/**
 * GET /api/regions, GET /api/provinces?regionId=, GET /api/municipalities?provinceId= —
 * all public and unauthenticated (ReferenceEndpoints.cs). A server-side cascade, because
 * there is no chapter yet — the petition IS the location — so this is raw PH geography,
 * fetched one level at a time as the petitioner narrows in.
 *
 * POST /api/chapter-registrations — the public, rate-limited Charter submission. A
 * double-submit is not specially handled client-side: the procedure itself resolves a
 * genuine concurrent duplicate (same proposed name + municipality) and hands back the
 * SAME reference number, same idiom as JoinChapter.tsx's own membership-application
 * submit.
 *
 * No chapter mark anywhere in the chrome around this screen (docs §7A.3) — the chapter
 * does not exist yet. The ONLY mark on screen is the live monogram preview the
 * petitioner is building for his own soon-to-exist chapter.
 */
export function RegisterChapter() {
  const regions = useQuery({
    queryKey: ["public-regions"],
    queryFn: () => api.get<RegionOption[]>("/api/regions"),
    retry: false,
  });

  const [step, setStep] = useState<FormStep>("chapter");

  const [chapterName, setChapterName] = useState("");
  const [barangay, setBarangay] = useState("");
  const [regionId, setRegionId] = useState("");
  const [provinceId, setProvinceId] = useState("");
  const [municipalityId, setMunicipalityId] = useState("");
  const [accentId, setAccentId] = useState<number | null>(null);

  const [officers, setOfficers] = useState<CharterOfficerFormValues[]>(() => emptyCharterOfficerRoster());

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [referenceNo, setReferenceNo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const provinces = useQuery({
    queryKey: ["public-provinces", regionId],
    queryFn: () => api.get<ProvinceOption[]>(`/api/provinces?regionId=${regionId}`),
    enabled: !!regionId,
    retry: false,
  });

  const municipalities = useQuery({
    queryKey: ["public-municipalities", provinceId],
    queryFn: () => api.get<MunicipalityOption[]>(`/api/municipalities?provinceId=${provinceId}`),
    enabled: !!provinceId,
    retry: false,
  });

  const selectedAccent = useMemo(
    () => CHAPTER_ACCENTS.find(a => a.accentId === accentId) ?? CHAPTER_ACCENTS[0]!,
    [accentId],
  );

  function updateOfficer<K extends keyof CharterOfficerFormValues>(index: number, field: K, value: CharterOfficerFormValues[K]) {
    setOfficers(prev => prev.map((o, i) => (i === index ? { ...o, [field]: value } : o)));
  }

  const availableOffices = CHAPTER_OFFICES.filter(o => !officers.some(added => added.officeId === o.officeId));
  const [nextOfficeId, setNextOfficeId] = useState<string>("");

  function addOfficer() {
    if (!nextOfficeId) return;
    setOfficers(prev => [...prev, emptyCharterOfficerForm(Number(nextOfficeId))]);
    setNextOfficeId("");
  }

  function removeOfficer(index: number) {
    setOfficers(prev => prev.filter((_, i) => i !== index));
  }

  function goToOfficers(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!chapterName.trim()) { setError("Enter the proposed chapter name."); return; }
    if (!regionId || !provinceId || !municipalityId) {
      setError("Choose the chapter's region, province and city/municipality.");
      return;
    }
    setStep("officers");
  }

  function goToReview(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const officerError = validateCharterOfficerRoster(officers);
    if (officerError) { setError(officerError); return; }
    setStep("review");
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const req: SubmitChapterRegistrationRequest = {
        proposedChapterName: chapterName.trim(),
        barangay: barangay.trim() || null,
        regionId: Number(regionId),
        provinceId: Number(provinceId),
        municipalityId: Number(municipalityId),
        markAccentId: accentId,
        officers: officers.map(toCharterOfficerInput),
      };
      const res = await api.post<SubmitChapterRegistrationResponse>("/api/chapter-registrations", req);
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

  if (referenceNo) {
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Registration submitted</h1>
        <p style={bodyTextStyle}>
          Save this reference number together with your president's mobile number — you will need
          both to check your registration's status.
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
          Your council will verify each officer, then charter the chapter. Your president will
          receive a one-time enrolment link directly from the council — nobody will text or email
          you a password.
        </p>

        <Link to="/register-chapter/status" style={primaryLinkStyle}>Check registration status</Link>
        <Link to="/sign-in" style={ghostLinkStyle}>Back to sign in</Link>
      </div>
    );
  }

  if (regions.isLoading) return <ScreenSkeleton rows={6} />;
  if (regions.error) {
    return <ErrorState message={(regions.error as Error).message} onRetry={() => regions.refetch()} />;
  }
  const regionRows = Array.isArray(regions.data) ? regions.data : [];
  if (regionRows.length === 0) {
    return (
      <EmptyState
        title="Chapter registration isn't available right now"
        body="We couldn't load the list of regions. Please check back later."
      />
    );
  }

  const provinceRows = Array.isArray(provinces.data) ? provinces.data : [];
  const municipalityRows = Array.isArray(municipalities.data) ? municipalities.data : [];

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Register a new chapter</h1>
      <p style={{ ...bodyTextStyle, marginTop: 8 }}>
        This is the same form your council keeps on paper today. There is no fee to apply.
      </p>

      <StepIndicator step={step} />

      {step === "chapter" && (
        <form onSubmit={goToOfficers} style={{ marginTop: 20 }}>
          <label htmlFor="chapterName" style={labelStyle}>Proposed chapter name</label>
          <input
            id="chapterName" value={chapterName} onChange={e => setChapterName(e.target.value)}
            style={fieldStyle}
          />

          <label htmlFor="barangay" style={labelStyle}>Barangay (optional)</label>
          <input
            id="barangay" value={barangay} onChange={e => setBarangay(e.target.value)}
            style={fieldStyle}
          />

          <div style={sectionLabelStyle}>Location</div>

          <label htmlFor="region" style={labelStyle}>Region</label>
          <select
            id="region" value={regionId} style={fieldStyle}
            onChange={e => { setRegionId(e.target.value); setProvinceId(""); setMunicipalityId(""); }}
          >
            <option value="">Select a region</option>
            {regionRows.map(r => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
          </select>

          <label htmlFor="province" style={labelStyle}>Province</label>
          <select
            id="province" value={provinceId} disabled={!regionId} style={fieldStyle}
            onChange={e => { setProvinceId(e.target.value); setMunicipalityId(""); }}
          >
            <option value="">{provinces.isLoading ? "Loading…" : "Select a province"}</option>
            {provinceRows.map(p => <option key={p.provinceId} value={p.provinceId}>{p.provinceName}</option>)}
          </select>

          <label htmlFor="municipality" style={labelStyle}>City / Municipality</label>
          <select
            id="municipality" value={municipalityId} disabled={!provinceId} style={fieldStyle}
            onChange={e => setMunicipalityId(e.target.value)}
          >
            <option value="">{municipalities.isLoading ? "Loading…" : "Select a city or municipality"}</option>
            {municipalityRows.map(m => (
              <option key={m.municipalityId} value={m.municipalityId}>{m.municipalityName}</option>
            ))}
          </select>

          <div style={sectionLabelStyle}>Chapter mark</div>
          <p style={hintStyle}>
            Pick an accent colour. Your chapter's mark starts as these initials until you upload a
            logo later — your city council reviews any new logo before it goes live.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10 }}>
            <ChapterMonogram chapterName={chapterName} hexValue={selectedAccent.hexValue} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CHAPTER_ACCENTS.map(a => (
                <button
                  key={a.accentId} type="button"
                  aria-label={a.accentName}
                  aria-pressed={accentId === a.accentId}
                  onClick={() => setAccentId(a.accentId)}
                  style={{
                    width: 34, height: 34, borderRadius: "50%", background: a.hexValue,
                    border: accentId === a.accentId ? "3px solid var(--ink)" : "1px solid var(--line)",
                  }}
                />
              ))}
            </div>
          </div>

          {error && <p role="alert" style={errorStyle}>{error}</p>}

          <button type="submit" style={buttonStyle}>Next: officer roster</button>

          <p style={{ marginTop: 20, fontSize: 12.5, color: "var(--mute)", textAlign: "center" }}>
            Already registered? <Link to="/register-chapter/status" style={{ color: "var(--info)" }}>Check your status</Link>
          </p>
        </form>
      )}

      {step === "officers" && (
        <form onSubmit={goToReview} style={{ marginTop: 20 }}>
          <p style={bodyTextStyle}>
            The President is the only officer required to petition. Add the rest as your chapter
            fills them — it's fine to leave a position vacant for now and add it later.
          </p>

          {officers.map((o, i) => (
            <CharterOfficerFieldset
              key={o.officeId} officeId={o.officeId} values={o}
              onChange={(field, value) => updateOfficer(i, field, value)}
              onRemove={o.officeId === PRESIDENT_OFFICE_ID ? undefined : () => removeOfficer(i)}
            />
          ))}

          {availableOffices.length > 0 && (
            <div style={addOfficerRowStyle}>
              <select
                aria-label="Add a position" value={nextOfficeId}
                onChange={e => setNextOfficeId(e.target.value)}
                style={{ ...fieldStyle, flex: 1 }}
              >
                <option value="">Add a position…</option>
                {availableOffices.map(o => (
                  <option key={o.officeId} value={o.officeId}>{o.officeName}</option>
                ))}
              </select>
              <button type="button" onClick={addOfficer} disabled={!nextOfficeId} style={addOfficerButtonStyle}>
                Add
              </button>
            </div>
          )}

          {error && <p role="alert" style={errorStyle}>{error}</p>}

          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setStep("chapter")} style={ghostButtonStyle}>Back</button>
            <button type="submit" style={{ ...buttonStyle, marginTop: 0, flex: 1 }}>Next: review</button>
          </div>
        </form>
      )}

      {step === "review" && (
        <div style={{ marginTop: 20 }}>
          <div style={sectionLabelStyle}>Chapter</div>
          <div style={reviewCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <ChapterMonogram chapterName={chapterName} hexValue={selectedAccent.hexValue} size={56} />
              <div>
                <div style={{ fontFamily: "var(--f-disp)", fontSize: 18 }}>{chapterName}</div>
                <div style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 2 }}>
                  {[barangay, municipalityRows.find(m => String(m.municipalityId) === municipalityId)?.municipalityName,
                    provinceRows.find(p => String(p.provinceId) === provinceId)?.provinceName,
                    regionRows.find(r => String(r.regionId) === regionId)?.regionName]
                    .filter(Boolean).join(", ")}
                </div>
                <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 2 }}>Accent: {selectedAccent.accentName}</div>
              </div>
            </div>
          </div>

          <div style={sectionLabelStyle}>
            Officers ({officers.length} of 8 {officers.length === 1 ? "position" : "positions"} filled)
          </div>
          <div style={reviewCardStyle}>
            {officers.map(o => (
              <div key={o.officeId} style={reviewOfficerRowStyle}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {[o.firstName, o.lastName].filter(Boolean).join(" ") || "—"}
                  {o.giftName ? ` (${o.giftName})` : ""}
                </div>
                <div className="num" style={{ fontSize: 11.5, color: "var(--mute)" }}>{o.mobileNo || "—"}</div>
              </div>
            ))}
          </div>

          {error && <p role="alert" style={errorStyle}>{error}</p>}

          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button type="button" onClick={() => setStep("officers")} style={ghostButtonStyle} disabled={submitting}>
              Back
            </button>
            <button
              type="button" disabled={submitting}
              onClick={() => { void handleSubmit(); }}
              style={{ ...buttonStyle, marginTop: 0, flex: 1, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? "Submitting…" : "Submit registration"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: FormStep }) {
  const steps: Array<{ id: FormStep; label: string }> = [
    { id: "chapter", label: "Chapter" }, { id: "officers", label: "Officers" }, { id: "review", label: "Review" },
  ];
  const activeIndex = steps.findIndex(s => s.id === step);
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
      {steps.map((s, i) => (
        <div key={s.id} style={{
          flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: 8, fontSize: 11.5,
          fontFamily: "var(--f-disp)", letterSpacing: ".06em", textTransform: "uppercase",
          background: i <= activeIndex ? "var(--deep)" : "var(--paper)",
          color: i <= activeIndex ? "var(--brass-soft)" : "var(--mute)",
          border: "1px solid var(--line)",
        }}>{s.label}</div>
      ))}
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

const ghostButtonStyle: CSSProperties = {
  marginTop: 26, minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--slate)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase",
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

const reviewCardStyle: CSSProperties = {
  padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", marginBottom: 4,
};

const reviewOfficerRowStyle: CSSProperties = { padding: "8px 0", borderBottom: "1px solid var(--line)" };

const addOfficerRowStyle: CSSProperties = { display: "flex", gap: 8, marginTop: 8, marginBottom: 18 };

const addOfficerButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase",
};
