<#
  Builds AIS for staging ON YOUR LAPTOP and drops two ready-to-copy folders under
  .\publish\ — nothing here touches IIS or any server; that happens after you paste
  these folders onto the staging box yourself.

    .\publish\api\   -> copy this INTO the server's "/api" Application folder
    .\publish\web\   -> copy this INTO the server's root site folder (the static site)

  Run from the repo root:
      .\scripts\build-for-staging.ps1
#>
$ErrorActionPreference = "Stop"

$RepoRoot   = (Resolve-Path "$PSScriptRoot\..").Path
$OutDir     = Join-Path $RepoRoot "publish"
$ApiOut     = Join-Path $OutDir "api"
$WebOut     = Join-Path $OutDir "web"

Write-Host "==> Cleaning .\publish\" -ForegroundColor Cyan
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $ApiOut -Force | Out-Null
New-Item -ItemType Directory -Path $WebOut -Force | Out-Null

Write-Host "==> Building the API (Release, Staging environment)" -ForegroundColor Cyan
dotnet publish "$RepoRoot\src\Akrho.Api" -c Release -o $ApiOut -p:EnvironmentName=Staging
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed." }

Write-Host "==> Building the web app" -ForegroundColor Cyan
Push-Location "$RepoRoot\src\web"
npm ci
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm ci failed." }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm run build failed." }
Pop-Location

Write-Host "==> Copying web build output into .\publish\web\" -ForegroundColor Cyan
robocopy "$RepoRoot\src\web\dist" $WebOut /E /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE." }

Write-Host "==> Dropping in the SPA web.config (IIS routing/MIME rules)" -ForegroundColor Cyan
Copy-Item "$RepoRoot\src\web\staging.web.config" (Join-Path $WebOut "web.config") -Force

Write-Host ""
Write-Host "Done. Ready to copy:" -ForegroundColor Green
Write-Host "  $ApiOut   -> the server's /api Application folder"
Write-Host "  $WebOut   -> the server's root site folder"
Write-Host ""
Write-Host "Reminder: the connection string (ConnectionStrings__Akrho) is NOT in these" -ForegroundColor Yellow
Write-Host "folders on purpose. Set it once, on the server, as an environment variable on" -ForegroundColor Yellow
Write-Host "the API's application pool (IIS Manager > Application Pools > that pool >" -ForegroundColor Yellow
Write-Host "Advanced Settings > Environment Variables)." -ForegroundColor Yellow

# robocopy's own exit codes (0-7) mean success, not failure — without this, its exit
# code leaks through as this script's own, and a perfectly good build reports as failed.
exit 0
