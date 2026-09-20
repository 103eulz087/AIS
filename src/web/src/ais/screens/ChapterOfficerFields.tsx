import type { CSSProperties } from "react";
import { CHAPTER_OFFICES, type ChapterCharterOfficerInput, type Member } from "@/shared/types";

/**
 * The eight-officer roster fields, shared by every chapter-registration screen that
 * collects them: the public Charter petition (RegisterChapter.tsx) and its resubmission
 * (RegisterChapterStatus.tsx) both use CharterOfficerFieldset (typed-in — nobody exists
 * yet); the authenticated annual Turnover filing (OfficerRoster.tsx) uses
 * TurnoverOfficerFieldset (a member picker bound to the chapter's own existing roster —
 * never typed-in text, per ChapterTurnoverOfficerInputDto's own header comment on the API
 * side). Same extraction pattern as ApplicationFormFields.tsx.
 */

const MOBILE_RE = /^(09\d{9}|\+639\d{9})$/;

export interface CharterOfficerFormValues {
  officeId: number;
  firstName: string;
  middleName: string;
  lastName: string;
  giftName: string;
  birthDate: string;
  mobileNo: string;
  email: string;
  dateSurvive: string;
  presidentDuringSurvive: string;
  masterInitiatorDuringSurvive: string;
}

/** The one office every Charter petition must name — see usp_ChapterRegistration_Submit's
 * own header for why: it stays hard-required even though every other office is now
 * optional. Resolved by name from CHAPTER_OFFICES, matching the server's own
 * name-based (never a hardcoded id) resolution. */
export const PRESIDENT_OFFICE_ID = CHAPTER_OFFICES.find(o => o.officeName === "President")!.officeId;

export function emptyCharterOfficerForm(officeId: number): CharterOfficerFormValues {
  return {
    officeId, firstName: "", middleName: "", lastName: "", giftName: "", birthDate: "",
    mobileNo: "", email: "", dateSurvive: "", presidentDuringSurvive: "", masterInitiatorDuringSurvive: "",
  };
}

/** Only the President to start — every other office is genuinely optional at Charter
 * time (real chapters petitioning today often don't have every seat filled yet), added
 * one at a time via RegisterChapter.tsx's own "Add a position" control. Filling all
 * eight up front used to produce dirty data: petitioners typed dummy names into vacant
 * Master Initiator/Auditor slots just to satisfy an "exactly 8" rule that never
 * reflected reality — see usp_ChapterRegistration_Submit's header for the same reasoning
 * on the server side. */
export function emptyCharterOfficerRoster(): CharterOfficerFormValues[] {
  return [emptyCharterOfficerForm(PRESIDENT_OFFICE_ID)];
}

/** Client-side mirror of ChapterCharterOfficerInputValidator — first/last/gift name,
 * birthdate and a mobile number (in the same 09XXXXXXXXX / +639XXXXXXXXX shape the
 * server accepts) are required for every officer ACTUALLY ADDED, including a Master
 * Initiator if one is added — recorded offices with no login still need a real mobile
 * number to be reached. A hint only — the server's own validation is authoritative and
 * is surfaced verbatim on rejection. */
export function validateCharterOfficerRoster(officers: readonly CharterOfficerFormValues[]): string | null {
  if (!officers.some(o => o.officeId === PRESIDENT_OFFICE_ID)) {
    return "A President is required to petition for a new chapter.";
  }
  for (const o of officers) {
    const label = CHAPTER_OFFICES.find(x => x.officeId === o.officeId)?.officeName ?? "An officer";
    if (!o.firstName.trim() || !o.lastName.trim() || !o.giftName.trim() || !o.birthDate) {
      return `${label}: first name, last name, gift name and birthdate are required.`;
    }
    if (!o.mobileNo.trim() || !MOBILE_RE.test(o.mobileNo.trim())) {
      return `${label}: enter a mobile number as 09XXXXXXXXX or +639XXXXXXXXX.`;
    }
  }
  return null;
}

