# Deploying AKRHO AIS to the staging Windows Server

Scope: one instance of AIS (`src/Akrho.Api` + `src/web`) on the client's existing Windows Server,
alongside the other IIS sites already running there. This is staging, not production, but it uses
the architecture production will use — one deployment, one URL, one database (CLAUDE.md
invariant #11; docs/AIS-Project-Documentation.md §7A.1). There is exactly one AIS site pair on
this box for this purpose; do not create a site or app pool per chapter.

This doc assumes you already know IIS (sites, app pools, bindings). It only covers what is
specific to this app.

---

## 0. Architecture decision: reverse proxy (ARR), not a nested IIS application

**Chosen approach:** the SPA (`src/web/dist`) is the public IIS site. `/api/*`, `/hubs/*` and
`/health` are reverse-proxied via URL Rewrite + Application Request Routing (ARR) to the API,
which runs as its **own IIS site bound to loopback only** (e.g. `127.0.0.1:5091`). Everything else
falls back to `index.html` for client-side routing.

**Why not a nested IIS application (API mounted at `/api` under the SPA site)?** Every endpoint
group in this codebase hardcodes the `/api` prefix in its own route template, e.g.:

```csharp
// src/Akrho.Api/Features/Members/MembersEndpoints.cs
var g = app.MapGroup("/api/members")...
```

confirmed the same way across all 19 feature endpoint files (`/api/auth`, `/api/chapters`, `/api/
enrolment`, etc.), plus the SignalR hub at `/hubs/chat` (not under `/api` at all). If the API were
mounted as an IIS sub-application at path `/api`, ASP.NET Core Module sets `PathBase=/api` and
strips it before routing — so a request for `/api/members` would arrive at the app as `Path=
/members`, which matches nothing (every route still expects the literal `/api/members`). That's a
404 on every endpoint, not a cosmetic issue. A reverse proxy that forwards the request with its
path untouched is what this app's route design actually requires. It also cleanly handles the
`/hubs/chat` WebSocket route, which lives outside `/api` and could not be reached by a single
nested application at `/api` anyway.

**Hosting model for the API: in-process** (`Microsoft.NET.Sdk.Web` default since .NET Core 3.0 —
no explicit setting needed in the `.csproj`). In-process runs the app inside the IIS worker process
via ANCM/IISHttpServer directly, rather than proxying internally to a separate Kestrel process —
fewer moving parts, lower latency, and no dynamic port for ANCM to manage. IIS still owns the
site's own binding (the loopback port ARR proxies to); the hosting model only affects how ANCM talks
to the app *inside* that site, not whether ARR can reach the site.

---

## 1. Prerequisites — verify before publishing

| # | Check | How |
|---|---|---|
| 1 | **.NET 8 Hosting Bundle** (ASP.NET Core Runtime + ANCM v2) installed — this is separate from the plain .NET 8 runtime and from any Hosting Bundle version already installed for other apps. Version must be ≥ what `net8.0` needs. | `dotnet --list-runtimes` — look for `Microsoft.AspNetCore.App 8.0.x`. If the box only runs, say, .NET 6 or 9 apps today, the 8.0 hosting bundle is very likely missing. Download from the official .NET download page ("Hosting Bundle", not "Runtime"), install, then `net stop was /y && net start w3svc` (or reboot) to reload ANCM into IIS. |
| 2 | **Application Request Routing (ARR)** — a separate IIS extension, not bundled. | IIS Manager → server node → look for "Application Request Routing Cache" icon. If absent, install ARR 3.0 (Web Platform Installer or the standalone MSI from IIS.net). |
| 3 | **URL Rewrite module** — also separate, commonly already present if other sites here do rewriting. | IIS Manager → server node → look for "URL Rewrite" icon. Install if missing. |
| 4 | **ARR proxy enabled server-wide** (one-time, off by default even after installing ARR). | IIS Manager → server node → "Application Request Routing Cache" → "Server Proxy Settings…" → check **Enable proxy** → Apply. |
| 5 | **WebSocket Protocol** Windows feature (needed for `/hubs/chat` through the proxy). | Server Manager → Add Roles and Features → Web Server (IIS) → Application Development → **WebSocket Protocol**. Likely already on if any existing site uses SignalR/WebSockets; confirm, don't assume. |
| 6 | **Port/host-header conflict check** against existing sites. | `netstat -ano | findstr :443` and `:5091` (or whatever loopback port you pick for the API — see §3). Pick a host header for the public site that doesn't collide with existing bindings on port 443 (IIS supports multiple HTTPS sites on 443 via SNI — ensure "Require Server Name Indication" is checked on the new binding). |
| 7 | **A real TLS certificate for the public hostname** — not IIS's default self-signed cert. Camera access (`getUserMedia`, all QR scanning) and the `Secure` refresh-token cookie both require a browser-trusted secure context; a self-signed cert fails both in ways that look like silent app breakage, not a clear error (CLAUDE.md §8.2). Use win-acme (Let's Encrypt) against the assigned public hostname, or an existing wildcard cert for the domain if one is already on the box. |

