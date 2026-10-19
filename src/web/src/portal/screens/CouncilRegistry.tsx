import { useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canSeatCouncilOfficers, canViewCouncilRegistry } from "@/shared/roles";
import { ResponsiveTable } from "../responsive";
import type { CouncilRegistry, CreateCouncilRequest } from "@/shared/types";

interface Crumb { councilId: number; councilName: string }

/**
 * The council registry — every council in the focus council's own subtree, one row
 * each, in plain language: never constituted, dormant, or seated — never a bare officer
 * count or a green tick standing in for any of them. Reached from PortalShell's nav,
 * gated by canViewCouncilRegistry (any real council office); creating a council is
 * further gated by canSeatCouncilOfficers (CouncilAdmin), same as seating itself.
 *
 * GET /api/councils?councilId= — councilId omitted defaults to the caller's own
 * highest seat. The server validates whatever councilId this screen sends against the
 * caller's real dbo.fn_MemberCouncilScope regardless — CLAUDE.md invariant #4/#11.
 *
 * No delete control anywhere on this screen (invariant #15 — councils are never
 * deleted). A Dissolved council (isDissolved) would render as dissolved, not disappear —
 * though nothing in this codebase writes IsActive=0 yet, so this is untested territory
 * kept honest rather than hidden.
 */
export function CouncilRegistry() {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canView = canViewCouncilRegistry(roles);
  const canSeat = canSeatCouncilOfficers(roles);

  const [focusCouncilId, setFocusCouncilId] = useState<number | null>(null);
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["council-registry", focusCouncilId],
    queryFn: () => api.get<CouncilRegistry[]>(
      `/api/councils${focusCouncilId ? `?councilId=${focusCouncilId}` : ""}`),
    enabled: canView,
  });

  if (!canView) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only a seated council officer can view the council registry."
      />
    );
  }

  if (isLoading) return <ScreenSkeleton rows={6} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const rows = data ?? [];
  const focus = rows.find(r => r.depth === 0);
  const children = rows.filter(r => r.parentCouncilId === focus?.councilId);

  if (!focus) return <EmptyState title="No registry to show" body="You do not currently hold a council office." />;

  function drillInto(row: CouncilRegistry) {
    setTrail(t => [...t, { councilId: focus!.councilId, councilName: focus!.councilName }]);
    setFocusCouncilId(row.councilId);
  }
  function jumpToTrail(index: number) {
    const target = trail[index];
    if (!target) return;
    setTrail(t => t.slice(0, index));
    setFocusCouncilId(target.councilId);
  }
  function goHome() {
    setTrail([]);
    setFocusCouncilId(null);
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>Council registry</h1>

      <div data-tour="council-crumbs" style={{ padding: "6px 0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, fontSize: 12.5 }}>
        <button type="button" onClick={goHome} style={crumbButtonStyle}>Your council</button>
        {trail.map((c, i) => (
          <span key={c.councilId} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--mute)" }}>›</span>
            <button type="button" onClick={() => jumpToTrail(i)} style={crumbButtonStyle}>{c.councilName}</button>
          </span>
        ))}
        <span style={{ color: "var(--mute)" }}>›</span>
        <span style={{ color: "var(--ink)", fontWeight: 600, overflowWrap: "anywhere" }}>{focus.councilName}</span>
      </div>

      <CouncilStateCard row={focus} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "16px 0" }}>
        <Link to={`/portal/councils/${focus.councilId}`} style={primaryLinkStyle} data-tour="council-manage-link">View / manage officers</Link>
        {canSeat && (
          <button type="button" onClick={() => setShowCreate(s => !s)} style={ghostButtonStyle}>
            {showCreate ? "Cancel" : "Create a council beneath this one"}
          </button>
        )}
      </div>

      {showCreate && (
        <CreateCouncilForm
          parentCouncilId={focus.councilId}
          onDone={() => { setShowCreate(false); void refetch(); }}
        />
      )}

      {children.length === 0 ? (
        <EmptyState title="No councils beneath this one yet" body="Child councils appear here once created." />
      ) : (
        <>
          <div style={sectionLabelStyle}>Councils beneath {focus.councilName}</div>
          <ResponsiveTable
            rows={children}
            rowKey={r => r.councilId}
            columns={[
              { key: "council", header: "Council", primary: true,
                render: r => <button type="button" onClick={() => drillInto(r)} style={linkButtonStyle}
                  data-tour={r.councilId === children[0]?.councilId ? "council-child-first" : undefined}>{r.councilName}</button> },
              { key: "level", header: "Level", render: r => r.levelName },
              { key: "state", header: "State", render: r => <StateLabel row={r} /> },
              { key: "chapters", header: "Chapters", numeric: true, render: r => r.directChapterCount },
              { key: "members", header: "Members", numeric: true, render: r => r.directMemberCount },
            ]}
          />
        </>
      )}
    </div>
  );
}

