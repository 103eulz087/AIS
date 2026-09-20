<#
  Publishes AIS to the staging IIS site: the API (a .NET app, published under a "/api"
  physical folder, but the IIS Application over it must be aliased "backend" — see the
  ONE-TIME IIS SETUP note below, CLAUDE.md §8.10) and the web app (static files from
  `npm run build`) into the root site. Run this ON the staging server, from the repo
  root, as Administrator (needed to stop/start the API's app pool).

  ONE-TIME IIS SETUP THIS SCRIPT ASSUMES ALREADY EXISTS (not something it creates for you):
    - The root site, physical path = $WebPhysicalPath below, serving the built web app.
    - An IIS Application ALIASED "backend" (never "api" — CLAUDE.md §8.10: IIS strips a
      nested Application's own alias as its PathBase before the request reaches the app,
      but every route in Akrho.Api already has a literal "/api/" prefix baked in, so an
      alias of "api" would make the app see "/api/regions" arrive as just "/regions" and
      404 on every single request. staging.web.config's own "API passthrough" rewrite rule
      routes around this by rewriting /api/... to /backend/api/... first — that rule and
      this alias must agree, or nothing works), physical path = $ApiPhysicalPath below,
      its OWN application pool ($ApiAppPoolName below, ".NET CLR version: No Managed Code"
      — IIS just proxies to the ASP.NET Core Module, the CLR setting is irrelevant).
    - On that API application pool: environment variables ConnectionStrings__Akrho,
      Jwt__SigningKey, Push__VapidPrivateKey, Push__VapidPublicKey (Advanced Settings >
      Environment Variables in IIS Manager). NEVER put any of these in this script or in
      any file that gets copied — CLAUDE.md §10/§11. This script does not touch them, on
      purpose.

  Edit the four variables below to match your actual IIS paths/names, then run:
      .\scripts\publish-staging.ps1
#>
$ErrorActionPreference = "Stop"

# ---- EDIT THESE to match your IIS setup -------------------------------------------
$WebPhysicalPath  = "C:\inetpub\Akp-Staging"        # the root site's physical path
$ApiPhysicalPath  = "C:\inetpub\Akp-Staging\api"     # the "backend"-aliased Application's physical path
$ApiAppPoolName   = "akp-staging-api"                # that Application's own app pool
# -------------------------------------------------------------------------------------

$RepoRoot   = (Resolve-Path "$PSScriptRoot\..").Path
$PublishTmp = Join-Path $env:TEMP "akrho-api-publish"

Write-Host "==> Building the API (Release, Staging environment)" -ForegroundColor Cyan
if (Test-Path $PublishTmp) { Remove-Item $PublishTmp -Recurse -Force }
dotnet publish "$RepoRoot\src\Akrho.Api" -c Release -o $PublishTmp -p:EnvironmentName=Staging
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed." }

Write-Host "==> Building the web app" -ForegroundColor Cyan
Push-Location "$RepoRoot\src\web"
npm ci
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm ci failed." }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm run build failed." }
Pop-Location

Write-Host "==> Dropping in the SPA web.config (IIS routing/MIME rules)" -ForegroundColor Cyan
Copy-Item "$RepoRoot\src\web\staging.web.config" "$RepoRoot\src\web\dist\web.config" -Force

Write-Host "==> Stopping the API app pool ($ApiAppPoolName) so its files aren't locked" -ForegroundColor Cyan
Import-Module WebAdministration
Stop-WebAppPool -Name $ApiAppPoolName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Application files only — NEVER a full mirror here. uploads/ (member photos) and logs/
# hold real runtime data with no counterpart in a fresh `dotnet publish` output; a full
# mirror copy silently DELETES both (CLAUDE.md §8.13). /E copies everything including
# empty subfolders, /XD excludes those two by name wherever they appear.
Write-Host "==> Copying the API to $ApiPhysicalPath (uploads/ and logs/ preserved)" -ForegroundColor Cyan
robocopy $PublishTmp $ApiPhysicalPath /E /XD uploads logs /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw "robocopy (API) failed with exit code $LASTEXITCODE." }

# The web root holds only build output, no user-generated data — a full mirror here is
# correct and desired, so stale assets from a previous build don't linger.
Write-Host "==> Copying the web app to $WebPhysicalPath" -ForegroundColor Cyan
robocopy "$RepoRoot\src\web\dist" $WebPhysicalPath /MIR /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw "robocopy (web) failed with exit code $LASTEXITCODE." }

Write-Host "==> Starting the API app pool" -ForegroundColor Cyan
Start-WebAppPool -Name $ApiAppPoolName

Write-Host "==> Done. Give it a few seconds to warm up, then check the site." -ForegroundColor Green

# robocopy's own exit codes (0-7) mean success, not failure — without this, its exit
# code leaks through as this script's own, and a perfectly good deploy reports as failed.
exit 0
