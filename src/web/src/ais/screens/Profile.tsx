import {
  useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type DownloadedFile } from "@/shared/api";
import { shortDate, validThrough } from "@/shared/format";
import { ErrorState, ScreenSkeleton } from "@/shared/states";
import type { BloodTypeOption, SkillOption } from "@/shared/types";
import { NotificationSettings } from "@/ais/screens/NotificationSettings";

/**
 * GET /api/members/me — the member's own record, a THIRD shape alongside the same-chapter
 * and cross-chapter Member DTOs (see MemberDtos.cs's MemberProfileDto), never returned for
 * any id but the caller's own. Mirrors MemberProfileDto exactly.
 *
 * Every field below can legitimately be absent in the payload this screen actually
 * receives during a route-smoke test (the jsdom harness's generic fetch stub returns an
 * unrelated `{items,total,...}` shape for every URL it doesn't special-case) — every read
 * of these fields is written to tolerate `undefined` without throwing and without ever
 * rendering the literal word "undefined" into the DOM.
 */
interface MemberProfileResponse {
  memberId: number;
  memberNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  giftName: string;
  birthdate: string | null;
  dateSurvive: string | null;
  presidentDuringSurvive: string | null;
  masterInitiatorDuringSurvive: string | null;
  chapterId: number | null;
  chapterName: string | null;
  homeCouncilId: number | null;
  councilName: string | null;
  chapterOfRecord: string | null;
  status: string;
  renewedThrough: string | null;
  seconderMemberId: number | null;
  approvedBy: number | null;
  approvedDateUtc: string | null;
  address: string | null;
  mobileNo: string | null;
  email: string | null;
  bloodTypeId: number | null;
  bloodTypeName: string | null;
  bloodTypeConfirmedDateUtc: string | null;
  profession: string | null;
  photoUrl: string | null;
  skillIds: number[];
  rowVersion: string;
}

interface ProfileUpdatedResponse { rowVersion: string }
interface PhotoStagedResponse { attachmentStagingId: number }
interface PhotoClaimedResponse { photoUrl: string }

/**
 * The editable slice of the profile. Built FRESH from the server's own response every
 * time (initial load, or after a successful save/refetch) — never patched in place —
 * because the update endpoint is a full-replace PATCH (see the header comment on
 * handleSave below): whatever this object holds is exactly what gets sent back, so it
 * must always start as a complete, faithful copy of what the server has on file.
 */
interface FormState {
  giftName: string;
  birthdate: string;
  dateSurvive: string;
  presidentDuringSurvive: string;
  masterInitiatorDuringSurvive: string;
  email: string;
  address: string;
  profession: string;
  skillIds: number[];
  mobileNo: string;
  currentPassword: string;
  bloodTypeId: number | null;
  /** Never pre-set true from a prior confirmation — see the Blood type section below. */
  bloodTypeConfirmed: boolean;
  rowVersion: string;
}

function buildForm(data: MemberProfileResponse): FormState {
  return {
    giftName: data.giftName ?? "",
    birthdate: data.birthdate ?? "",
    dateSurvive: data.dateSurvive ?? "",
    presidentDuringSurvive: data.presidentDuringSurvive ?? "",
    masterInitiatorDuringSurvive: data.masterInitiatorDuringSurvive ?? "",
    email: data.email ?? "",
    address: data.address ?? "",
    profession: data.profession ?? "",
    skillIds: [...(data.skillIds ?? [])],
    mobileNo: data.mobileNo ?? "",
    currentPassword: "",
    bloodTypeId: data.bloodTypeId ?? null,
    bloodTypeConfirmed: false,
    rowVersion: data.rowVersion ?? "",
  };
}

const PHOTO_ACCEPT = "image/jpeg,image/png,image/heic";
const MAX_PHOTO_SIZE_BYTES = 4 * 1024 * 1024;

/**
 * A member's own record — the only screen where he can see Address/Email/DateSurvive/
 * approval provenance about himself, and edit a bounded slice of it.
 *
 * Endpoints:
 *   GET   /api/members/me                — the full profile
 *   PATCH /api/members/me                — full-replace update (mobileNo/email/address/
 *                                           bloodTypeId/bloodTypeConfirmed/profession/
 *                                           skillIds/rowVersion[/currentPassword])
 *   POST  /api/members/me/photo/stage     — multipart, field "file"
 *   POST  /api/members/me/photo           — claim a staged upload as the photo
 *   GET   /api/members/{id}/photo         — the photo bytes, fetched as an authenticated
 *                                           Blob (same reasoning as ExpenseDetail's
 *                                           viewAttachment: the access token lives in
 *                                           memory, never a cookie a bare <img> would send)
 *   GET   /api/blood-types, GET /api/skills — reference lists for the two dropdowns
 *
 * Empty state: N/A. An authenticated member always has a profile row; this screen only
 * has loading/error/loaded states.
 */
export function Profile() {
  const profileQuery = useQuery({
    queryKey: ["member-profile"],
    queryFn: () => api.get<MemberProfileResponse>("/api/members/me"),
    retry: false,
  });

  const bloodTypesQuery = useQuery({
    queryKey: ["blood-types"],
    queryFn: () => api.get<BloodTypeOption[]>("/api/blood-types"),
    staleTime: 5 * 60_000,
  });
  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<SkillOption[]>("/api/skills"),
    staleTime: 5 * 60_000,
  });
  // Bare-array responses, not the {items,total,...} Paged<T> shape most GETs here use —
  // guarded rather than trusted, the same reasoning as AnnouncementNew's bloodTypeOptions.
  const bloodTypeOptions = Array.isArray(bloodTypesQuery.data) ? bloodTypesQuery.data : [];
  const skillOptions = Array.isArray(skillsQuery.data) ? skillsQuery.data : [];

  const data = profileQuery.data;

  const [form, setForm] = useState<FormState | null>(null);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (data && !initialized) {
      setForm(buildForm(data));
      setInitialized(true);
    }
  }, [data, initialized]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  const [photoObjectUrl, setPhotoObjectUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetches the photo as an authenticated Blob and turns it into an object URL — a plain
  // <img src={photoUrl}> would send no Authorization header and 401 (see api.download's
  // own header comment). Re-runs on photoVersion so a freshly claimed photo is re-fetched
  // even though the URL string itself never changes (it's always /api/members/{id}/photo).
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadPhoto() {
      if (!data?.photoUrl) {
        setPhotoObjectUrl(null);
        return;
      }
      setPhotoLoading(true);
      try {
        const file: DownloadedFile = await api.download(data.photoUrl);
        objectUrl = URL.createObjectURL(file.blob);
        if (!cancelled) setPhotoObjectUrl(objectUrl);
      } catch {
        // Same anti-enumeration 404 GetPhoto gives for "no photo on file" — treat it as
        // plainly having no photo, never as an error banner.
        if (!cancelled) setPhotoObjectUrl(null);
      } finally {
        if (!cancelled) setPhotoLoading(false);
      }
    }

    void loadPhoto();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data?.photoUrl, photoVersion]);

  if (profileQuery.isLoading) return <ScreenSkeleton rows={8} />;
  if (profileQuery.error) {
    return (
      <ErrorState
        message={(profileQuery.error as Error).message}
        onRetry={() => profileQuery.refetch()}
      />
    );
  }
  if (!data || !form) return <ScreenSkeleton rows={8} />;

  const mobileChanged = form.mobileNo.trim() !== (data.mobileNo ?? "").trim();

  async function handleRefreshAfterConflict() {
    const fresh = await profileQuery.refetch();
    if (fresh.data) setForm(buildForm(fresh.data));
    setConflictNotice(null);
  }

  /**
   * PATCH /api/members/me is a full-replace, not a partial patch, despite the verb —
   * see UpdateMemberProfileRequest / usp_Member_UpdateOwnProfile: every field in the
   * body below is written unconditionally, so ALL of them are sent every time, not just
   * the ones the member actually touched. Omitting one here would clear it server-side.
   */
  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form || !data) return;
    setSaveError(null);
    setSaving(true);

    const payload: {
      giftName: string; birthDate: string | null; dateSurvive: string | null;
      presidentDuringSurvive: string | null; masterInitiatorDuringSurvive: string | null;
      mobileNo: string; email: string | null; address: string | null;
      bloodTypeId: number | null; bloodTypeConfirmed: boolean; profession: string | null;
      skillIds: number[]; rowVersion: string; currentPassword?: string;
    } = {
      giftName: form.giftName.trim(),
      birthDate: form.birthdate || null,
      dateSurvive: form.dateSurvive || null,
      presidentDuringSurvive: form.presidentDuringSurvive.trim() || null,
      masterInitiatorDuringSurvive: form.masterInitiatorDuringSurvive.trim() || null,
      mobileNo: form.mobileNo.trim(),
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      bloodTypeId: form.bloodTypeId,
      bloodTypeConfirmed: form.bloodTypeConfirmed,
      profession: form.profession.trim() || null,
      skillIds: form.skillIds,
      rowVersion: form.rowVersion,
    };
    if (mobileChanged) payload.currentPassword = form.currentPassword;

    try {
      await api.patch<ProfileUpdatedResponse>("/api/members/me", payload);
      const fresh = await profileQuery.refetch();
      if (fresh.data) setForm(buildForm(fresh.data));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictNotice(
          err.message || "This profile changed since you loaded it. Refresh and try again.");
      } else if (err instanceof ApiError) {
        // Covers the 400 "enter your current password" and the 401 "wrong password" —
        // the server's own message, surfaced verbatim, right by the field it concerns.
        // The form itself is left exactly as the member typed it; nothing is cleared.
        setSaveError(err.message);
      } else {
        setSaveError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be re-picked after a retry
    if (!file) return;

    setPhotoUploadError(null);

    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      setPhotoUploadError("That photo is too large. Photos up to 4 MB are accepted.");
      return;
    }

    setPhotoUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const staged = await api.upload<PhotoStagedResponse>("/api/members/me/photo/stage", formData);
      await api.post<PhotoClaimedResponse>(
        "/api/members/me/photo", { attachmentStagingId: staged.attachmentStagingId });
      setPhotoVersion(v => v + 1);
      await profileQuery.refetch();
    } catch (err) {
      // A rejected file (too large, wrong type) shows its own message here and lets the
      // member pick a different one — it never blocks the rest of the form.
      setPhotoUploadError(err instanceof ApiError ? err.message : "Could not upload that photo. Please try again.");
    } finally {
      setPhotoUploading(false);
    }
  }

  const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(" ");

  return (
    <div style={{ padding: "20px 20px 40px" }}>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 22, letterSpacing: ".03em" }}>
        Your profile
      </h1>

      {conflictNotice && (
        <div role="alert" style={conflictBannerStyle}>
          <p style={{ margin: 0 }}>{conflictNotice}</p>
          <button type="button" onClick={() => { void handleRefreshAfterConflict(); }} style={refreshLinkStyle}>
            Refresh
          </button>
        </div>
      )}

      {/* "Your record" — the parts still officer-only. Member number, legal name,
          chapter, status and renewal are organizational/scoping state (CLAUDE.md
          invariant #4) — never a member self-edit, no <input> here for any of them.
          Gift name, birthdate and survive-history moved into the editable form below;
          those are the member's own personal identity/history, not org state. */}
      <div data-testid="profile-readonly">
        <div style={sectionLabelStyle}>Your record</div>
        <div style={cardStyle}>
          <ReadRow label="Member number" value={data.memberNumber} mono />
          <ReadRow label="Full name" value={fullName} />
          <ReadRow label="Chapter" value={data.chapterName ?? "—"} />
          <ReadRow label="Status" value={data.status ?? "—"} />
          <ReadRow label="Renewal" value={validThrough(data.renewedThrough)} />
        </div>
        <p style={noteStyle}>
          Something wrong here? Ask your chapter Secretary to correct it.
        </p>
      </div>

      <form onSubmit={e => { void handleSave(e); }}>
        <div style={sectionLabelStyle}>Identity &amp; history</div>

        <label htmlFor="giftName" style={labelStyle}>Gift name</label>
        <input
          id="giftName" value={form.giftName}
          onChange={e => setForm(f => f && { ...f, giftName: e.target.value })}
          style={fieldStyle}
        />

        <label htmlFor="birthdate" style={labelStyle}>Birthdate</label>
        <input
          id="birthdate" type="date" value={form.birthdate}
          onChange={e => setForm(f => f && { ...f, birthdate: e.target.value })}
          style={fieldStyle}
        />

        <label htmlFor="dateSurvive" style={labelStyle}>Date survive</label>
        <input
          id="dateSurvive" type="date" value={form.dateSurvive}
          onChange={e => setForm(f => f && { ...f, dateSurvive: e.target.value })}
          style={fieldStyle}
        />

        <label htmlFor="presidentDuringSurvive" style={labelStyle}>President during survive</label>
        <input
          id="presidentDuringSurvive" value={form.presidentDuringSurvive}
          onChange={e => setForm(f => f && { ...f, presidentDuringSurvive: e.target.value })}
          style={fieldStyle}
        />

        <label htmlFor="masterInitiatorDuringSurvive" style={labelStyle}>Master initiator</label>
        <input
          id="masterInitiatorDuringSurvive" value={form.masterInitiatorDuringSurvive}
          onChange={e => setForm(f => f && { ...f, masterInitiatorDuringSurvive: e.target.value })}
          style={fieldStyle}
        />

        <div style={sectionLabelStyle}>Contact &amp; details</div>

        <label htmlFor="email" style={labelStyle}>Email</label>
        <input
          id="email" type="email" value={form.email}
          onChange={e => setForm(f => f && { ...f, email: e.target.value })}
          placeholder="you@example.com" style={fieldStyle}
        />

        <label htmlFor="address" style={labelStyle}>Address</label>
        <input
          id="address" value={form.address}
          onChange={e => setForm(f => f && { ...f, address: e.target.value })}
          style={fieldStyle}
        />

        <label htmlFor="profession" style={labelStyle}>Profession</label>
        <input
          id="profession" value={form.profession}
          onChange={e => setForm(f => f && { ...f, profession: e.target.value })}
          style={fieldStyle}
        />

        <label style={labelStyle}>Skills</label>
        <div style={skillsGridStyle}>
          {skillOptions.map(s => {
            const checked = form.skillIds.includes(s.skillId);
            return (
              <label key={s.skillId} style={skillChipStyle(checked)}>
                <input
                  type="checkbox" checked={checked}
                  onChange={e => setForm(f => {
                    if (!f) return f;
                    const skillIds = e.target.checked
                      ? [...f.skillIds, s.skillId]
                      : f.skillIds.filter(id => id !== s.skillId);
                    return { ...f, skillIds };
                  })}
                  style={{ marginRight: 6 }}
                />
                {s.skillName}
              </label>
            );
          })}
          {skillOptions.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--mute)" }}>No skills are on file to choose from yet.</p>
          )}
        </div>

        <div style={sectionLabelStyle}>Mobile number</div>
        <label htmlFor="mobileNo" style={labelStyle}>Mobile number</label>
        <input
          id="mobileNo" value={form.mobileNo} inputMode="tel"
          onChange={e => setForm(f => f && { ...f, mobileNo: e.target.value })}
          style={fieldStyle}
        />

        {mobileChanged && (
          <>
            <label htmlFor="currentPassword" style={labelStyle}>Current password</label>
            <input
              id="currentPassword" type="password" autoComplete="current-password"
              value={form.currentPassword}
              onChange={e => setForm(f => f && { ...f, currentPassword: e.target.value })}
              style={fieldStyle}
            />
            <p style={hintStyle}>
              Required because you're changing your mobile number from what's on file.
            </p>
          </>
        )}

        {saveError && <p role="alert" style={errorTextStyle}>{saveError}</p>}

        <div style={sectionLabelStyle}>Blood type</div>
        <label htmlFor="bloodTypeId" style={labelStyle}>Blood type</label>
        <select
          id="bloodTypeId" value={form.bloodTypeId ?? ""}
          onChange={e => setForm(f => f && {
            ...f,
            bloodTypeId: e.target.value === "" ? null : Number(e.target.value),
            bloodTypeConfirmed: false,
          })}
          style={fieldStyle}
        >
          <option value="">Not set</option>
          {bloodTypeOptions.map(b => (
            <option key={b.bloodTypeId} value={b.bloodTypeId}>{b.bloodTypeName}</option>
          ))}
        </select>

        {/* A genuinely separate, deliberate step — never pre-checked, never implied by
            merely having picked a value from the dropdown above. Docs §8: this is a
            self-report, confirmed on a date, never "verified". */}
        <label style={toggleRowStyle}>
          <input
            type="checkbox" data-testid="blood-type-confirm" checked={form.bloodTypeConfirmed}
            disabled={form.bloodTypeId == null}
            onChange={e => setForm(f => f && { ...f, bloodTypeConfirmed: e.target.checked })}
          />
          <span>I confirm this is correct</span>
        </label>

        <p style={hintStyle}>
          {data.bloodTypeConfirmedDateUtc
            ? `Self-reported, confirmed ${shortDate(data.bloodTypeConfirmedDateUtc)}`
            : "Not yet confirmed."}
        </p>

        <button
          type="submit" disabled={saving}
          style={{ ...buttonStyle, opacity: saving ? 0.7 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <div style={sectionLabelStyle}>Photo</div>
      <div style={{ textAlign: "center", padding: "8px 0 20px" }}>
        {photoLoading ? (
          <div style={avatarStyle} aria-busy="true" />
        ) : photoObjectUrl ? (
          <img src={photoObjectUrl} alt="" style={{ ...avatarStyle, objectFit: "cover" }} />
        ) : (
          <div style={avatarStyle}>{(data.giftName || "—").slice(0, 2)}</div>
        )}

        <div>
          <button
            type="button" disabled={photoUploading}
            onClick={() => fileInputRef.current?.click()}
            style={changePhotoLinkStyle}
          >
            {photoUploading ? "Uploading…" : "Change photo"}
          </button>
        </div>
        <input
          ref={fileInputRef} type="file" accept={PHOTO_ACCEPT}
          onChange={e => { void handlePhotoPicked(e); }} style={{ display: "none" }}
        />

        {photoUploadError && <p role="alert" style={{ ...errorTextStyle, textAlign: "center" }}>{photoUploadError}</p>}
      </div>

      <ChangePasswordSection />

      <NotificationSettings />
    </div>
  );
}

