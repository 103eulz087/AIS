import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { shortDate } from "@/shared/format";
import {
  CHAPTER_ACCENTS, type ChapterRegistrationStatus, type MunicipalityOption, type ProvinceOption,
  type RegionOption, type ResubmitChapterRegistrationRequest, type ResubmitChapterRegistrationResponse,
} from "@/shared/types";
import { ChapterMonogram } from "./ChapterMonogram";
import {
  CharterOfficerFieldset, emptyCharterOfficerRoster, toCharterOfficerInput,
  validateCharterOfficerRoster, type CharterOfficerFormValues,
} from "./ChapterOfficerFields";

type ViewState =
  | { step: "lookup" }
  | { step: "not-found" }
  | { step: "result"; data: ChapterRegistrationStatus };

/**
 * GET /api/chapter-registrations/status?referenceNo=&mobileNo= to look up a
 * registration; PUT the same route to resubmit once it has been ReturnedForCorrection.
 *
 * A 404 here means "wrong reference number OR wrong mobile number" — deliberate
 * anti-enumeration (usp_ChapterRegistration_GetByReference's own header comment) — so
 * this screen renders one plain message rather than inventing a distinction the API
 * itself refuses to make.
 *
 * IMPORTANT DIFFERENCE FROM ApplyStatus.tsx: ChapterRegistrationStatusDto is
 * deliberately thin — it never carries the officer roster (the same rule that keeps a
 * council's own detail view from leaking to the wider membership), and unlike
 * MembershipApplicationStatus it ALSO never carries geography, barangay or accent. A
 * resubmission here can therefore only be pre-filled with the proposed chapter name —
 * everything else (location, accent, all eight officers) starts blank and must be
 * re-entered in full, per ResubmitChapterRegistrationRequest's own "the WHOLE form"
 * contract. This is called out plainly on screen rather than silently presenting an
 * apparently-prefilled form that is actually empty underneath.
 */
