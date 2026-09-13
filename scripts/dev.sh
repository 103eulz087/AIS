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

# The dev certificate matters: getUserMedia (QR scanning) and PWA install both
# require a secure context. Without this, the camera is simply dead in dev.
echo "→ trusting the ASP.NET dev certificate"
dotnet dev-certs https --trust || echo "  (trust it manually if this failed)"

echo "→ restoring"
dotnet restore Akrho.sln
(cd src/web && npm install)

echo
echo "Ready. In two terminals:"
echo "  dotnet run --project src/Akrho.Api      → https://localhost:5443/swagger"
echo "  cd src/web && npm run dev               → http://localhost:5173"
