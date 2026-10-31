/**
 * Seminar screenshot harness — renders the REAL React app (src/web) with a DEMO-DATA
 * API mock (mock.cjs), so every screen can be captured without a backend or real
 * member data. Nothing here is used by the app, its tests, or CI.
 *
 *   cd src/web && npx vite --port 5173 --strictPort      # plain HTTP is fine here
 *   NODE_PATH=$(npm root -g) node scripts/screenshots/capture.cjs [regex-filter]
 *
 * Output: docs/seminar/screenshots/*.png (override with OUT=...).
 */
const { chromium } = require("playwright");
const { handle } = require("./mock.cjs");
const OUT = process.env.OUT || require("path").resolve(__dirname, "../../docs/seminar/screenshots");
const BASE = "http://localhost:5173";
const shots = [
  // [file, persona, path, viewport, opts]
  ["01-sign-in", null, "/sign-in", "phone"],
  ["02-home", "chapter", "/", "phone"],
  ["03-dashboard", "chapter", "/dashboard", "phone"],
  ["04-member-directory", "chapter", "/members", "phone"],
  ["05-profile", "chapter", "/profile", "phone"],
  ["06-join-chapter", null, "/j/7Kq2xZ9mVb", "phone"],
  ["07-application-queue", "chapter", "/applications", "phone"],
  ["08-application-detail", "chapter", "/applications/21", "phone"],
  ["09-invite-members", "chapter", "/invite", "phone"],
  ["10-officers", "chapter", "/officers/manage", "phone"],
  ["11-corrective-actions", "chapter", "/corrective-actions", "phone"],
  ["12-corrective-action-detail", "chapter", "/corrective-actions/3", "phone"],
  ["13-corrective-action-new", "chapter", "/corrective-actions/new", "phone"],
  ["14-digital-id", "chapter", "/digital-id", "phone"],
  ["14b-digital-id-back", "chapter", "/digital-id", "phone", { click: "Tap the card" }],
  ["15-scan-verified", "chapter", "/scan", "phone", { scan: true }],
  ["16-public-verify", null, "/verify/3f2a1c9e-89aa-4b7a-8f0a-5c1d2e3f4a5b", "phone"],
  ["17-meetings", "chapter", "/meetings", "phone"],
  ["18-meeting-attendance", "chapter", "/meetings/41", "phone"],
  ["19-ledger", "chapter", "/ledger", "phone"],
  ["20-activities", "chapter", "/activities", "phone"],
  ["21-expenses", "chapter", "/expenses", "phone"],
  ["22-expense-detail", "chapter", "/expenses/81", "phone"],
  ["23-donations", "chapter", "/donations", "phone"],
  ["24-announcements", "chapter", "/announcements", "phone"],
  ["25-announcement-urgent", "chapter", "/announcements/31", "phone"],
  ["26-memos", "chapter", "/memos", "phone"],
  ["27-chat", "chapter", "/chat", "phone"],
  ["28-register-chapter", null, "/register-chapter", "phone"],
  ["30-portal-registrations", "council", "/portal/chapter-registrations", "desktop"],
  ["31-portal-registration-detail", "council", "/portal/chapter-registrations/14", "desktop"],
  ["31b-portal-registration-dormant-routing", "council", "/portal/chapter-registrations/13", "desktop"],
  ["32-portal-councils", "council", "/portal/councils", "desktop"],
  ["33-portal-council-roster", "council", "/portal/councils/4", "desktop"],
  ["34-portal-statistics", "council", "/portal/statistics", "desktop"],
  ["35-portal-member-search", "council", "/portal/members", "desktop", { type: "input", text: "AKR-04" }],
  ["36-portal-chapter-holds", "council", "/portal/chapter-holds", "desktop", { type: "input", text: "Brgy" }],
  ["37-portal-id-card-export", "council", "/portal/id-card-export", "desktop"],
  ["38-portal-national-announcements", "council", "/portal/announcements", "desktop"],
];
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  for (const [file, persona, path, vp, opts = {}] of shots) {
    if (only && !only.test(file)) continue;
    const ctx = await browser.newContext({
      viewport: vp === "phone" ? { width: 412, height: 915 } : { width: 1440, height: 900 },
      deviceScaleFactor: 2, timezoneId: "Asia/Manila", locale: "en-PH",
      permissions: ["camera", "clipboard-read", "clipboard-write"],
    });
    await ctx.addInitScript(() => {
      const fixed = new Date("2026-10-31T10:00:00+08:00").getTime();
      const RealDate = Date;
      const off = fixed - RealDate.now();
      // eslint-disable-next-line no-global-assign
      Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + off])); } static now() { return RealDate.now() + off; } };
    });
    if (opts.scan) await ctx.addInitScript(() => {
      window.BarcodeDetector = class { constructor() { this.n = 0; } async detect() { return ++this.n > 30 ? [{ rawValue: "https://ais.example.ph/verify/3f2a1c9e-89aa-4b7a-8f0a-5c1d2e3f4a5b" }] : []; } };
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", e => errors.push("PAGEERROR " + e.message));
    await page.route("**/api/**", async route => {
      const req = route.request();
      if (!persona && req.url().includes("/api/auth/refresh")) return route.fulfill({ status: 401, body: "" });
      const body = handle(req.method(), req.url(), persona);
      if (body === undefined) { errors.push("UNMOCKED " + req.method() + " " + req.url()); return route.fulfill({ status: 404, body: "" }); }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.route("**/hubs/**/negotiate**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connectionId: "demo", connectionToken: "demo", negotiateVersion: 1, availableTransports: [{ transport: "WebSockets", transferFormats: ["Text", "Binary"] }] }) }));
    await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(m => { if (String(m).includes('"protocol"')) ws.send("{}\u001e"); }); });
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    if (opts.click) { await page.locator("[aria-pressed]").first().click(); await page.waitForTimeout(1200); }
    if (opts.type) { await page.locator("input").first().fill(opts.text); await page.waitForTimeout(900); }
    await page.waitForTimeout(opts.scan ? 2500 : 800);
    await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
    console.log(file, errors.length ? "\n   " + errors.join("\n   ") : "ok");
    await ctx.close();
  }
  await browser.close();
})();