export function toCharterOfficerInput(v: CharterOfficerFormValues): ChapterCharterOfficerInput {
  return {
    officeId: v.officeId,
    firstName: v.firstName.trim(),
    middleName: v.middleName.trim() || null,
    lastName: v.lastName.trim(),
    giftName: v.giftName.trim(),
    birthDate: v.birthDate,
    mobileNo: v.mobileNo.trim(),
    email: v.email.trim() || null,
    dateSurvive: v.dateSurvive || null,
    presidentDuringSurvive: v.presidentDuringSurvive.trim() || null,
    masterInitiatorDuringSurvive: v.masterInitiatorDuringSurvive.trim() || null,
  };
}

export function CharterOfficerFieldset({ officeId, values, onChange, onRemove, disabled }: {
  officeId: number;
  values: CharterOfficerFormValues;
  onChange: <K extends keyof CharterOfficerFormValues>(field: K, value: CharterOfficerFormValues[K]) => void;
  /** Omitted for the President — that office can never be removed, only filled in. */
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const office = CHAPTER_OFFICES.find(o => o.officeId === officeId);
  const idBase = `officer-${officeId}`;

  return (
    <div style={officerCardStyle}>
      <div style={officerHeaderStyle}>
        <span>{office?.officeName ?? "Officer"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {office && !office.grantsLogin && <span style={noLoginPillStyle}>Recorded — no login</span>}
          {onRemove && (
            <button type="button" onClick={onRemove} disabled={disabled} style={removeButtonStyle}>
              Remove
            </button>
          )}
        </div>
      </div>
      {office?.officeName === "President" && (
        <p style={hintStyle}>Receives the chapter's first account once this petition is approved.</p>
      )}

      <label htmlFor={`${idBase}-firstName`} style={labelStyle}>First name</label>
      <input
        id={`${idBase}-firstName`} value={values.firstName} disabled={disabled}
        onChange={e => onChange("firstName", e.target.value)} style={fieldStyle}
      />

      <label htmlFor={`${idBase}-middleName`} style={labelStyle}>Middle name (optional)</label>
      <input
        id={`${idBase}-middleName`} value={values.middleName} disabled={disabled}
        onChange={e => onChange("middleName", e.target.value)} style={fieldStyle}
      />

      <label htmlFor={`${idBase}-lastName`} style={labelStyle}>Last name</label>
      <input
        id={`${idBase}-lastName`} value={values.lastName} disabled={disabled}
        onChange={e => onChange("lastName", e.target.value)} style={fieldStyle}
      />

      <label htmlFor={`${idBase}-giftName`} style={labelStyle}>Gift name</label>
      <input
        id={`${idBase}-giftName`} value={values.giftName} disabled={disabled}
        onChange={e => onChange("giftName", e.target.value)} style={fieldStyle}
      />

      <label htmlFor={`${idBase}-birthDate`} style={labelStyle}>Birthdate</label>
      <input
        id={`${idBase}-birthDate`} type="date" value={values.birthDate} disabled={disabled}
        onChange={e => onChange("birthDate", e.target.value)} style={fieldStyle}
      />

      <label htmlFor={`${idBase}-mobileNo`} style={labelStyle}>Mobile number</label>
      <input
        id={`${idBase}-mobileNo`} value={values.mobileNo} disabled={disabled}
        inputMode="tel" placeholder="09XXXXXXXXX"
        onChange={e => onChange("mobileNo", e.target.value)} style={fieldStyle}
      />
      <p style={hintStyle}>
        {office && !office.grantsLogin
          ? "Required even though this office receives no login — it is how the chapter and council reach him."
          : "This is how his enrolment link reaches him once the chapter is approved."}
      </p>

      <label htmlFor={`${idBase}-email`} style={labelStyle}>Email (optional)</label>
      <input
        id={`${idBase}-email`} type="email" value={values.email} disabled={disabled}
        onChange={e => onChange("email", e.target.value)} style={fieldStyle}
      />

      <label htmlFor={`${idBase}-dateSurvive`} style={labelStyle}>Date survive (optional)</label>
      <input
        id={`${idBase}-dateSurvive`} type="date" value={values.dateSurvive} disabled={disabled}
        onChange={e => onChange("dateSurvive", e.target.value)} style={fieldStyle}
      />

      <label htmlFor={`${idBase}-presidentDuringSurvive`} style={labelStyle}>
        President during survive (optional)
      </label>
      <input
        id={`${idBase}-presidentDuringSurvive`} value={values.presidentDuringSurvive} disabled={disabled}
        onChange={e => onChange("presidentDuringSurvive", e.target.value)} style={fieldStyle}
      />

      <label htmlFor={`${idBase}-masterInitiatorDuringSurvive`} style={labelStyle}>
        Master initiator during survive (optional)
      </label>
      <input
        id={`${idBase}-masterInitiatorDuringSurvive`} value={values.masterInitiatorDuringSurvive} disabled={disabled}
        onChange={e => onChange("masterInitiatorDuringSurvive", e.target.value)} style={fieldStyle}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------------- */

export interface TurnoverOfficerFormValues { officeId: number; memberId: number | null }

/** One blank office/member row per office, in the same order CHAPTER_OFFICES declares them. */
export function emptyTurnoverOfficerRoster(): TurnoverOfficerFormValues[] {
  return CHAPTER_OFFICES.map(o => ({ officeId: o.officeId, memberId: null }));
}

export function validateTurnoverOfficerRoster(officers: readonly TurnoverOfficerFormValues[]): string | null {
  const seen = new Set<number>();
  for (const o of officers) {
    const label = CHAPTER_OFFICES.find(x => x.officeId === o.officeId)?.officeName ?? "an office";
    if (!o.memberId) return `Choose a member for ${label}.`;
    if (seen.has(o.memberId)) return "The same brother cannot hold two offices in the same filing.";
    seen.add(o.memberId);
  }
  return null;
}

export function TurnoverOfficerFieldset({ officeId, memberId, members, onChange, disabled }: {
  officeId: number;
  memberId: number | null;
  members: readonly Member[];
  onChange: (memberId: number | null) => void;
  disabled?: boolean;
}) {
  const office = CHAPTER_OFFICES.find(o => o.officeId === officeId);
  const idBase = `turnover-officer-${officeId}`;

  return (
    <div style={officerCardStyle}>
      <div style={officerHeaderStyle}>
        <span>{office?.officeName ?? "Officer"}</span>
        {office && !office.grantsLogin && <span style={noLoginPillStyle}>Recorded — no login</span>}
      </div>

      <label htmlFor={idBase} style={labelStyle}>Member</label>
      <select
        id={idBase} value={memberId ?? ""} disabled={disabled} style={fieldStyle}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Select a member</option>
        {members.map(m => (
          <option key={m.memberId} value={m.memberId}>{m.giftName} — {m.memberNumber}</option>
        ))}
      </select>
      <p style={hintStyle}>
        {office && !office.grantsLogin
          ? "Recorded in the chapter's history. He receives no login either way."
          : "If he does not yet have an account, one is created for him on approval — a fresh enrolment link, never a password."}
      </p>
    </div>
  );
}

const officerCardStyle: CSSProperties = {
  padding: 14, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--line)", marginBottom: 14,
};

const officerHeaderStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".03em",
};

const noLoginPillStyle: CSSProperties = {
  fontSize: 10, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap",
  background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)",
};

const removeButtonStyle: CSSProperties = {
  fontSize: 11.5, color: "var(--out)", minHeight: 28, padding: "0 4px",
};

const labelStyle: CSSProperties = {
  display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6, marginTop: 14,
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };
