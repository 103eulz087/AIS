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
# -r win-x64 --self-contained false: staging is always one Windows Server box (CLAUDE.md
# §11), but without a Runtime Identifier, dotnet publish can't know that — it bundles
# runtimes/ native assets for EVERY platform SkiaSharp and Microsoft.Data.SqlClient.SNI
# ship (win-x86/arm64, linux-*, osx, ~20 platforms), ~490MB of dead weight none of which
# ever runs. Pinning the RID keeps this a framework-dependent deploy (still needs the
# .NET 8 runtime installed on the server, same as today) while trimming native assets
# down to win-x64 alone.
dotnet publish "$RepoRoot\src\Akrho.Api" -c Release -o $ApiOut -p:EnvironmentName=Staging -r win-x64 --self-contained false
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed." }

# SkiaSharp's native win-x64 asset carries a 90+MB debug symbol file (libSkiaSharp.pdb)
# alongside its own 13MB DLL — a native-library .pdb, not one of ours, useless without
# the matching native debugger toolchain and never needed to run the app. Every managed
# .pdb here is the same story: only useful for attaching a debugger or getting line
# numbers in a stack trace, never for the app to run. None of this belongs in a
# deployment folder.
Write-Host "==> Stripping .pdb symbol files from the publish output" -ForegroundColor Cyan
Get-ChildItem -Path $ApiOut -Filter "*.pdb" -Recurse | Remove-Item -Force

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
