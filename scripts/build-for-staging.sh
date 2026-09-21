#!/usr/bin/env bash
# Mac/Linux counterpart to build-for-staging.ps1 — same two outputs, same reminder.
# Builds AIS for staging ON YOUR LAPTOP and drops two ready-to-copy folders under
# ./publish/ — nothing here touches IIS or any server; that happens after you paste
# these folders onto the staging box yourself.
#
#   ./publish/api/   -> copy this INTO the server's "/api" Application folder
#   ./publish/web/   -> copy this INTO the server's root site folder (the static site)
#
# Run from the repo root:
#   scripts/build-for-staging.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/publish"
API_OUT="$OUT_DIR/api"
WEB_OUT="$OUT_DIR/web"

echo "==> Cleaning ./publish/"
rm -rf "$OUT_DIR"
mkdir -p "$API_OUT" "$WEB_OUT"

echo "==> Building the API (Release, Staging environment)"
dotnet publish "$REPO_ROOT/src/Akrho.Api" -c Release -o "$API_OUT" -p:EnvironmentName=Staging

echo "==> Building the web app"
pushd "$REPO_ROOT/src/web" > /dev/null
npm ci
npm run build
popd > /dev/null

echo "==> Copying web build output into ./publish/web/"
cp -R "$REPO_ROOT/src/web/dist/." "$WEB_OUT/"

echo "==> Dropping in the SPA web.config (IIS routing/MIME rules)"
cp "$REPO_ROOT/src/web/staging.web.config" "$WEB_OUT/web.config"

echo ""
echo "Done. Ready to copy:"
echo "  $API_OUT   -> the server's /api Application folder"
echo "  $WEB_OUT   -> the server's root site folder"
echo ""
echo "Reminder: the connection string (ConnectionStrings__Akrho) is NOT in these"
echo "folders on purpose. Set it once, on the server, as an environment variable on"
echo "the API's application pool (IIS Manager > Application Pools > that pool >"
echo "Advanced Settings > Environment Variables)."
