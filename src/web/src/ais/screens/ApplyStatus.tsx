import { useState, type CSSProperties, type FormEvent } from "react";
import { api, ApiError } from "@/shared/api";
import type { MembershipApplicationStatus } from "@/shared/types";
import {
  ApplicationFormFields, EMPTY_APPLICATION_FORM, validateApplicationForm,
  type ApplicationFormValues,
} from "./ApplicationFormFields";

type ViewState =
  | { step: "lookup" }
  | { step: "not-found" }
  | { step: "result"; data: MembershipApplicationStatus };

function toFormValues(a: MembershipApplicationStatus): ApplicationFormValues {
  return {
    firstName: a.firstName,
    middleName: a.middleName ?? "",
    lastName: a.lastName,
    giftName: a.giftName,
    birthDate: a.birthDate,
    email: a.email ?? "",
    dateSurvive: a.dateSurvive ?? "",
    presidentDuringSurvive: a.presidentDuringSurvive ?? "",
    masterInitiatorDuringSurvive: a.masterInitiatorDuringSurvive ?? "",
    seconderNameGiven: a.seconderNameGiven,
    seconderMemberNumberGiven: a.seconderMemberNumberGiven ?? "",
  };
}

/**
 * GET /api/membership-applications/status?referenceNo=&mobileNo= to look up an
 * application; PUT the same route to resubmit once it has been ReturnedForCorrection.
 *
 * A 404 here means "wrong reference number OR wrong mobile number" — the server
 * deliberately returns the identical response for both (anti-enumeration), so this
 * screen renders one plain message rather than inventing a distinction the API itself
 * refuses to make.
 */
export function ApplyStatus() {
  const [referenceNo, setReferenceNo] = useState("");
  const [mobileNo, setMobileNo] = useState("");
  const [view, setView] = useState<ViewState>({ step: "lookup" });
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [form, setForm] = useState<ApplicationFormValues>(EMPTY_APPLICATION_FORM);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  async function lookup(refNo: string, mobile: string): Promise<MembershipApplicationStatus | "not-found"> {
    const qs = new URLSearchParams({ referenceNo: refNo, mobileNo: mobile });
    try {
      return await api.get<MembershipApplicationStatus>(`/api/membership-applications/status?${qs.toString()}`);
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
      setLookupError("Enter both your reference number and mobile number.");
      return;
    }

    setLooking(true);
    try {
      const result = await lookup(refNo, mobile);
      if (result === "not-found") {
        setView({ step: "not-found" });
      } else {
        setForm(toFormValues(result));
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

    const formError = validateApplicationForm(form);
    if (formError) { setResubmitError(formError); return; }

    const { referenceNo: refNo, mobileNo: mobile } = view.data;
    const qs = new URLSearchParams({ referenceNo: refNo, mobileNo: mobile });

    setResubmitting(true);
    try {
      await api.put(`/api/membership-applications/status?${qs.toString()}`, {
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        lastName: form.lastName.trim(),
        giftName: form.giftName.trim(),
        birthDate: form.birthDate,
        email: form.email.trim() || null,
        dateSurvive: form.dateSurvive || null,
        presidentDuringSurvive: form.presidentDuringSurvive.trim() || null,
        masterInitiatorDuringSurvive: form.masterInitiatorDuringSurvive.trim() || null,
        seconderNameGiven: form.seconderNameGiven.trim(),
        seconderMemberNumberGiven: form.seconderMemberNumberGiven.trim() || null,
      });

      // Re-fetch so the screen reflects the server's own current record, rather than
      // assuming the resubmission landed exactly as typed.
      const fresh = await lookup(refNo, mobile);
      if (fresh === "not-found") {
        setView({ step: "not-found" });
      } else {
        setForm(toFormValues(fresh));
        setView({ step: "result", data: fresh });
      }
    } catch (err) {
      // Surfaces the server's own message verbatim — e.g. its own "at least 10
      // characters" rule elsewhere, or a 409 if this was decided since the page loaded.
      setResubmitError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setResubmitting(false);
    }
  }

  if (view.step === "lookup" || view.step === "not-found") {
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Check your application</h1>

        <form onSubmit={e => { void handleLookup(e); }} style={{ marginTop: 18 }}>
          <label htmlFor="referenceNo" style={labelStyle}>Reference number</label>
          <input
            id="referenceNo" className="num" value={referenceNo}
            onChange={e => setReferenceNo(e.target.value)} placeholder="APP-2026-00001" style={fieldStyle}
          />

          <label htmlFor="mobileNo" style={labelStyle}>Mobile number</label>
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
      </div>
    );
  }

  const a = view.data;

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>{a.chapterName}</h1>
      <div className="num" style={{ fontSize: 13, color: "var(--mute)", marginTop: 4 }}>{a.referenceNo}</div>

      {a.statusName === "PendingApproval" && (
        <p style={statusBodyStyle}>Your application is being reviewed.</p>
      )}

      {a.statusName === "Approved" && (
        <p style={statusBodyStyle}>
          Your application has been approved. Check for the enrolment link your chapter sent you —
          your chapter's officers deliver it to you directly; this system does not send it.
        </p>
      )}

      {a.statusName === "Rejected" && (
        <>
          <p style={statusBodyStyle}>Your application was not approved.</p>
          {a.decisionReason && <p style={reasonBoxStyle}>{a.decisionReason}</p>}
          <p style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 16, lineHeight: 1.6 }}>
            You are welcome to apply again — ask the chapter for their join link.
          </p>
        </>
      )}

      {a.statusName === "ReturnedForCorrection" && (
        <>
          <p style={statusBodyStyle}>Your chapter asked you to correct and resubmit this application.</p>
          {a.decisionReason && <p style={reasonBoxStyle}>{a.decisionReason}</p>}

          <form onSubmit={e => { void handleResubmit(e); }} style={{ marginTop: 10 }}>
            <ApplicationFormFields values={form} onChange={(field, value) => setForm(f => ({ ...f, [field]: value }))} />

            {resubmitError && <p role="alert" style={errorStyle}>{resubmitError}</p>}

            <button
              type="submit" disabled={resubmitting}
              style={{ ...buttonStyle, opacity: resubmitting ? 0.7 : 1 }}
            >
              {resubmitting ? "Resubmitting…" : "Resubmit application"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

const pageStyle: CSSProperties = { minHeight: "100dvh", padding: "28px 20px 40px", background: "var(--bond)" };

const titleStyle: CSSProperties = { fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" };

const statusBodyStyle: CSSProperties = { fontSize: 14, color: "var(--slate)", marginTop: 18, lineHeight: 1.6 };

const reasonBoxStyle: CSSProperties = {
  marginTop: 12, padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.6,
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