---

## 2. Publish

Publish to a folder **outside the git working copy** (e.g. `D:\Deploy\akrho-staging\`), so nothing
IIS-managed ends up under source control by accident.

```powershell
# API
dotnet publish D:\PROJECTS\AIS\src\Akrho.Api\Akrho.Api.csproj -c Release -o D:\Deploy\akrho-staging\api

# SPA
cd D:\PROJECTS\AIS\src\web
npm ci
npm run build          # tsc -b && vite build -> src\web\dist
```

Copy the SPA build output to its IIS content folder:

```powershell
Copy-Item D:\PROJECTS\AIS\src\web\dist\* D:\Deploy\akrho-staging\web\ -Recurse -Force
```

`dotnet publish` generates `D:\Deploy\akrho-staging\api\web.config` automatically (from the
`Microsoft.NET.Sdk.Web` SDK) — you edit that generated file per §4, you do not hand-write it.

---

## 3. IIS site / app pool setup

**API site** (backend, loopback only — never bound to a public interface):

| Setting | Value |
|---|---|
| Site name | `AKRHO-Staging-Api` |
| Physical path | `D:\Deploy\akrho-staging\api` |
| Binding | `http`, IP `127.0.0.1`, port `5091` (check §1.6 first; pick a free port) — no host header needed, it's loopback-only |
| App pool | `AKRHO-Staging-Api` — **.NET CLR version: No Managed Code** (ANCM/in-process does not use the classic managed pipeline) |
| App pool identity | Default (ApplicationPoolIdentity) is fine — grant it **Modify** on `D:\Deploy\akrho-staging\api\logs` and `...\uploads` (Serilog writes to `logs/akrho-.log`, `LocalFileStorage` writes under `Storage:UploadPath`, both relative to the app's working directory) |

**SPA site** (public):

| Setting | Value |
|---|---|
| Site name | `AKRHO-Staging-Web` |
| Physical path | `D:\Deploy\akrho-staging\web` |
| Binding | `https`, port `443`, host header = the assigned staging hostname (e.g. `ais-staging.<client-domain>`), SNI required, bound to the real cert from §1.7 |
| App pool | `AKRHO-Staging-Web` — No Managed Code (static content + rewrite only) |

Do not put the API behind a public binding or host header — it is only ever reached through the
SPA site's reverse proxy, matching invariant #11 (one URL).

---

## 4. API `web.config` — environment variables

Edit the `web.config` that `dotnet publish` generated at
`D:\Deploy\akrho-staging\api\web.config`. It already contains an `<aspNetCore>` element with
`processPath`, `arguments` (`.\Akrho.Api.dll`) and `hostingModel="inprocess"` filled in — **add**
the `<environmentVariables>` child shown below. This file lives only on the server, never in the
repo; the tokens below are placeholders — substitute the real values by hand on the server, do not
paste them into any git-tracked file.

```xml
<aspNetCore processPath="dotnet" arguments=".\Akrho.Api.dll" stdoutLogEnabled="false" hostingModel="inprocess">
  <environmentVariables>
    <environmentVariable name="ASPNETCORE_ENVIRONMENT" value="Staging" />
    <environmentVariable name="ConnectionStrings__Akrho" value="{{CONNECTION_STRING}}" />
    <environmentVariable name="Jwt__SigningKey" value="{{JWT_SIGNING_KEY}}" />
    <environmentVariable name="Push__VapidPublicKey" value="{{VAPID_PUBLIC_KEY}}" />
    <environmentVariable name="Push__VapidPrivateKey" value="{{VAPID_PRIVATE_KEY}}" />
  </environmentVariables>
</aspNetCore>
```

Notes:
- `{{CONNECTION_STRING}}` is the existing shared dev/test SQL Server connection string
  (`corex.itcoreapps.com,6601` / `AISDB` — CLAUDE.md §10), the same one already in the developer's
  gitignored `appsettings.Development.local.json`. Do not print or copy its password anywhere else;
  just paste the full connection string value into this one `web.config` on the server.
- `Jwt__Issuer` / `Jwt__Audience` are not secrets and don't need overriding — the base
  `appsettings.json` values (`akrho-api` / `akrho-web`) apply fine in Staging.
- Program.cs throws at startup outside `Development` if `Jwt:SigningKey` or
  `Push:VapidPrivateKey` still equal the checked-in dev placeholders — so all three secret env
  vars above must be the real generated values, not left blank or copy-pasted as placeholders.
- After editing, recycle the app pool (`Restart-WebAppPool AKRHO-Staging-Api`) so ANCM picks up the
  change — IIS does not hot-reload `web.config` environment variables into an already-running
  worker process.

---

## 5. URL Rewrite rules (on the SPA site)

Add to `D:\Deploy\akrho-staging\web\web.config` (create it if `npm run build` didn't produce one —
the SPA is pure static output, IIS needs this file for the rewrite rules below):

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- REST API -->
        <rule name="ReverseProxyApi" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:5091/api/{R:1}" />
        </rule>

        <!-- SignalR hub — WebSocket Protocol feature (§1.5) must be enabled for this to upgrade -->
        <rule name="ReverseProxyHubs" stopProcessing="true">
          <match url="^hubs/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:5091/hubs/{R:1}" />
        </rule>

        <!-- /health — for the smoke check in §7 and future uptime monitoring -->
        <rule name="ReverseProxyHealth" stopProcessing="true">
          <match url="^health$" />
          <action type="Rewrite" url="http://127.0.0.1:5091/health" />
        </rule>

        <!-- SPA client-side routing fallback: anything else that isn't a real file/folder -->
        <rule name="SpaFallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

Replace `127.0.0.1:5091` in all three proxy rules if you picked a different loopback port in §3.
This file has no secrets in it and is fine to keep as a reference copy in your deploy notes, but
it is server content, not repo content — do not add it to the AIS git repository.

---

## 6. Point the app at the real staging URL

`src/Akrho.Api/appsettings.Staging.json` is already checked in with placeholders:

```json
{ "Cors": { "Origins": [ "REPLACE-WITH-STAGING-WEB-ORIGIN" ] },
  "Web": { "Origin": "REPLACE-WITH-STAGING-WEB-ORIGIN" }, ... }
```

Once the hostname is assigned (§1.7/§3), edit this file as a normal git-tracked change — replace
both placeholders with the real public origin, e.g. `https://ais-staging.<client-domain>` (no
trailing slash). `Web:Origin` is what `MembershipApplicationsEndpoints` and `MembersEndpoints` use
to build the clickable link inside enrolment SMS messages, so a stale value here means officers
get a link to `localhost`. Commit the change, then republish and redeploy the API (§2–§4) — this
value is read from `appsettings.Staging.json` at startup, it is not an environment variable.

