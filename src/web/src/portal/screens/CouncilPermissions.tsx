import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { shortDate, shortTime } from "@/shared/format";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import type {
  CouncilPermissionCell, CouncilPermissionChange, CouncilPermissionGrid, CouncilPermissionKey,
  CouncilPermissionOffice, UpdateCouncilPermissionsResponse,
} from "@/shared/types";

const DELIM = "::";

function cellKey(councilOfficeId: number, permissionKey: string): string {
  return `${councilOfficeId}${DELIM}${permissionKey}`;
}

function splitCellKey(key: string): { councilOfficeId: number; permissionKey: string } {
  const i = key.indexOf(DELIM);
  return { councilOfficeId: Number(key.slice(0, i)), permissionKey: key.slice(i + DELIM.length) };
}

function findCell(grid: CouncilPermissionGrid, councilOfficeId: number, permissionKey: string): CouncilPermissionCell | undefined {
  return grid.cells.find(c => c.councilOfficeId === councilOfficeId && c.permissionKey === permissionKey);
}

/**
 * Client-side mirror of usp_CouncilPermission_Set's own "requires Review" rule
 * (db/schema/28_council_permissions.sql: Verify/Approve/Return each RequiresKey
 * ChapterRegistration.Review) — turning Review off for an office cascades its
 * Verify/Approve/Return off too; turning one of those on cascades Review on first. This
 * is a convenience only, so an ordinary save never round-trips a 400 — the server
 * computes and enforces the real rule regardless, and ApiError.message from a PUT is
 * always surfaced verbatim either way (e.g. if two officers edit the same grid at once).
 * Written to cope with any depth of RequiresKey chaining, though phase 1 only ever
 * nests one level deep.
 */
function cascadeToggle(
  grid: CouncilPermissionGrid, overrides: Record<string, boolean>,
  councilOfficeId: number, permissionKey: string, nextValue: boolean,
): Record<string, boolean> {
  const next = { ...overrides };
  const permByKey = new Map(grid.permissions.map(p => [p.permissionKey, p]));

  function effective(officeId: number, key: string): boolean {
    const k = cellKey(officeId, key);
    if (k in next) return next[k] ?? false;
    return findCell(grid, officeId, key)?.isGranted ?? false;
  }

  function setValue(officeId: number, key: string, value: boolean) {
    const cell = findCell(grid, officeId, key);
    if (!cell || cell.isLocked) return;
    const k = cellKey(officeId, key);
    if (value === cell.isGranted) delete next[k]; else next[k] = value;
  }

  // Mutates `next` (via the closures above) rather than returning a fresh object per
  // call, so cascading through MULTIPLE dependents of the same key (not just the first)
  // all land in the same diff — an early-return-per-branch version of this would
  // silently drop every dependent after the first.
  function applyCascade(officeId: number, key: string, value: boolean) {
    setValue(officeId, key, value);
    if (!value) {
      // Cascade OFF to every key that requires this one, if currently effectively granted.
      for (const dep of grid.permissions.filter(p => p.requiresKey === key)) {
        if (effective(officeId, dep.permissionKey)) applyCascade(officeId, dep.permissionKey, false);
      }
    } else {
      // Cascade ON to the key this one itself requires, if not already effectively granted.
      const required = permByKey.get(key)?.requiresKey;
      if (required && !effective(officeId, required)) applyCascade(officeId, required, true);
    }
  }

  applyCascade(councilOfficeId, permissionKey, nextValue);
  return next;
}

/**
 * GET /api/councils/{councilId}/permissions — one council's own permission grid: which
 * office may do what, on that council (phase 1 "dynamic council office permissions",
 * 2026-10-17). PUT /api/councils/{councilId}/permissions saves only the cells actually
 * changed. Any council seat may VIEW this screen; only that council's own currently-
 * seated President (header.canEdit) may change it — db/schema/28_council_permissions.sql's
 * own header: there is deliberately no separate "manage permissions" key to delegate this
 * away with, so the toggles stay disabled, and Save absent, for everyone else.
 *
 * Reached from PortalShell's "Office permissions" link, shown to any signed-in member
 * holding at least one council seat at all — including an Auditor, who holds nothing by
 * default but should still be able to see that for himself.
 */
