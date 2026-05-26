#!/usr/bin/env bash
# End-to-end smoke test: send syslog → search via API.
#
# Prerequisites:
#   * URSUS running locally on :8080 (and :514 for syslog)
#   * `nc` (netcat) installed
#   * `jq` installed
#   * Env: URSUS_BASE, URSUS_USER, URSUS_PASS
#
# Usage:
#   URSUS_BASE=http://localhost:8080 \
#   URSUS_USER=admin URSUS_PASS=change-me \
#   tests/e2e/syslog_smoke.sh

set -euo pipefail

URSUS_BASE="${URSUS_BASE:-http://localhost:8080}"
URSUS_USER="${URSUS_USER:-admin}"
URSUS_PASS="${URSUS_PASS:-changeme}"
SYSLOG_HOST="${SYSLOG_HOST:-127.0.0.1}"
SYSLOG_PORT="${SYSLOG_PORT:-514}"

UNIQUE_TAG="ursus-e2e-$(date +%s)-$$"

echo "==> [1/4] Login to ${URSUS_BASE}"
TOKEN=$(curl -fsS -X POST "${URSUS_BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${URSUS_USER}\",\"password\":\"${URSUS_PASS}\"}" \
  | jq -r '.token')
test -n "$TOKEN" && test "$TOKEN" != "null" || { echo "login failed"; exit 1; }
echo "OK"

echo "==> [2/4] Send RFC 3164 syslog message via UDP to ${SYSLOG_HOST}:${SYSLOG_PORT}"
echo "<13>$(date '+%b %d %H:%M:%S') test-host sshd[1234]: ${UNIQUE_TAG}" \
  | nc -u -w1 "${SYSLOG_HOST}" "${SYSLOG_PORT}"
echo "OK"

echo "==> [3/4] Send RFC 5424 syslog message via TCP"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "<34>1 ${NOW} test-host sshd 1234 ID47 - ${UNIQUE_TAG}-rfc5424" \
  | nc -w1 "${SYSLOG_HOST}" "${SYSLOG_PORT}"
echo "OK"

# Give the batcher up to its flush interval (500ms) + DB write a moment
echo "==> Waiting 2s for flush..."
sleep 2

echo "==> [4/4] Search API for our tag"
FOUND=$(curl -fsS "${URSUS_BASE}/api/search?q=${UNIQUE_TAG}&size=10" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.total // 0')

echo "Found: ${FOUND} matches for tag ${UNIQUE_TAG}"
if [ "${FOUND}" -ge 2 ]; then
  echo "PASS"
  exit 0
else
  echo "FAIL — expected ≥2 events, got ${FOUND}"
  exit 1
fi
