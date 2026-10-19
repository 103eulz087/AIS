/** Small helpers shared by the Payment report and its member list panel. */

/** "Iligan City Council" -> "Iligan City". */
export function placeLabel(n: string | null): string | null {
  if (!n) return null;
  const t = n.replace(/\s+Council$/i, "").trim();
  return t.length > 0 ? t : null;
}

export function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function downloadCsv(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