export function CouncilPermissions() {
  const { claims, reloadClaims } = useAuth();
  const seats = claims?.councilSeats ?? [];

  const defaultCouncilId = useMemo(() => {
    if (seats.length === 0) return null;
    const mine = seats.find(s => s.canManagePermissions) ?? seats[0];
    return mine ? mine.councilId : null;
  }, [seats]);

  const [councilId, setCouncilId] = useState<number | null>(defaultCouncilId);
  const activeCouncilId = councilId ?? defaultCouncilId;

  const { data: grid, error, isLoading, refetch } = useQuery({
    queryKey: ["council-permissions", activeCouncilId],
    queryFn: () => api.get<CouncilPermissionGrid>(`/api/councils/${activeCouncilId}/permissions`),
    enabled: activeCouncilId !== null,
    retry: false,
  });

  // officeId::permissionKey -> the value the officer has chosen, ONLY for cells that
  // differ from the cell's own current isGranted — so this map IS the diff, never a
  // full copy of the grid's state.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function effectiveGranted(officeId: number, permissionKey: string): boolean {
    const k = cellKey(officeId, permissionKey);
    if (k in overrides) return overrides[k] ?? false;
    return (grid && findCell(grid, officeId, permissionKey)?.isGranted) ?? false;
  }

  function toggle(officeId: number, permissionKey: string) {
    if (!grid) return;
    const nextValue = !effectiveGranted(officeId, permissionKey);
    setOverrides(prev => cascadeToggle(grid, prev, officeId, permissionKey, nextValue));
  }

  function switchCouncil(id: number) {
    setCouncilId(id);
    setOverrides({});
    setConfirming(false);
    setSaveError(null);
  }

  if (seats.length === 0) {
    return (
      <EmptyState
        title="No council seat on file"
        body="This screen shows what each office on your council may do. You aren't currently seated on any council."
      />
    );
  }

  if (activeCouncilId === null) return null;

  const pendingChanges: CouncilPermissionChange[] = Object.entries(overrides).map(([key, isGranted]) => {
    const { councilOfficeId, permissionKey } = splitCellKey(key);
    return { councilOfficeId, permissionKey, isGranted };
  });

  async function handleSave() {
    if (activeCouncilId === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put<UpdateCouncilPermissionsResponse>(`/api/councils/${activeCouncilId}/permissions`, {
        changes: pendingChanges, reason: reason.trim() || null,
      });
      setOverrides({});
      setReason("");
      setConfirming(false);
      await refetch();
      await reloadClaims();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ paddingBottom: 32 }}>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>Office permissions</h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6, lineHeight: 1.6 }}>
        What each office on your council may do — reviewing chapter registrations, verifying
        officers, approving or returning one, viewing statistics, and searching members.
      </p>

      {seats.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <label htmlFor="councilPicker" style={labelStyle}>Council</label>
          <select
            id="councilPicker" value={activeCouncilId}
            onChange={e => switchCouncil(Number(e.target.value))}
            style={selectStyle}
          >
            {seats.map(s => (
              <option key={s.councilId} value={s.councilId}>
                {s.councilName} — your office: {s.officeName}
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading ? (
        <ScreenSkeleton rows={6} />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : !grid ? null : grid.offices.length === 0 ? (
        <EmptyState title="Nothing to show" body="This council has no offices on file yet." />
      ) : (
        <GridView
          grid={grid}
          effectiveGranted={effectiveGranted}
          onToggle={toggle}
          pendingChanges={pendingChanges}
          confirming={confirming}
          onOpenConfirm={() => setConfirming(true)}
          onCancelConfirm={() => setConfirming(false)}
          reason={reason}
          onReasonChange={setReason}
          saving={saving}
          saveError={saveError}
          onSave={() => { void handleSave(); }}
        />
      )}
    </div>
  );
}

function GridView({
  grid, effectiveGranted, onToggle, pendingChanges, confirming,
  onOpenConfirm, onCancelConfirm, reason, onReasonChange, saving, saveError, onSave,
}: {
  grid: CouncilPermissionGrid;
  effectiveGranted: (officeId: number, permissionKey: string) => boolean;
  onToggle: (officeId: number, permissionKey: string) => void;
  pendingChanges: CouncilPermissionChange[];
  confirming: boolean;
  onOpenConfirm: () => void;
  onCancelConfirm: () => void;
  reason: string;
  onReasonChange: (v: string) => void;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
}) {
  const { header, offices, permissions, history } = grid;
  const permissionsByKey = new Map(permissions.map(p => [p.permissionKey, p]));

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 18, letterSpacing: ".02em" }}>
          {header.councilName}{header.isNational && <span style={pillStyle}>National</span>}
        </div>
      </div>

      {!header.canEdit && (
        <p style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 6, lineHeight: 1.6 }}>
          You can see this council's permissions, but only {header.councilName}'s own President can change them.
        </p>
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {offices.map(office => (
          <OfficeCard
            key={office.id}
            office={office}
            permissions={permissions}
            grid={grid}
            canEdit={header.canEdit}
            effectiveGranted={effectiveGranted}
            onToggle={onToggle}
          />
        ))}
      </div>

      {header.canEdit && (
        <div style={{ marginTop: 20 }}>
          {!confirming ? (
            <button
              type="button" disabled={pendingChanges.length === 0}
              onClick={onOpenConfirm}
              style={{
                ...primaryButtonStyle,
                opacity: pendingChanges.length === 0 ? 0.5 : 1,
                cursor: pendingChanges.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              Save changes{pendingChanges.length > 0 ? ` (${pendingChanges.length})` : ""}
            </button>
          ) : (
            <div style={confirmPanelStyle}>
              <div style={{ fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".03em" }}>
                {pendingChanges.length} change{pendingChanges.length === 1 ? "" : "s"} to save
              </div>
              <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
                {pendingChanges.map(c => {
                  const office = offices.find(o => o.id === c.councilOfficeId);
                  const perm = permissionsByKey.get(c.permissionKey);
                  return (
                    <li key={`${c.councilOfficeId}-${c.permissionKey}`} style={changeRowStyle}>
                      <span style={{ fontWeight: 600 }}>{office?.name ?? "Office"}</span>
                      {" — "}{perm?.displayName ?? c.permissionKey}{": "}
                      <span style={{ color: c.isGranted ? "var(--in)" : "var(--out)" }}>
                        {c.isGranted ? "Granted" : "Revoked"}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <label htmlFor="permissionReason" style={{ ...labelStyle, marginTop: 14 }}>
                Reason (optional)
              </label>
              <input
                id="permissionReason" value={reason} onChange={e => onReasonChange(e.target.value)}
                maxLength={300} style={fieldStyle}
              />

              {saveError && <p role="alert" style={errorTextStyle}>{saveError}</p>}

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button type="button" onClick={onCancelConfirm} disabled={saving} style={ghostButtonStyle}>
                  Cancel
                </button>
                <button
                  type="button" disabled={saving} onClick={onSave}
                  style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? "Saving…" : "Confirm and save"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <div style={sectionLabelStyle}>Recent changes</div>
        {history.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--mute)", lineHeight: 1.6 }}>
            No changes have been made to this council's permissions yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map(h => (
              <div key={h.historyId} style={historyRowStyle}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{h.changedByGiftName}</span>{" "}
                  {h.isGranted ? "granted" : "revoked"}{" "}
                  <span style={{ fontWeight: 600 }}>{permissionsByKey.get(h.permissionKey)?.displayName ?? h.permissionKey}</span>
                  {" "}for {h.officeName}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 2 }}>
                  {shortDate(h.changedDateUtc)} · {shortTime(h.changedDateUtc)}
                </div>
                {h.reason && (
                  <div style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 4, lineHeight: 1.5 }}>{h.reason}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OfficeCard({ office, permissions, grid, canEdit, effectiveGranted, onToggle }: {
  office: CouncilPermissionOffice;
  permissions: CouncilPermissionKey[];
  grid: CouncilPermissionGrid;
  canEdit: boolean;
  effectiveGranted: (officeId: number, permissionKey: string) => boolean;
  onToggle: (officeId: number, permissionKey: string) => void;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ fontFamily: "var(--f-disp)", fontSize: 15, letterSpacing: ".02em" }}>
        {office.name}
      </div>

      {office.isPresiding ? (
        <p style={{ fontSize: 12.5, color: "var(--slate)", marginTop: 8, lineHeight: 1.6 }}>
          The President always has every permission below. This cannot be changed.
        </p>
      ) : (
        <>
          {office.isReadOnly && (
            <p style={{ fontSize: 11.5, color: "var(--mute)", marginTop: 4, lineHeight: 1.5 }}>
              A read-only office — it may never hold a permission that changes a record.
            </p>
          )}
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {permissions.map(permission => {
              const cell = findCell(grid, office.id, permission.permissionKey);
              const granted = effectiveGranted(office.id, permission.permissionKey);
              const locked = cell?.isLocked ?? false;
              const requiresLabel = permission.requiresKey
                ? permissions.find(p => p.permissionKey === permission.requiresKey)?.displayName ?? permission.requiresKey
                : null;

              return (
                <div key={permission.permissionKey} style={permissionRowStyle}>
                  <label style={permissionLabelStyle}>
                    <input
                      type="checkbox"
                      checked={granted}
                      disabled={!canEdit || locked}
                      onChange={() => onToggle(office.id, permission.permissionKey)}
                      aria-label={`${office.name} — ${permission.displayName}`}
                      style={checkboxStyle}
                    />
                    <span>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{permission.displayName}</span>
                      {permission.description && (
                        <span style={{ display: "block", fontSize: 12, color: "var(--slate)", marginTop: 2, lineHeight: 1.5 }}>
                          {permission.description}
                        </span>
                      )}
                      {requiresLabel && !locked && (
                        <span style={{ display: "block", fontSize: 11, color: "var(--mute)", marginTop: 2 }}>
                          Requires {requiresLabel}.
                        </span>
                      )}
                      {locked && cell?.lockReason && (
                        <span style={{ display: "block", fontSize: 11, color: "var(--mute)", marginTop: 2 }}>
                          {cell.lockReason}
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const cardStyle: CSSProperties = {
  padding: 16, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)",
};

const permissionRowStyle: CSSProperties = { paddingTop: 2 };

const permissionLabelStyle: CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 10, minHeight: "var(--tap)", cursor: "pointer",
};

const checkboxStyle: CSSProperties = { width: 20, height: 20, marginTop: 2, flex: "none" };

const pillStyle: CSSProperties = {
  marginLeft: 8, fontSize: 10.5, padding: "2px 8px", borderRadius: 10,
  background: "var(--bond)", color: "var(--slate)", border: "1px solid var(--line)",
};

const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6 };

const selectStyle: CSSProperties = {
  width: "100%", maxWidth: 420, minHeight: "var(--tap)", padding: "0 10px", borderRadius: 8, fontSize: 13.5,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "0 0 10px",
};

const historyRowStyle: CSSProperties = {
  padding: 12, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)",
};

const changeRowStyle: CSSProperties = { fontSize: 13, padding: "4px 0" };

const errorTextStyle: CSSProperties = { fontSize: 13, color: "var(--out)", lineHeight: 1.5, marginTop: 10 };

const ghostButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8, border: "1px solid var(--line)",
  background: "var(--paper)", color: "var(--slate)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".05em", textTransform: "uppercase",
};

const primaryButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase",
};

const confirmPanelStyle: CSSProperties = {
  marginTop: 10, padding: 16, borderRadius: "var(--r)", background: "var(--paper)",
  border: "1px solid var(--brass)",
};
