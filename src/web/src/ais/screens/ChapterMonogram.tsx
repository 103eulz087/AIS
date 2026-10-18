/**
 * The generated monogram — the default chapter mark shown before a chapter uploads its
 * own logo (docs/AIS-Project-Documentation.md §7A.3: "A generated monogram is the
 * default, so a chapter that has no logo file still looks finished on day one"). This
 * module itself still has no image upload — it's the live preview shown while petitioning
 * a new chapter (RegisterChapter.tsx/RegisterChapterStatus.tsx), before any logo can even
 * exist yet. The real upload (added 2026-09-29) lives in Profile.tsx's own "Chapter logo"
 * section, President-only, once the chapter is already chartered — DigitalId.tsx renders
 * this same component as the fallback there whenever credential.chapterLogoUrl is null.
 */
export function chapterInitials(chapterName: string): string {
  const words = chapterName.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  if (!second) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + second.charAt(0)).toUpperCase();
}

export function ChapterMonogram({ chapterName, hexValue, size = 72 }: {
  chapterName: string; hexValue: string; size?: number;
}) {
  return (
    <div
      role="img"
      aria-label={`Generated chapter mark for ${chapterName || "this chapter"}`}
      style={{
        width: size, height: size, borderRadius: size * 0.22, background: hexValue,
        color: "#FFFFFF", display: "grid", placeItems: "center", flex: "none",
        fontFamily: "var(--f-disp)", fontSize: size * 0.4, letterSpacing: ".02em",
      }}
    >
      {chapterInitials(chapterName)}
    </div>
  );
}
