import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type DownloadedFile } from "@/shared/api";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";
import { useAuth } from "@/shared/auth";
import { canExportIdCards } from "@/shared/roles";
import type { ChapterPublic } from "@/shared/types";

/**
 * GET /api/id-card-exports?chapterId= — a ZIP (spreadsheet + member photos) for the
 * National Council's CouncilAdmin to bulk-print physical ID cards. chapterId is omitted
 * entirely for "All chapters" (the default); passed only when a specific chapter is
 * chosen. Fetched as an authenticated Blob via api.download() -> URL.createObjectURL,
 * the same pattern DigitalId.tsx/Profile.tsx use for a member photo and ExpenseDetail.tsx
 * uses for a receipt attachment — never a bare <a href> or <img src>, since this call
 * needs an Authorization header the browser has no other way to attach.
 *
 * This has a real side effect (usp_Credential_BulkIssueForExport bulk-issues any missing
 * member credentials) but is fully idempotent and safe to run more than once — see the
 * endpoint's own header comment (IdCardExportEndpoints.cs).
 *
 * GET /api/chapters — the same public, unauthenticated chapter list Apply.tsx already
 * uses for its own picker (ChapterPublic[]). Reused here as a flat, alphabetical list
 * rather than Apply's cascading Region -> Province -> City picker: this screen only
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
  const [exporting, setExporting] = useState(false);
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

  async function runExport() {
    setExportError(null);
    setExporting(true);
    try {
      const path = chapterId
        ? `/api/id-card-exports?chapterId=${chapterId}`
        : "/api/id-card-exports";
      const file: DownloadedFile = await api.download(path);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName === "download"
        ? `id-cards-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`
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
      setExporting(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>
        National ID card export
      </h1>
      <p style={{ fontSize: 13.5, color: "var(--slate)", marginTop: 6 }}>
        Download a ZIP of the member spreadsheet and photos for a physical ID card print run.
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

        <button
          type="button"
          onClick={() => { void runExport(); }}
          disabled={exporting}
          style={exportButtonStyle(exporting)}
        >
          {exporting ? "Preparing your export…" : "Download ZIP"}
        </button>

        {exporting && (
          <p style={{ fontSize: 12.5, color: "var(--mute)", marginTop: 10 }}>
            This can take a while for a large chapter list — photos are being packaged one
            by one. Please don't close this tab.
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

function exportButtonStyle(exporting: boolean): CSSProperties {
  return {
    marginTop: 16, minHeight: "var(--tap)", width: "100%", padding: "0 20px", borderRadius: 8,
    border: "1px solid var(--line)", background: exporting ? "var(--bond)" : "var(--deep)",
    color: exporting ? "var(--mute)" : "var(--paper)", fontFamily: "var(--f-disp)",
    fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase",
    cursor: exporting ? "default" : "pointer",
  };
}
