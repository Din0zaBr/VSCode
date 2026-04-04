#!/usr/bin/env bash
# ============================================================
# LogVault Agent — install binary as systemd service
#
# Usage:
#   sudo ./install.sh --server https://logvault.example.com --key my-key
#   sudo ./install.sh --server https://logvault.example.com --key my-key --id web-01
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[+]${NC} $*"; }
step()  { echo -e "${CYAN}[>]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

SERVER_URL=""
API_KEY=""
AGENT_ID=""
INSTALL_DIR="/opt/logvault-agent"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Parse args ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server|-s)  SERVER_URL="$2"; shift 2 ;;
    --key|-k)     API_KEY="$2";    shift 2 ;;
    --id|-i)      AGENT_ID="$2";   shift 2 ;;
    --help|-h)
      echo "Usage: $0 --server URL --key KEY [--id NAME]"
      exit 0 ;;
    *) error "Unknown option: $1" ;;
  esac
done

[[ -z "$SERVER_URL" ]] && error "Missing --server"
[[ -z "$API_KEY" ]]    && error "Missing --key"
[[ -z "$AGENT_ID" ]]   && AGENT_ID="$(hostname -s)"
[[ $EUID -ne 0 ]]     && error "Run as root: sudo $0 $*"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   LogVault Agent — Binary Install    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Copy binary ─────────────────────────────────────────────
step "Installing to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}" /data/offsets

if [[ -f "${SCRIPT_DIR}/logvault-agent" ]]; then
  cp "${SCRIPT_DIR}/logvault-agent" "${INSTALL_DIR}/logvault-agent"
else
  error "Binary not found: ${SCRIPT_DIR}/logvault-agent"
fi
chmod +x "${INSTALL_DIR}/logvault-agent"

# ── Generate config ─────────────────────────────────────────
step "Writing config..."
cat > "${INSTALL_DIR}/config.yaml" <<YAML
server_url: "${SERVER_URL}"
agent_id: "${AGENT_ID}"
api_key: "${API_KEY}"
hostname: "${AGENT_ID}"

batch_size: 200
flush_interval: 2.0
retry_base: 1.0
retry_max: 60.0
buffer_db: "/data/buffer.db"

sources:
  - type: file
    path: "/var/log/syslog"
    service: "syslog"
  - type: file
    path: "/var/log/auth.log"
    service: "auth"
  - type: file
    path: "/var/log/messages"
    service: "messages"
  - type: file
    path: "/var/log/secure"
    service: "secure"
YAML

# ── Create systemd service ──────────────────────────────────
step "Creating systemd service..."
cat > /etc/systemd/system/logvault-agent.service <<UNIT
[Unit]
Description=LogVault Log Collection Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/logvault-agent ${INSTALL_DIR}/config.yaml
Restart=always
RestartSec=5
User=root

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/data ${INSTALL_DIR}
ReadOnlyPaths=/var/log /run/log

[Install]
WantedBy=multi-user.target
UNIT

# ── Enable and start ────────────────────────────────────────
step "Starting service..."
systemctl daemon-reload
systemctl enable logvault-agent
systemctl restart logvault-agent

sleep 2
if systemctl is-active --quiet logvault-agent; then
  info "Agent is running!"
  echo ""
  info "Commands:"
  info "  Status:   systemctl status logvault-agent"
  info "  Logs:     journalctl -u logvault-agent -f"
  info "  Stop:     systemctl stop logvault-agent"
  info "  Config:   ${INSTALL_DIR}/config.yaml"
else
  error "Agent failed to start. Check: journalctl -u logvault-agent -e"
fi
