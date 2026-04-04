#!/usr/bin/env bash
# ============================================================
# LogVault Agent — uninstall
# Usage: sudo ./uninstall.sh
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
step() { echo -e "${CYAN}[>]${NC} $*"; }

[[ $EUID -ne 0 ]] && { echo -e "${RED}[✗]${NC} Run as root: sudo $0"; exit 1; }

step "Stopping service..."
systemctl stop logvault-agent 2>/dev/null || true
systemctl disable logvault-agent 2>/dev/null || true

step "Removing systemd unit..."
rm -f /etc/systemd/system/logvault-agent.service
systemctl daemon-reload

step "Removing files..."
rm -rf /opt/logvault-agent
rm -rf /data/offsets
rm -f /data/buffer.db

info "LogVault Agent uninstalled."
