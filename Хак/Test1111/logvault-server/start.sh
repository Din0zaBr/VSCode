#!/usr/bin/env bash
# ============================================================
# URSUS SIEM Server — Quick Start
# Запуск: chmod +x start.sh && sudo ./start.sh
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[+]${NC} $*"; }
step()  { echo -e "${CYAN}[>]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     URSUS SIEM — Quick Start         ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

[[ $EUID -ne 0 ]] && error "Run as root: sudo ./start.sh"

# ── Docker ──────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  step "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  info "Docker installed"
fi

if ! docker compose version &>/dev/null; then
  step "Installing Docker Compose plugin..."
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin
fi

# ── Start ───────────────────────────────────────────────────
HOST_IP=$(hostname -I | awk '{print $1}')

step "Building and starting URSUS SIEM..."
docker compose up -d --build

# ── Wait for healthy ────────────────────────────────────────
step "Waiting for services..."
for i in $(seq 1 30); do
  if docker compose ps --format json 2>/dev/null | grep -q '"running"'; then
    break
  fi
  sleep 2
  echo -n "."
done
echo ""

# ── Read API key from .env ──────────────────────────────────
API_KEY=$(grep -oP '^API_KEYS=\K.*' .env 2>/dev/null || echo "changeme-agent-key")

# ── Status ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  URSUS SIEM is running!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  UI:       ${CYAN}http://${HOST_IP}${NC}"
echo -e "  API:      ${CYAN}http://${HOST_IP}:8000${NC}"
echo -e "  API Docs: ${CYAN}http://${HOST_IP}:8000/docs${NC}"
echo ""
echo -e "  ${YELLOW}━━━ Установка агента на любом хосте (одна команда) ━━━${NC}"
echo ""
echo -e "  ${CYAN}curl -fsSL http://${HOST_IP}:8000/agent/install | sudo bash -s -- --key ${API_KEY}${NC}"
echo ""
echo -e "  ${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Управление:"
echo -e "  Логи:      docker compose logs -f"
echo -e "  Стоп:      docker compose down"
echo -e "  Рестарт:   docker compose restart"
echo ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "logvault|ursus" || true
