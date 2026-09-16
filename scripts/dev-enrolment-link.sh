#!/usr/bin/env bash
# Issues a real enrolment link for local development, the same way a chapter/council
# approval does in production — through usp_Enrolment_Issue — but prints the link to the
# console instead of sending it by SMS. See CLAUDE.md §10, docs/AIS-Project-Documentation.md
# §7A.4 (how credentials are issued) and §7A.6 (bootstrap / re-issuing a lost link).
#
# usp_Enrolment_Issue requires @IssuedBy to currently hold ChapterAdmin in the SAME chapter
# as @MemberId (CLAUDE.md invariant #4 — added alongside the "resend enrolment link" feature).
# There is no System Admin technical account seeded yet (chapter registration/bootstrap is a
# later module — see the phase table in docs/AIS-Project-Documentation.md §9), so this script
# looks up that chapter's own seated ChapterAdmin and issues as him — falling back to the
# target member's own id only when the target IS that chapter's admin (self-issue, e.g. the
# seeded AKR-04-0117-001/TANGLAW). That fallback is a dev-only stand-in, not a design
# decision: production's first issuer is the System Admin, seeded by the chapter registration
# module. Do not carry it into that module.
#
# Usage:
#   scripts/dev-enrolment-link.sh [MemberNumber]
#   AKRHO_SQL_SERVER=... AKRHO_SQL_USER=... AKRHO_SQL_PASSWORD=... AKRHO_DB=... scripts/dev-enrolment-link.sh
set -euo pipefail

SERVER="${AKRHO_SQL_SERVER:-localhost,1433}"
SQLUSER="${AKRHO_SQL_USER:-sa}"
PASS="${AKRHO_SQL_PASSWORD:-Your_password123}"
DB="${AKRHO_DB:-Akrho}"
WEB_ORIGIN="${AKRHO_WEB_ORIGIN:-http://localhost:5173}"
MEMBER_NUMBER="${1:-AKR-04-0117-001}"

sql() { sqlcmd -S "$SERVER" -U "$SQLUSER" -P "$PASS" -C -b -I -h -1 -W "$@"; }

# openssl on Windows emits CRLF; strip both \r and \n or a stray \r survives invisibly
# in the token and silently hashes to something different than what gets printed/used.
RAW_TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\r\n')
HASH_HEX=$(printf '%s' "$RAW_TOKEN" | openssl dgst -sha256 -binary | xxd -p -c 256 | tr -d '\r\n')

MEMBER_ID=$(sql -d "$DB" -Q "SET NOCOUNT ON; SELECT MemberId FROM dbo.Member WHERE MemberNumber = '$MEMBER_NUMBER' AND IsDeleted = 0;" | tr -d '[:space:]')

if [ -z "$MEMBER_ID" ]; then
  echo "No member found with member number '$MEMBER_NUMBER'." >&2
  exit 1
fi

# usp_Enrolment_Issue now checks @IssuedBy is a currently-seated ChapterAdmin of @MemberId's
# own chapter — find that chapter's admin rather than assuming the target is one himself.
ISSUER_ID=$(sql -d "$DB" -Q "SET NOCOUNT ON;
SELECT TOP 1 mr.MemberId
FROM   dbo.MemberRole mr
JOIN   dbo.Role r ON r.RoleId = mr.RoleId
JOIN   dbo.Member target ON target.ChapterId = mr.ScopeId
WHERE  target.MemberId = $MEMBER_ID
  AND  mr.ScopeType = 'Chapter'
  AND  r.RoleName = 'ChapterAdmin'
  AND  mr.TermStart <= CAST(SYSUTCDATETIME() AS DATE)
  AND  (mr.TermEnd IS NULL OR mr.TermEnd >= CAST(SYSUTCDATETIME() AS DATE));" | tr -d '[:space:]')

if [ -z "$ISSUER_ID" ]; then
  echo "No seated Chapter Admin found for $MEMBER_NUMBER's chapter — cannot issue a link." >&2
  exit 1
fi

sql -d "$DB" -Q "SET NOCOUNT ON; EXEC dbo.usp_Enrolment_Issue @MemberId=$MEMBER_ID, @IssuedBy=$ISSUER_ID, @TokenHash=0x$HASH_HEX;" \
  || { echo "usp_Enrolment_Issue failed — see the message above (no mobile number on file, or no active office held)." >&2; exit 1; }

echo
echo "Enrolment link for $MEMBER_NUMBER:"
echo "  $WEB_ORIGIN/enrol/$RAW_TOKEN"
echo
echo "Valid 72 hours, one-time use. Re-running this script invalidates it and issues a new one."
