#!/usr/bin/env bash
# One command to get a working local environment.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ starting SQL Server"
docker compose up -d sql

echo "→ waiting for SQL Server to accept connections"
until docker compose exec -T sql /opt/mssql-tools18/bin/sqlcmd \
      -S localhost -U sa -P "Your_password123" -C -Q "SELECT 1" >/dev/null 2>&1; do
  sleep 3; printf '.'
done
echo

bash scripts/db-deploy.sh

# The dev certificate matters: getUserMedia (QR scanning), PWA install, and (since
# Auth slice 1) the Secure refresh-token cookie all require a secure context. Without
# this, the camera is dead and the browser silently refuses to store the session cookie.
echo "→ trusting the ASP.NET dev certificate"
dotnet dev-certs https --trust || echo "  (trust it manually if this failed)"

# Vite needs the SAME trusted cert so the web origin itself is HTTPS too — not just the
# API. A Secure cookie set by an HTTPS API is still refused by the browser if the page
# that receives it was loaded over plain HTTP.
echo "→ exporting the dev certificate for Vite"
mkdir -p src/web/.certs
dotnet dev-certs https --export-path src/web/.certs/dev-cert.pfx -p devcert --trust \
  || echo "  (export it manually if this failed — src/web/vite.config.ts falls back to plain HTTP without it)"

echo "→ restoring"
dotnet restore Akrho.sln
(cd src/web && npm install)

echo
echo "Ready. In two terminals:"
echo "  dotnet run --project src/Akrho.Api      → https://localhost:5443/swagger"
echo "  cd src/web && npm run dev               → http://localhost:5173"
