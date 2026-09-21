import type { CSSProperties } from "react";

/**
 * The short-form registration fields shared by the initial submission (JoinChapter.tsx)
 * and a resubmission after ReturnedForCorrection (ApplyStatus.tsx). MobileNo and the target
 * chapter are deliberately NOT here: mobileNo is half of the lookup identity a
 * resubmission is keyed by and cannot change on resubmit, and re-chaptering an
 * application is out of scope for this slice (see ResubmitMembershipApplicationRequest's
 * own header comment on the API side).
 */
export interface ApplicationFormValues {
  firstName: string;
  middleName: string;
  lastName: string;
  giftName: string;
  birthDate: string;
  email: string;
  dateSurvive: string;
  presidentDuringSurvive: string;
  masterInitiatorDuringSurvive: string;
  seconderNameGiven: string;
  seconderMemberNumberGiven: string;
}

export const EMPTY_APPLICATION_FORM: ApplicationFormValues = {
  firstName: "", middleName: "", lastName: "", giftName: "", birthDate: "",
  email: "", dateSurvive: "", presidentDuringSurvive: "", masterInitiatorDuringSurvive: "",
  seconderNameGiven: "", seconderMemberNumberGiven: "",
};

/**
 * Client-side mirror of the server's own required-field rules (SubmitMembershipApplicationRequestValidator /
 * ResubmitMembershipApplicationRequestValidator): first name, last name, gift name, birthdate
 * and a seconder's name are the only required fields in the short form. This is a hint only —
 * the server's own validation is authoritative and is surfaced verbatim on rejection.
 */
export function validateApplicationForm(v: ApplicationFormValues): string | null {
  if (!v.firstName.trim() || !v.lastName.trim() || !v.giftName.trim()
    || !v.birthDate || !v.seconderNameGiven.trim()) {
    return "First name, last name, gift name, birthdate and a seconder's name are required.";
  }
  return null;
}

export function ApplicationFormFields({ values, onChange, disabled }: {
  values: ApplicationFormValues;
  onChange: <K extends keyof ApplicationFormValues>(field: K, value: ApplicationFormValues[K]) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <label htmlFor="firstName" style={labelStyle}>First name</label>
      <input
        id="firstName" value={values.firstName} disabled={disabled}
        onChange={e => onChange("firstName", e.target.value)} style={fieldStyle}
      />

      <label htmlFor="middleName" style={labelStyle}>Middle name (optional)</label>
      <input
        id="middleName" value={values.middleName} disabled={disabled}
        onChange={e => onChange("middleName", e.target.value)} style={fieldStyle}
      />

      <label htmlFor="lastName" style={labelStyle}>Last name</label>
      <input
        id="lastName" value={values.lastName} disabled={disabled}
        onChange={e => onChange("lastName", e.target.value)} style={fieldStyle}
      />

      <label htmlFor="giftName" style={labelStyle}>Gift name</label>
      <input
        id="giftName" value={values.giftName} disabled={disabled}
        onChange={e => onChange("giftName", e.target.value)} style={fieldStyle}
      />
      <p style={hintStyle}>Your name within the fraternity, e.g. TANGLAW.</p>

      <label htmlFor="birthDate" style={labelStyle}>Birthdate</label>
      <input
        id="birthDate" type="date" value={values.birthDate} disabled={disabled}
        onChange={e => onChange("birthDate", e.target.value)} style={fieldStyle}
      />

      <label htmlFor="email" style={labelStyle}>Email (optional)</label>
      <input
        id="email" type="email" value={values.email} disabled={disabled}
        onChange={e => onChange("email", e.target.value)} style={fieldStyle}
      />

      <label htmlFor="dateSurvive" style={labelStyle}>Date survive (optional)</label>
      <input
        id="dateSurvive" type="date" value={values.dateSurvive} disabled={disabled}
        onChange={e => onChange("dateSurvive", e.target.value)} style={fieldStyle}
      />
      <p style={hintStyle}>The date you were initiated, if you remember it.</p>

      <label htmlFor="presidentDuringSurvive" style={labelStyle}>President during survive (optional)</label>
      <input
        id="presidentDuringSurvive" value={values.presidentDuringSurvive} disabled={disabled}
        onChange={e => onChange("presidentDuringSurvive", e.target.value)} style={fieldStyle}
      />

      <label htmlFor="masterInitiatorDuringSurvive" style={labelStyle}>
        Master initiator during survive (optional)
      </label>
      <input
        id="masterInitiatorDuringSurvive" value={values.masterInitiatorDuringSurvive} disabled={disabled}
        onChange={e => onChange("masterInitiatorDuringSurvive", e.target.value)} style={fieldStyle}
      />

      <label htmlFor="seconderNameGiven" style={labelStyle}>Seconder's name</label>
      <input
        id="seconderNameGiven" value={values.seconderNameGiven} disabled={disabled}
        onChange={e => onChange("seconderNameGiven", e.target.value)} style={fieldStyle}
      />
      <p style={hintStyle}>A brother who can vouch that he knows you.</p>

      <label htmlFor="seconderMemberNumberGiven" style={labelStyle}>
        Seconder's member number (optional)
      </label>
      <input
        id="seconderMemberNumberGiven" className="num" value={values.seconderMemberNumberGiven} disabled={disabled}
        onChange={e => onChange("seconderMemberNumberGiven", e.target.value)} style={fieldStyle}
      />
      <p style={hintStyle}>If you know it. Your chapter will confirm this with him directly.</p>
    </>
  );
}

const labelStyle: CSSProperties = {
  display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6, marginTop: 18,
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };
