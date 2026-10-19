import { useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { ApiError, api } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { canManageAppSettings } from "@/shared/roles";
import { shortDate } from "@/shared/format";
import { MEMBER_ACCESS_KEY } from "@/shared/memberAccess";
import type { AppSettings as AppSettingsData, UpdateAppSettingsRequest } from "@/shared/types";

interface Draft { isTrialEnabled: boolean; trialDays: string; open: string[] }

const MIN_DAYS = 1;
const MAX_DAYS = 365;

/**
 * App settings — the free trial for members who have not been tagged Paid or Free for the
 * current membership year (client decision 2026-10-18). National sets it once for everyone.
 *
 * Endpoints:
 *  - GET /api/app-settings   (settings, feature list, and how many members each choice touches)
 *  - PUT /api/app-settings   { isTrialEnabled, trialDays, openFeatureKeys }  -> 204, then refetch
 *
 * Gate: canManageAppSettings (AppSettings.Manage, National only). Anyone else sees a plain
 * "no access" state and the GET is never sent. Real authority is re-derived server-side.
 *
 * Empty state: a brand-new database has no members, so the preview reads "Of 0 members" —
 * shown as a plain sentence, never an error. The feature list always comes from the server.
 *
 * Invariant #5: nothing here shows or implies an amount owed. A member whose free trial is
 * over is "limited", not "in arrears", and being limited is not disciplinary.
 */
export function AppSettings() {
  const { claims } = useAuth();
  const canManage = canManageAppSettings(claims?.councilSeats ?? []);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => api.get<AppSettingsData>("/api/app-settings"),
    enabled: canManage,
    retry: false,
  });

  // null until the officer changes something; the form then shows the server's values.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: UpdateAppSettingsRequest) => api.put<void>("/api/app-settings", body),
  });

  if (!canManage) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Your office does not have the 'Manage app settings' permission. Only the National Council can change these."
      />
    );
  }
  if (query.isLoading) return <ScreenSkeleton rows={4} />;
  if (query.error || !query.data) {
    return <ErrorState message={(query.error as Error | null)?.message} onRetry={() => query.refetch()} />;
  }

  const data = query.data;
  const features = Array.isArray(data.features) ? data.features : [];
  const preview = data.preview ?? { totalMembers: 0, paidMembers: 0, inTrialMembers: 0, trialOverMembers: 0 };

  const serverForm: Draft = {
    isTrialEnabled: data.isTrialEnabled,
    trialDays: String(data.trialDays),
    open: features.filter(f => f.isAlwaysOpen || f.isOpenAfterTrial).map(f => f.featureKey),
  };
  const form = draft ?? serverForm;
  const daysNumber = Number(form.trialDays);
  const daysValid = form.trialDays.trim() !== "" && Number.isInteger(daysNumber)
    && daysNumber >= MIN_DAYS && daysNumber <= MAX_DAYS;
  const dirty = draft !== null && (
    draft.isTrialEnabled !== serverForm.isTrialEnabled
    || draft.trialDays !== serverForm.trialDays
    || [...draft.open].sort().join("|") !== [...serverForm.open].sort().join("|"));

  function change(next: Partial<Draft>) {
    setSaved(false);
    setSaveError(null);
    setDraft({ ...form, ...next });
  }

  function toggleFeature(key: string) {
    change({ open: form.open.includes(key) ? form.open.filter(k => k !== key) : [...form.open, key] });
  }

  async function onSave() {
    if (!daysValid) return;
    setSaveError(null);
    try {
      await save.mutateAsync({
        isTrialEnabled: form.isTrialEnabled,
        trialDays: daysNumber,
        openFeatureKeys: form.open,
      });
      await query.refetch();
      void qc.invalidateQueries({ queryKey: MEMBER_ACCESS_KEY });
      setDraft(null);
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "That could not be saved. Please try again.");
    }
  }

  const warnOn = form.isTrialEnabled && dirty && preview.trialOverMembers > 0;

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>App settings</h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6, lineHeight: 1.5 }}>
        These apply to every member in every chapter. Signing in and each member's own profile always stay available.
        The council Portal is never affected.
      </p>

      <section style={cardStyle} aria-label="Free trial">
        <h2 style={h2Style}>Free trial</h2>
        <p style={helpStyle}>
          A member who is not tagged Paid or Free for this membership year can use the whole app for a number of days
          after he is approved. When the free trial is on and his days are over, only the features ticked below stay open.
        </p>

        <label style={rowStyle} data-tour="settings-trial-toggle">
          <input type="checkbox" role="switch" checked={form.isTrialEnabled} style={checkStyle}
            onChange={e => change({ isTrialEnabled: e.target.checked })} />
          <span style={{ fontWeight: 600 }}>
            {form.isTrialEnabled ? "Free trial is on" : "Free trial is off"}
          </span>
        </label>
        <p style={helpStyle}>
          {form.isTrialEnabled
            ? "Members outside their free trial are limited to the open features."
            : "Everyone keeps full use of the app."}
        </p>

        {warnOn && (
          <div role="alert" style={warnStyle}>
            Switching this on now will limit {preview.trialOverMembers} {preview.trialOverMembers === 1 ? "member" : "members"} whose
            free trial is already over, as soon as you save. They can still read announcements, and everything
            opens again once they are tagged Paid or Free.
          </div>
        )}

        <label htmlFor="trial-days" style={{ ...labelStyle, marginTop: 16 }}>Number of days</label>
        <input id="trial-days" data-tour="settings-days" type="number" inputMode="numeric" min={MIN_DAYS} max={MAX_DAYS} step={1}
          className="num" value={form.trialDays} onChange={e => change({ trialDays: e.target.value })}
          aria-invalid={!daysValid} style={daysInputStyle} />
        <p style={{ ...helpStyle, color: daysValid ? "var(--mute)" : "var(--out)" }}>
          {daysValid
            ? `Counted from the day a member is approved. Between ${MIN_DAYS} and ${MAX_DAYS} days.`
            : `Please enter a whole number of days from ${MIN_DAYS} to ${MAX_DAYS}.`}
        </p>

        <fieldset data-tour="settings-open-features" style={{ border: 0, padding: 0, margin: "18px 0 0" }}>
          <legend style={labelStyle}>Still open after the free trial ends</legend>
          {features.length === 0 && <p style={helpStyle}>No features are listed yet.</p>}
          {features.map(f => {
            const checked = f.isAlwaysOpen || form.open.includes(f.featureKey);
            return (
              <label key={f.featureKey} style={featureRowStyle}>
                <input type="checkbox" checked={checked} disabled={f.isAlwaysOpen} style={checkStyle}
                  onChange={() => toggleFeature(f.featureKey)} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{f.displayName}</span>
                  {f.isAlwaysOpen && <span style={pillStyle}>Always open</span>}
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--slate)", marginTop: 2, lineHeight: 1.4 }}>
                    {f.description}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div data-tour="settings-save" style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => { void onSave(); }}
            disabled={!dirty || !daysValid || save.isPending} style={saveButtonStyle(!dirty || !daysValid || save.isPending)}>
            {save.isPending ? "Saving…" : "Save settings"}
          </button>
          {dirty && !save.isPending && (
            <button type="button" onClick={() => { setDraft(null); setSaveError(null); }} style={linkButtonStyle}>
              Undo changes
            </button>
          )}
          {saved && !dirty && <span role="status" style={{ fontSize: 13, color: "var(--in)" }}>Saved.</span>}
        </div>
        {saveError && <p role="alert" style={{ marginTop: 8, fontSize: 13, color: "var(--out)" }}>{saveError}</p>}
        <p style={{ ...helpStyle, marginTop: 12 }}>
          {data.updatedDate
            ? `Last changed ${shortDate(data.updatedDate)}${data.updatedByGiftName ? ` by ${data.updatedByGiftName}` : ""}.`
            : "These settings have not been changed yet."}
        </p>
      </section>

      <section style={cardStyle} aria-label="Who this touches" data-tour="settings-preview">
        <h2 style={h2Style}>Who this touches</h2>
        <p style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.6 }}>
          Of <span className="num">{preview.totalMembers}</span> members:{" "}
          <span className="num">{preview.paidMembers}</span> paid or free this year,{" "}
          <span className="num">{preview.inTrialMembers}</span> still in their free trial,{" "}
          <span className="num">{preview.trialOverMembers}</span> whose free trial is over — they would be limited
          to the open features if the free trial is on.
        </p>
      </section>
    </div>
  );
}