function CouncilStateCard({ row }: { row: CouncilRegistry }) {
  return (
    <div data-tour="council-state" style={cardStyle}>
      <div style={{ fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".02em", overflowWrap: "anywhere" }}>{row.councilName}</div>
      <div style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 2 }}>{row.levelName}</div>
      <div style={{ marginTop: 10 }}><StateLabel row={row} detailed /></div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--slate)" }}>
        {row.directChildCouncilCount} child council{row.directChildCouncilCount === 1 ? "" : "s"} ·{" "}
        {row.directChapterCount} chapter{row.directChapterCount === 1 ? "" : "s"} ·{" "}
        {row.directMemberCount} member{row.directMemberCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function StateLabel({ row, detailed }: { row: CouncilRegistry; detailed?: boolean }) {
  if (row.isDissolved) {
    return <span style={{ color: "var(--mute)" }}>Dissolved</span>;
  }
  if (row.hasSeatedOfficers) {
    return (
      <span style={{ color: "var(--in)" }}>
        Seated — {row.seatedOfficerCount} officer{row.seatedOfficerCount === 1 ? "" : "s"}
      </span>
    );
  }
  if (row.neverConstituted) {
    return detailed ? (
      <span style={{ color: "var(--warn)" }}>
        No officers seated yet — this council was created automatically so that a chapter had somewhere to
        belong.
      </span>
    ) : (
      <span style={{ color: "var(--warn)" }}>Not yet constituted</span>
    );
  }
  // isDormant
  return detailed ? (
    <span style={{ color: "var(--out)" }}>
      Dormant — its officers' terms have ended. {row.directChapterCount} chapter{row.directChapterCount === 1 ? "" : "s"} {row.directChapterCount === 1 ? "is" : "are"} waiting on it.
    </span>
  ) : (
    <span style={{ color: "var(--out)" }}>Dormant</span>
  );
}

function CreateCouncilForm({ parentCouncilId, onDone }: { parentCouncilId: number; onDone: () => void }) {
  const [councilName, setCouncilName] = useState("");
  const [levelChoice, setLevelChoice] = useState<"region" | "province" | "municipality">("province");
  const [geographyId, setGeographyId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!councilName.trim()) { setError("Enter a council name."); return; }
    if (!geographyId) { setError("Enter the geography id for this level."); return; }

    setSubmitting(true);
    try {
      const req: CreateCouncilRequest = {
        parentCouncilId, councilName: councilName.trim(),
        regionId: levelChoice === "region" ? Number(geographyId) : null,
        provinceId: levelChoice === "province" ? Number(geographyId) : null,
        municipalityId: levelChoice === "municipality" ? Number(geographyId) : null,
      };
      await api.post("/api/councils", req);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={e => { void handleSubmit(e); }} style={cardStyle}>
      <p style={{ fontSize: 12.5, color: "var(--slate)", lineHeight: 1.6, marginBottom: 10 }}>
        This council starts with no officers until they are seated. Most councils are created
        automatically the moment a chapter registers into a new area — use this only when a council
        needs to exist before its first chapter is approved.
      </p>

      <label htmlFor="councilName" style={labelStyle}>Council name</label>
      <input id="councilName" value={councilName} onChange={e => setCouncilName(e.target.value)} style={fieldStyle} />

      <label htmlFor="level" style={labelStyle}>Level</label>
      <select id="level" value={levelChoice} onChange={e => setLevelChoice(e.target.value as typeof levelChoice)} style={fieldStyle}>
        <option value="region">Regional</option>
        <option value="province">Provincial</option>
        <option value="municipality">City/Municipal</option>
      </select>

      <label htmlFor="geographyId" style={labelStyle}>
        {levelChoice === "region" ? "Region id" : levelChoice === "province" ? "Province id" : "Municipality id"}
      </label>
      <input
        id="geographyId" value={geographyId} onChange={e => setGeographyId(e.target.value)}
        inputMode="numeric" style={fieldStyle}
      />

      {error && <p role="alert" style={errorStyle}>{error}</p>}

      <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}>
        {submitting ? "Creating…" : "Create council"}
      </button>
    </form>
  );
}

const cardStyle: CSSProperties = {
  padding: 16, borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)",
  marginTop: 12,
};

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "18px 0 8px",
};

const linkButtonStyle: CSSProperties = { color: "var(--info)", textDecoration: "underline", fontSize: 13.5, minHeight: "var(--tap)", textAlign: "left", overflowWrap: "anywhere" };

const crumbButtonStyle: CSSProperties = { color: "var(--info)", fontSize: 13, minHeight: "var(--tap)", padding: "0 6px", overflowWrap: "anywhere", textAlign: "left" };

const primaryLinkStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8, display: "flex", alignItems: "center",
  background: "var(--deep)", color: "var(--brass-soft)", textDecoration: "none",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase",
};

const ghostButtonStyle: CSSProperties = {
  minHeight: "var(--tap)", padding: "0 18px", borderRadius: 8,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--info)",
  fontFamily: "var(--f-disp)", fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase",
};

const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6, marginTop: 14 };

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--bond)", color: "var(--ink)",
};

const errorStyle: CSSProperties = { marginTop: 12, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 16, minHeight: "var(--tap)", padding: "0 20px", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".06em", textTransform: "uppercase",
};
