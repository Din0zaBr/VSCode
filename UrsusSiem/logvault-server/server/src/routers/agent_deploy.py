"""
Agent deployment endpoint.

Allows remote hosts to install the agent with a single command:
    curl -fsSL http://server:8000/agent/install | sudo bash -s -- --key <API_KEY>
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter(prefix="/agent", tags=["agent-deploy"])

INSTALL_SCRIPT = r"""#!/usr/bin/env bash
# ============================================================
# URSUS SIEM Agent — remote installer
# Fetched from: {server_url}/agent/install
#
# Usage:
#   curl -fsSL {server_url}/agent/install | sudo bash -s -- --key <KEY> [--id <NAME>]
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  {{ echo -e "${{GREEN}}[+]${{NC}} $*"; }}
step()  {{ echo -e "${{CYAN}}[>]${{NC}} $*"; }}
warn()  {{ echo -e "${{YELLOW}}[!]${{NC}} $*"; }}
error() {{ echo -e "${{RED}}[✗]${{NC}} $*" >&2; exit 1; }}

SERVER_URL="{server_url}"
API_KEY=""
AGENT_ID=""
INSTALL_DIR="/opt/ursus-agent"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key|-k)    API_KEY="$2";    shift 2 ;;
    --id|-i)     AGENT_ID="$2";   shift 2 ;;
    --help|-h)   echo "Usage: $0 --key KEY [--id NAME]"; exit 0 ;;
    *) error "Unknown: $1" ;;
  esac
done

[[ -z "$API_KEY" ]]   && error "Missing --key"
[[ -z "$AGENT_ID" ]]  && AGENT_ID="$(hostname -s)"
[[ $EUID -ne 0 ]]     && error "Run as root: sudo $0 --key ... "

echo ""
echo -e "${{CYAN}}╔══════════════════════════════════════╗${{NC}}"
echo -e "${{CYAN}}║    URSUS SIEM Agent — Installer      ║${{NC}}"
echo -e "${{CYAN}}╚══════════════════════════════════════╝${{NC}}"
echo ""
info "Server:   $SERVER_URL"
info "Agent ID: $AGENT_ID"

# ── Install Docker ──────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  step "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  info "Docker installed"
fi

if ! docker info &>/dev/null; then
  systemctl start docker
fi

# ── Create install dir ──────────────────────────────────────
mkdir -p "$INSTALL_DIR"

# ── Download config from server ─────────────────────────────
step "Downloading agent config..."
curl -fsSL "${{SERVER_URL}}/agent/config?agent_id=${{AGENT_ID}}&api_key=${{API_KEY}}" \
  -o "$INSTALL_DIR/config.yaml"

# ── Download docker-compose ─────────────────────────────────
step "Downloading docker-compose.yml..."
curl -fsSL "${{SERVER_URL}}/agent/compose?agent_id=${{AGENT_ID}}&api_key=${{API_KEY}}" \
  -o "$INSTALL_DIR/docker-compose.yml"

# ── Stop old if running ─────────────────────────────────────
if docker ps -a --format '{{{{.Names}}}}' | grep -q "^ursus-agent$"; then
  warn "Stopping old agent..."
  docker compose -f "$INSTALL_DIR/docker-compose.yml" down 2>/dev/null || \
    docker rm -f ursus-agent 2>/dev/null || true
fi

# ── Pull & start ────────────────────────────────────────────
step "Pulling and starting agent..."
docker compose -f "$INSTALL_DIR/docker-compose.yml" pull 2>/dev/null || true
docker compose -f "$INSTALL_DIR/docker-compose.yml" up -d --build 2>/dev/null || \
  docker compose -f "$INSTALL_DIR/docker-compose.yml" up -d

sleep 3
if docker ps --format '{{{{.Names}}}}' | grep -q "^ursus-agent$"; then
  info "Agent is running!"
  echo ""
  info "Commands:"
  info "  Logs:      docker logs -f ursus-agent"
  info "  Status:    docker ps | grep ursus"
  info "  Stop:      docker compose -f $INSTALL_DIR/docker-compose.yml down"
  info "  Update:    curl -fsSL $SERVER_URL/agent/install | sudo bash -s -- --key $API_KEY --id $AGENT_ID"
  info "  Uninstall: docker compose -f $INSTALL_DIR/docker-compose.yml down && rm -rf $INSTALL_DIR"
else
  error "Agent failed. Check: docker logs ursus-agent"
fi
"""


@router.get("/install", response_class=PlainTextResponse)
async def get_install_script(request: Request):
    """Return a shell script that installs the agent via Docker on a remote host."""
    server_url = str(request.base_url).rstrip("/")
    return INSTALL_SCRIPT.format(server_url=server_url)


@router.get("/install-native", response_class=PlainTextResponse)
async def get_native_install_script(request: Request):
    """Return a standalone Python-based agent installer (no Docker required)."""
    import pathlib
    script_path = pathlib.Path(__file__).parent.parent.parent.parent.parent / "agent-linux.sh"
    if script_path.exists():
        return script_path.read_text()
    # Fallback: redirect user to the file
    return "#!/bin/bash\necho 'agent-linux.sh not found on server. Download it from the repository.'\n"


@router.get("/config", response_class=PlainTextResponse)
async def get_agent_config(
    request: Request,
    agent_id: str = "agent-01",
    api_key: str = "changeme",
):
    """Return a ready-to-use agent config.yaml."""
    server_url = str(request.base_url).rstrip("/")
    return f"""server_url: "{server_url}"
agent_id: "{agent_id}"
api_key: "{api_key}"
hostname: "{agent_id}"

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
"""


@router.get("/compose", response_class=PlainTextResponse)
async def get_agent_compose(
    request: Request,
    agent_id: str = "agent-01",
    api_key: str = "changeme",
):
    """Return a ready-to-use docker-compose.yml for the agent."""
    server_url = str(request.base_url).rstrip("/")
    return f"""services:
  agent:
    image: ghcr.io/din0zabr/logvault-agent:latest
    container_name: ursus-agent
    restart: unless-stopped
    environment:
      - LOGVAULT_SERVER_URL={server_url}
      - LOGVAULT_AGENT_ID={agent_id}
      - LOGVAULT_API_KEY={api_key}
    volumes:
      - /var/log:/var/log:ro
      - /run/log/journal:/run/log/journal:ro
      - ./config.yaml:/etc/logvault/config.yaml:ro
      - agent_data:/data

volumes:
  agent_data:
    driver: local
"""