const cardStyle: CSSProperties = {
  marginTop: 18, padding: 16, background: "var(--paper)", border: "1px solid var(--line)",
  borderRadius: "var(--r)", maxWidth: 720, minWidth: 0, overflowWrap: "anywhere",
};
const h2Style: CSSProperties = { fontFamily: "var(--f-disp)", fontSize: 18, letterSpacing: ".04em", marginBottom: 6 };
const helpStyle: CSSProperties = { fontSize: 12.5, color: "var(--mute)", lineHeight: 1.5, marginTop: 4 };
const labelStyle: CSSProperties = {
  display: "block", fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--slate)", marginBottom: 6,
};
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 12, minHeight: "var(--tap)", marginTop: 12, fontSize: 15 };
const featureRowStyle: CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 12, minHeight: "var(--tap)", padding: "10px 0", minWidth: 0,
  borderTop: "1px solid var(--line)",
};
const checkStyle: CSSProperties = { width: 22, height: 22, flex: "none", marginTop: 1, accentColor: "var(--deep)" };
const daysInputStyle: CSSProperties = {
  width: 120, maxWidth: "100%", minHeight: "var(--tap)", padding: "0 12px", border: "1px solid var(--line)",
  borderRadius: 8, fontSize: 16, background: "var(--paper)",
};
const pillStyle: CSSProperties = {
  marginLeft: 8, fontSize: 10.5, padding: "1px 7px", borderRadius: 8,
  background: "var(--bond)", color: "var(--slate)",
};
const warnStyle: CSSProperties = {
  marginTop: 10, padding: "10px 12px", borderRadius: 8, fontSize: 13, lineHeight: 1.5,
  background: "#FBF4E4", border: "1px solid var(--warn)", color: "var(--ink)",
};
const linkButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 6px", fontSize: 13, color: "var(--info)", textDecoration: "underline",
};
function saveButtonStyle(disabled: boolean): CSSProperties {
  return {
    minHeight: "var(--tap)", padding: "0 22px", borderRadius: 8, background: "var(--deep)",
    color: "var(--paper)", fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".08em",
    textTransform: "uppercase", opacity: disabled ? 0.5 : 1,
  };
}
