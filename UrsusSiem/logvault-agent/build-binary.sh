#!/usr/bin/env bash
# ============================================================
# Build LogVault Agent as a standalone Linux binary
#
# Run this on an Ubuntu/Debian machine (or in Docker):
#   chmod +x build-binary.sh
#   ./build-binary.sh
#
# Output: dist/logvault-agent (single binary, ~15-20MB)
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $*"; }
step() { echo -e "${CYAN}[>]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Install build dependencies ──────────────────────────────
step "Installing build dependencies..."
pip install --quiet pyinstaller
pip install --quiet -r requirements.txt

# ── Prepare package structure ───────────────────────────────
step "Preparing agent package..."
mkdir -p agent
touch agent/__init__.py
cp -r src agent/src

# ── Build ───────────────────────────────────────────────────
step "Building binary..."
pyinstaller \
  --onefile \
  --name logvault-agent \
  --hidden-import agent.src.readers.file_reader \
  --hidden-import agent.src.readers.journald_reader \
  --hidden-import agent.src.transport.http \
  --hidden-import pydantic \
  --hidden-import yaml \
  --paths . \
  entrypoint.py

# ── Cleanup build artifacts ─────────────────────────────────
rm -rf agent build *.spec

# ── Package ─────────────────────────────────────────────────
step "Packaging..."
mkdir -p release
cp dist/logvault-agent release/
cp config.yaml release/
cp install.sh release/

info "Done! Binary: release/logvault-agent"
info ""
info "To deploy on any Linux machine:"
info "  scp -r release/ user@host:~/logvault-agent/"
info "  ssh user@host 'cd ~/logvault-agent && sudo ./install.sh'"