export function RegisterChapterStatus() {
  const [referenceNo, setReferenceNo] = useState("");
  const [mobileNo, setMobileNo] = useState("");
  const [view, setView] = useState<ViewState>({ step: "lookup" });
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [chapterName, setChapterName] = useState("");
  const [barangay, setBarangay] = useState("");
  const [regionId, setRegionId] = useState("");
  const [provinceId, setProvinceId] = useState("");
  const [municipalityId, setMunicipalityId] = useState("");
  const [accentId, setAccentId] = useState<number | null>(null);
  const [officers, setOfficers] = useState<CharterOfficerFormValues[]>(() => emptyCharterOfficerRoster());

  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  const regions = useQuery({
    queryKey: ["public-regions"],
    queryFn: () => api.get<RegionOption[]>("/api/regions"),
    enabled: view.step === "result",
    retry: false,
  });
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

  async function lookup(refNo: string, mobile: string): Promise<ChapterRegistrationStatus | "not-found"> {
    const qs = new URLSearchParams({ referenceNo: refNo, mobileNo: mobile });
    try {
      return await api.get<ChapterRegistrationStatus>(`/api/chapter-registrations/status?${qs.toString()}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return "not-found";
      throw err;
    }
  }

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    setLookupError(null);

    const refNo = referenceNo.trim();
    const mobile = mobileNo.trim();
    if (!refNo || !mobile) {
      setLookupError("Enter both your reference number and your president's mobile number.");
      return;
    }

    setLooking(true);
    try {
      const result = await lookup(refNo, mobile);
      if (result === "not-found") {
        setView({ step: "not-found" });
      } else {
        setChapterName(result.proposedChapterName ?? "");
        setView({ step: "result", data: result });
      }
    } catch (err) {
      setLookupError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLooking(false);
    }
  }

  async function handleResubmit(e: FormEvent) {
    e.preventDefault();
    if (view.step !== "result") return;
    setResubmitError(null);

    if (!chapterName.trim()) { setResubmitError("Enter the proposed chapter name."); return; }
    if (!regionId || !provinceId || !municipalityId) {
      setResubmitError("Choose the chapter's region, province and city/municipality.");
      return;
    }
    const officerError = validateCharterOfficerRoster(officers);
    if (officerError) { setResubmitError(officerError); return; }

    const refNo = referenceNo.trim();
    const mobile = mobileNo.trim();
    const qs = new URLSearchParams({ referenceNo: refNo, mobileNo: mobile });

    setResubmitting(true);
    try {
      const req: ResubmitChapterRegistrationRequest = {
        proposedChapterName: chapterName.trim(),
        barangay: barangay.trim() || null,
        regionId: Number(regionId),
        provinceId: Number(provinceId),
        municipalityId: Number(municipalityId),
        markAccentId: accentId,
        officers: officers.map(toCharterOfficerInput),
      };
      await api.put<ResubmitChapterRegistrationResponse>(`/api/chapter-registrations/status?${qs.toString()}`, req);

      const fresh = await lookup(refNo, mobile);
      if (fresh === "not-found") {
        setView({ step: "not-found" });
      } else {
        setView({ step: "result", data: fresh });
      }
    } catch (err) {
      setResubmitError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setResubmitting(false);
    }
  }

  if (view.step === "lookup" || view.step === "not-found") {
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Check your chapter's registration</h1>

        <form onSubmit={e => { void handleLookup(e); }} style={{ marginTop: 18 }}>
          <label htmlFor="referenceNo" style={labelStyle}>Reference number</label>
          <input
            id="referenceNo" className="num" value={referenceNo}
            onChange={e => setReferenceNo(e.target.value)} placeholder="CHR-2027-0001" style={fieldStyle}
          />

          <label htmlFor="mobileNo" style={labelStyle}>President's mobile number</label>
          <input
            id="mobileNo" value={mobileNo} onChange={e => setMobileNo(e.target.value)}
            inputMode="tel" placeholder="09XXXXXXXXX" style={fieldStyle}
          />

          {lookupError && <p role="alert" style={errorStyle}>{lookupError}</p>}
          {view.step === "not-found" && (
            <p role="alert" style={errorStyle}>
              We couldn't find that — check your reference number and mobile number.
            </p>
          )}

          <button type="submit" disabled={looking} style={{ ...buttonStyle, opacity: looking ? 0.7 : 1 }}>
            {looking ? "Checking…" : "Check status"}
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 12.5, color: "var(--mute)", textAlign: "center" }}>
          <Link to="/register-chapter" style={{ color: "var(--info)" }}>Register a new chapter</Link>
        </p>
      </div>
    );
  }

  const r = view.data;
  const regionRows = Array.isArray(regions.data) ? regions.data : [];
  const provinceRows = Array.isArray(provinces.data) ? provinces.data : [];
  const municipalityRows = Array.isArray(municipalities.data) ? municipalities.data : [];

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>{r.proposedChapterName ?? r.chapterName ?? "Chapter registration"}</h1>
      <div className="num" style={{ fontSize: 13, color: "var(--mute)", marginTop: 4 }}>{r.referenceNo}</div>
      <p style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 2 }}>
        {r.registrationType === "Charter" ? "New chapter petition" : "Annual officer update"}
        {" · "}Being handled by {r.actingCouncilName}
      </p>

      {r.statusName === "Submitted" && (
        <p style={statusBodyStyle}>Your registration is being reviewed by your council.</p>
      )}

      {r.statusName === "Approved" && (
        <p style={statusBodyStyle}>
          Your chapter has been approved. Check for the one-time enrolment link your council sent
          your president — it comes directly from the council, never from this system.
          {r.decidedDateUtc && ` Decided ${shortDate(r.decidedDateUtc)}.`}
        </p>
      )}

      {r.statusName === "ReturnedForCorrection" && (
        <>
          <p style={statusBodyStyle}>Your council asked you to correct and resubmit this registration.</p>
          {r.decisionReason && <p style={reasonBoxStyle}>{r.decisionReason}</p>}

          <p style={{ ...bodyTextStyle, marginTop: 14 }}>
            For your privacy this system does not keep your previous answers here — only your
            proposed chapter name carries over. Please re-enter the chapter's location, chapter mark
            and full officer roster below.
          </p>

          <form onSubmit={e => { void handleResubmit(e); }} style={{ marginTop: 10 }}>
            <label htmlFor="chapterName" style={labelStyle}>Proposed chapter name</label>
            <input
              id="chapterName" value={chapterName} onChange={e => setChapterName(e.target.value)}
              style={fieldStyle}
            />

            <label htmlFor="barangay" style={labelStyle}>Barangay (optional)</label>
            <input id="barangay" value={barangay} onChange={e => setBarangay(e.target.value)} style={fieldStyle} />

            <div style={sectionLabelStyle}>Location</div>

            <label htmlFor="region" style={labelStyle}>Region</label>
            <select
              id="region" value={regionId} style={fieldStyle}
              onChange={e => { setRegionId(e.target.value); setProvinceId(""); setMunicipalityId(""); }}
            >
              <option value="">{regions.isLoading ? "Loading…" : "Select a region"}</option>
              {regionRows.map(reg => <option key={reg.regionId} value={reg.regionId}>{reg.regionName}</option>)}
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
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10 }}>
              <ChapterMonogram chapterName={chapterName} hexValue={selectedAccent.hexValue} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {CHAPTER_ACCENTS.map(a => (
                  <button
                    key={a.accentId} type="button" aria-label={a.accentName} aria-pressed={accentId === a.accentId}
                    onClick={() => setAccentId(a.accentId)}
                    style={{
                      width: 34, height: 34, borderRadius: "50%", background: a.hexValue,
                      border: accentId === a.accentId ? "3px solid var(--ink)" : "1px solid var(--line)",
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={sectionLabelStyle}>Officers</div>
            {officers.map((o, i) => (
              <CharterOfficerFieldset
                key={o.officeId} officeId={o.officeId} values={o}
                onChange={(field, value) => updateOfficer(i, field, value)}
              />
            ))}

            {resubmitError && <p role="alert" style={errorStyle}>{resubmitError}</p>}

            <button
              type="submit" disabled={resubmitting}
              style={{ ...buttonStyle, opacity: resubmitting ? 0.7 : 1 }}
            >
              {resubmitting ? "Resubmitting…" : "Resubmit registration"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: "100dvh", padding: "28px 20px 40px", background: "var(--bond)" };

const titleStyle: CSSProperties = { fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" };

const bodyTextStyle: CSSProperties = { fontSize: 13.5, color: "var(--slate)", lineHeight: 1.6 };

const statusBodyStyle: CSSProperties = { fontSize: 14, color: "var(--slate)", marginTop: 18, lineHeight: 1.6 };

const reasonBoxStyle: CSSProperties = {
  marginTop: 12, padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.6,
};

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

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};