/**
 * POST /api/auth/change-password — a separate action from the profile PATCH above (a
 * different endpoint, its own current-password check server-side). Deliberately its own
 * small form with its own local state: a wrong current password or a too-short new one
 * must never disturb whatever the member was mid-editing in the profile form above it.
 */
function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (newPassword.length < 10) {
      setError("Your new password must be at least 10 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Those two passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/api/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Your current password is incorrect.");
      } else if (err instanceof ApiError && err.errors) {
        setError(Object.values(err.errors).flat().join(" "));
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={sectionLabelStyle}>Password</div>
      <form onSubmit={e => { void handleSubmit(e); }}>
        <label htmlFor="currentPassword2" style={labelStyle}>Current password</label>
        <input
          id="currentPassword2" type="password" autoComplete="current-password"
          value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
          style={fieldStyle}
        />

        <label htmlFor="newPassword" style={labelStyle}>New password</label>
        <input
          id="newPassword" type="password" autoComplete="new-password"
          value={newPassword} onChange={e => setNewPassword(e.target.value)}
          style={fieldStyle}
        />
        <p style={hintStyle}>At least 10 characters.</p>

        <label htmlFor="confirmPassword" style={labelStyle}>Confirm new password</label>
        <input
          id="confirmPassword" type="password" autoComplete="new-password"
          value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
          style={fieldStyle}
        />

        {error && <p role="alert" style={errorTextStyle}>{error}</p>}
        {done && <p style={{ ...hintStyle, color: "var(--in)" }}>Password changed.</p>}

        <button
          type="submit" disabled={submitting}
          style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}
        >
          {submitting ? "Changing…" : "Change password"}
        </button>
      </form>
    </div>
  );
}

function ReadRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={readRowStyle}>
      <span style={readLabelStyle}>{label}</span>
      <span className={mono ? "num" : undefined} style={readValueStyle}>{value}</span>
    </div>
  );
}

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "18px 0 8px",
};

const cardStyle: CSSProperties = {
  padding: 14, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)",
};

const readRowStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0",
  borderBottom: "1px solid var(--line)", fontSize: 13,
};

const readLabelStyle: CSSProperties = { color: "var(--mute)" };
const readValueStyle: CSSProperties = { color: "var(--ink)", textAlign: "right" };

const noteStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 8, lineHeight: 1.6 };

const labelStyle: CSSProperties = {
  display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6, marginTop: 18,
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 8, lineHeight: 1.6 };

const errorTextStyle: CSSProperties = { fontSize: 13, color: "var(--out)", lineHeight: 1.5, marginTop: 10 };

const skillsGridStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 };

function skillChipStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", minHeight: 38, padding: "0 12px",
    borderRadius: 16, fontSize: 13, border: "1px solid var(--line)",
    background: active ? "var(--deep)" : "var(--paper)",
    color: active ? "var(--brass-soft)" : "var(--slate)",
  };
}

const toggleRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, marginTop: 12, minHeight: "var(--tap)", fontSize: 14,
};

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};

const avatarStyle: CSSProperties = {
  width: 84, height: 84, borderRadius: "50%", margin: "0 auto", background: "var(--deep)",
  color: "var(--brass-soft)", display: "grid", placeItems: "center",
  fontFamily: "var(--f-disp)", fontSize: 26,
};

const changePhotoLinkStyle: CSSProperties = {
  marginTop: 10, fontSize: 12.5, color: "var(--info)", textDecoration: "underline",
  minHeight: "var(--tap)", padding: "0 8px",
};

const conflictBannerStyle: CSSProperties = {
  marginTop: 16, padding: 12, borderRadius: "var(--r)", background: "#FBF4E4",
  border: "1px solid #E7D6A8", color: "var(--warn)", fontSize: 12.5, lineHeight: 1.5,
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
};

const refreshLinkStyle: CSSProperties = {
  flex: "none", fontSize: 12.5, fontWeight: 600, color: "var(--warn)", textDecoration: "underline",
  minHeight: 36,
};
