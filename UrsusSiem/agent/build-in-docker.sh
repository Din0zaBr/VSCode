#!/usr/bin/env bash
# ============================================================
# Build LogVault Agent binary inside Docker
# (no need to install Python/PyInstaller on your machine)
#
# Usage: ./build-in-docker.sh
# Output: release/logvault-agent
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "[>] Building binary inside Docker container..."

docker build -f Dockerfile.build -t logvault-agent-builder .

echo "[>] Extracting binary..."
CONTAINER_ID=$(docker create logvault-agent-builder)
mkdir -p release
docker cp "${CONTAINER_ID}:/build/dist/logvault-agent" release/logvault-agent
docker rm "${CONTAINER_ID}" >/dev/null

cp config.yaml release/
cp install.sh release/

echo "[+] Done! Files in release/:"
ls -lh release/
echo ""
echo "[+] Copy to any Linux machine and run:"
echo "    sudo ./install.sh --server https://your-server:8000 --key your-key"