---

## 7. Post-deploy smoke check

1. `curl -k https://ais-staging.<client-domain>/health` → expect `{"status":"ok","utc":"..."}`.
   This confirms the SPA site, the ARR proxy rule, and the API's in-process ANCM hosting are all
   wired correctly, before touching the browser.
2. **`/swagger` will NOT be available** — `Program.cs` only maps Swagger when
   `app.Environment.IsDevelopment()`, and this deployment runs `ASPNETCORE_ENVIRONMENT=Staging`.
   That's by design, not a bug to chase; use step 1 instead to confirm the API is alive.
3. Open `https://ais-staging.<client-domain>/` in a browser — confirm the SPA loads, DevTools
   console has no errors, and the padlock shows a trusted cert (not a security warning — a warning
   here means §1.7's cert isn't actually installed/bound yet, and the app will silently fail on
   sign-in and QR scanning even though the page "loads").
4. Issue a real enrolment link against this environment (mirrors `scripts/dev-enrolment-link.sh`,
   pointed at the staging DB via `AKRHO_SQL_SERVER`/etc.) and confirm the link it prints uses the
   real staging origin from §6, not `localhost`.
5. Open that enrolment link on an actual phone over the public URL — complete enrolment, sign in,
   and open the QR scanner screen to confirm the camera prompt actually appears (this is the
   concrete proof that HTTPS + the cookie + the secure-context requirement are all correctly
   wired end to end, not just that the page rendered).
6. Open a screen that uses the chat hub (Features/Chat) and confirm it connects — check the
   Network tab for a `101 Switching Protocols` on `/hubs/chat`, not a stuck pending request (a
   stuck request there means the WebSocket Protocol feature from §1.5 isn't actually enabled).

---

## Still needs a human decision

- The actual staging hostname/DNS record — nothing here can proceed past §3/§6/§7 without it.
- Which certificate path (win-acme against a new public hostname, vs. an existing wildcard cert)
  — depends on whether this domain already has one on the box.
- The three secret values (`Jwt__SigningKey`, `Push__VapidPublicKey`, `Push__VapidPrivateKey`) and
  the DB password — must be typed into the server's `web.config` by a person with access to them;
  this runbook deliberately never carries the values themselves.
- Confirm the server's static IP situation and what happens to the DNS record if it isn't static
  (per CLAUDE.md's "realities to plan for" — relevant even for staging if this box is a cloud VM
  with a dynamic public IP).
