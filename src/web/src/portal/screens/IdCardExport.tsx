import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type DownloadedFile } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canExportIdCards } from "@/shared/roles";
import type { ChapterPublic } from "@/shared/types";

/**
 * Two export types (client decision 2026-10-06), both National CouncilAdmin only, both
 * fetched as an authenticated Blob via api.download() -> URL.createObjectURL — the same
 * pattern DigitalId.tsx/Profile.tsx use for a member photo and ExpenseDetail.tsx uses for
 * a receipt attachment — never a bare <a href> or <img src>, since both calls need an
 * Authorization header the browser has no other way to attach:
 *
 *   GET /api/id-card-exports?chapterId=            — "Export Data": a ZIP (spreadsheet +
 *     member photos) for a physical Magicard card print run.
 *   GET /api/id-card-exports/digital-id?chapterId= — "Export Digital ID images": a ZIP of
 *     rendered front/back PNGs per member (DigitalIdCardRenderer.cs, server-side).
 *
 * chapterId is omitted entirely for "All chapters" (the default); passed only when a
 * specific chapter is chosen. Both have a real side effect
 * (usp_Credential_BulkIssueForExport bulk-issues any missing member credentials) but are
 * fully idempotent and safe to run more than once — see IdCardExportEndpoints.cs's own
 * header comment.
 *
 * GET /api/chapters — the public, unauthenticated chapter list (ChapterPublic[],
 * usp_Chapter_ListPublic). Consumed here as a flat, alphabetical list: this screen only
 * needs "pick one chapter or all of them," not a multi-step narrowing flow.
 *
 * Access gating: canExportIdCards (CouncilAdmin) is the same coarse, UI-only check
 * ChapterRegistrationQueue.tsx uses for its own screen — it does NOT try to guess
 * "National" specifically, since the app has no cheap client-side way to know that
 * without another round trip. A CouncilAdmin seated on some OTHER council sees this
 * screen and gets the plain 403 message below from the real request, exactly as the
 * endpoint's own comment describes: the client-side role check clears anyone who holds
 * CouncilAdmin anywhere, and the server's own procedure is the real, National-specific
 * gate (CLAUDE.md invariant #4/#11 — never trust the client to know more than the JWT).
 */
export function IdCardExport() {
  const { claims } = useAuth();
  const roles = claims?.roles ?? [];
  const canExport = canExportIdCards(roles);

  const chapters = useQuery({
    queryKey: ["public-chapters"],
    queryFn: () => api.get<ChapterPublic[]>("/api/chapters"),
    enabled: canExport,
    retry: false,
  });

  const [chapterId, setChapterId] = useState("");
  // Which of the two exports is in flight, if any — null means neither. Both buttons
  // disable while either runs (no real reason to let two large exports overlap).
  const [exporting, setExporting] = useState<"data" | "digital-id" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const rows = Array.isArray(chapters.data) ? chapters.data : [];
  const sortedChapters = useMemo(
    () => [...rows].sort((a, b) => a.chapterName.localeCompare(b.chapterName)),
    [rows],
  );

  if (!canExport) {
    return (
      <EmptyState
        title="You don't have access to this"
        body="Only the National Council Admin can run the ID card export."
      />
    );
  }

  async function runExport(kind: "data" | "digital-id") {
    setExportError(null);
    setExporting(kind);
    try {
      const basePath = kind === "data" ? "/api/id-card-exports" : "/api/id-card-exports/digital-id";
      const path = chapterId ? `${basePath}?chapterId=${chapterId}` : basePath;
      const fallbackName = kind === "data" ? "id-cards" : "digital-ids";
      const file: DownloadedFile = await api.download(path);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName === "download"
        ? `${fallbackName}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`
        : file.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setExportError("Only the National Council Admin can run this export.");
      } else if (err instanceof ApiError && err.status === 409) {
        setExportError("The National Council isn't set up yet.");
      } else if (err instanceof ApiError) {
        setExportError(err.message);
      } else {
        setExportError("Check your connection and try again.");
      }
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>
        National ID card export
      </h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        Two ways to export member ID cards — pick a chapter (or all of them), then choose
        which one you need.
      </p>

      <div style={panelStyle}>
        <label style={fieldLabelStyle} htmlFor="chapter-picker">Chapter</label>
        {chapters.isLoading ? (
          <ScreenSkeleton rows={1} />
        ) : chapters.error ? (
          <ErrorState
            message={(chapters.error as Error).message}
            onRetry={() => chapters.refetch()}
          />
        ) : (
          <select
            id="chapter-picker"
            value={chapterId}
            onChange={e => setChapterId(e.target.value)}
            style={fieldStyle}
          >
            <option value="">All chapters</option>
            {sortedChapters.map(c => (
              <option key={c.chapterId} value={c.chapterId}>
                {c.chapterName}
                {c.cityName ? ` — ${c.cityName}` : ""}
                {c.provinceName ? `, ${c.provinceName}` : ""}
              </option>
            ))}
          </select>
        )}

        <div style={exportOptionStyle}>
          <div>
            <div style={exportOptionTitleStyle}>1. Export Data</div>
            <p style={exportOptionBodyStyle}>
              The member spreadsheet (.xls) and photo folder for a physical ID card print
              run on the Magicard printer.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void runExport("data"); }}
            disabled={exporting !== null}
            style={exportButtonStyle(exporting !== null)}
          >
            {exporting === "data" ? "Preparing…" : "Download ZIP"}
          </button>
        </div>

        <div style={exportOptionStyle}>
          <div>
            <div style={exportOptionTitleStyle}>2. Export Digital ID images</div>
            <p style={exportOptionBodyStyle}>
              The actual digital ID card image, front and back, for each member — ready to
              view, print or share on its own.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void runExport("digital-id"); }}
            disabled={exporting !== null}
            style={exportButtonStyle(exporting !== null)}
          >
            {exporting === "digital-id" ? "Preparing…" : "Download ZIP"}
          </button>
        </div>

        {exporting && (
          <p style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 10 }}>
            This can take a while for a large chapter list — {exporting === "data" ? "photos" : "card images"} are
            being packaged one by one. Please don&rsquo;t close this tab.
          </p>
        )}

        {exportError && (
          <p style={{ fontSize: 13, color: "var(--out)", marginTop: 10 }}>{exportError}</p>
        )}
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  marginTop: 20, padding: 20, borderRadius: "var(--r)",
  background: "var(--paper)", border: "1px solid var(--line)", maxWidth: 480,
};

const fieldLabelStyle: CSSProperties = {
  display: "block", fontFamily: "var(--f-disp)", fontSize: 11.5, letterSpacing: ".08em",
  textTransform: "uppercase", color: "var(--mute)", marginBottom: 6,
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: 40, padding: "0 10px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const exportOptionStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 10, marginTop: 20,
  paddingTop: 16, borderTop: "1px solid var(--line)",
};

const exportOptionTitleStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 14, letterSpacing: ".04em", color: "var(--ink)",
};

const exportOptionBodyStyle: CSSProperties = {
  fontSize: 12.5, color: "var(--slate)", marginTop: 4, lineHeight: 1.5,
};

function exportButtonStyle(exporting: boolean): CSSProperties {
  return {
    marginTop: 16, minHeight: "var(--tap)", width: "100%", padding: "0 20px", borderRadius: 8,
    border: "1px solid var(--line)", background: exporting ? "var(--bond)" : "var(--deep)",
    color: exporting ? "var(--mute)" : "var(--paper)", fontFamily: "var(--f-disp)",
    fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
    cursor: exporting ? "default" : "pointer",
  };
}
