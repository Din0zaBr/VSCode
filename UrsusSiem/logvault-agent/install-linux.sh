#!/usr/bin/env bash
################################################################################
#
# URSUS SIEM Agent Installer — Interactive Setup
#
# Features:
#   - Detects existing installations
#   - Interactive configuration (server URL, API key, agent ID)
#   - Can update, remove, or reinstall existing agent
#   - Creates systemd service for auto-start
#   - Supports both journald and file-based log collection
#
# Requirements:
#   - sudo/root access
#   - Python 3.8+
#   - curl
#
################################################################################

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
readonly GREEN='\033[0;32m'
readonly RED='\033[0;31m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly NC='\033[0m'

# ── Messages ────────────────────────────────────────────────────────────────
success() { echo -e "${GREEN}[✓]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
info()    { echo -e "${CYAN}[i]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
step()    { echo -e "${BOLD}${CYAN}>>>${NC} $*"; }

# ── Config ──────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/ursus-agent"
CONFIG_DIR="${INSTALL_DIR}/etc"
DATA_DIR="/var/lib/ursus-agent"
SERVICE_NAME="ursus-agent"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if running as root
[[ $EUID -ne 0 ]] && error "This script must be run as root (use: sudo $0)"

# ──────────────────────────────────────────────────────────────────────────────
# DETECT EXISTING INSTALLATION
# ──────────────────────────────────────────────────────────────────────────────

existing_install_check() {
  if [[ -d "$INSTALL_DIR" ]]; then
    return 0  # exists
  fi
  return 1  # does not exist
}

show_header() {
  echo ""
  echo -e "${CYAN}${BOLD}╔═══════════════════════════════════════╗${NC}"
  echo -e "${CYAN}${BOLD}║   URSUS SIEM Agent Installer         ║${NC}"
  echo -e "${CYAN}${BOLD}╚═══════════════════════════════════════╝${NC}"
  echo ""
}

# ──────────────────────────────────────────────────────────────────────────────
# MAIN MENU
# ──────────────────────────────────────────────────────────────────────────────

show_main_menu() {
  echo ""
  if existing_install_check; then
    info "Existing installation found at ${INSTALL_DIR}"
    echo ""
    echo "Select action:"
    echo "  1) Reinstall (clean)"
    echo "  2) Update configuration"
    echo "  3) Change API key"
    echo "  4) Uninstall"
    echo "  5) Exit"
    echo ""
  else
    echo "Select action:"
    echo "  1) Install agent (new)"
    echo "  2) Exit"
    echo ""
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# INTERACTIVE INPUT
# ──────────────────────────────────────────────────────────────────────────────

read_server_url() {
  local default="${1:-http://localhost:8080}"
  echo ""
  echo "Enter SIEM server URL:"
  echo "  (default: ${default})"
  read -p "  > " input
  echo "${input:-$default}"
}

read_api_key() {
  local default="${1:-changeme-agent-key}"
  echo ""
  echo "Enter API key for agent:"
  echo "  (default: ${default})"
  read -sp "  > " input
  echo ""
  echo "${input:-$default}"
}

read_agent_id() {
  local default="${1:-$(hostname -s)}"
  echo ""
  echo "Enter agent ID (name):"
  echo "  (default: ${default})"
  read -p "  > " input
  echo "${input:-$default}"
}

read_log_sources() {
  echo ""
  echo "Select log sources to monitor:"
  echo "  1) systemd journal (journald) - recommended"
  echo "  2) Files only (syslog, auth.log, etc.)"
  echo "  3) Both"
  echo ""
  read -p "Choose [1-3]: " choice
  echo "$choice"
}

# ──────────────────────────────────────────────────────────────────────────────
# STOP EXISTING SERVICE
# ──────────────────────────────────────────────────────────────────────────────

stop_service() {
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    step "Stopping existing ${SERVICE_NAME} service..."
    systemctl stop "$SERVICE_NAME" || true
    success "Service stopped"
  fi
}

# ──────────────────────────────────────────────────────────────────────────────
# UNINSTALL
# ──────────────────────────────────────────────────────────────────────────────

uninstall_agent() {
  echo ""
  echo -e "${YELLOW}This will remove the agent from your system.${NC}"
  read -p "Are you sure? (y/N): " confirm
  [[ "$confirm" != "y" ]] && { info "Cancelled"; return; }

  step "Uninstalling ${SERVICE_NAME}..."

  # Stop service
  stop_service

  # Remove service file
  if [[ -f "$SERVICE_FILE" ]]; then
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
    success "Service removed"
  fi

  # Remove installation
  if [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
    success "Installation directory removed"
  fi

  # Remove data directory
  if [[ -d "$DATA_DIR" ]]; then
    rm -rf "$DATA_DIR"
    success "Data directory removed"
  fi

  success "Agent uninstalled successfully"
  echo ""
}

# ──────────────────────────────────────────────────────────────────────────────
# INSTALL / CONFIGURE
# ──────────────────────────────────────────────────────────────────────────────

install_python_dependencies() {
  step "Installing Python dependencies..."

  # Check Python version
  if ! command -v python3 &>/dev/null; then
    error "Python 3 is not installed. Please install python3 first."
  fi

  python_version=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  info "Using Python ${python_version}"

  # Create venv
  python3 -m venv "${INSTALL_DIR}/venv"
  success "Virtual environment created"

  # Install requirements
  "${INSTALL_DIR}/venv/bin/pip" install -q --upgrade pip setuptools wheel
  "${INSTALL_DIR}/venv/bin/pip" install -q pyyaml requests

  success "Dependencies installed"
}

create_agent_code() {
  step "Creating agent code..."

  # Create directories
  mkdir -p "${INSTALL_DIR}/src"
  mkdir -p "${DATA_DIR}"

  # Copy agent code from project directory
  if [[ -d "${SCRIPT_DIR}/src" ]]; then
    cp -r "${SCRIPT_DIR}/src"/* "${INSTALL_DIR}/src/" 2>/dev/null || true
    success "Agent code copied"
  else
    warn "Agent source code not found in ${SCRIPT_DIR}/src"
    info "Creating minimal agent code..."

    # Create minimal agent if source not available
    cat > "${INSTALL_DIR}/src/main.py" << 'AGENT_EOF'
#!/usr/bin/env python3
import sys
import time
import yaml
import requests
import json
from datetime import datetime

def load_config(config_file):
    with open(config_file) as f:
        return yaml.safe_load(f)

def collect_logs(config):
    """Minimal log collector - reads from /var/log files"""
    import subprocess

    logs = []
    for log_file in config.get('log_sources', ['/var/log/syslog', '/var/log/auth.log']):
        try:
            # Get last 100 lines from each log file
            result = subprocess.run(['tail', '-n', '100', log_file],
                                  capture_output=True, text=True, timeout=5)
            for line in result.stdout.strip().split('\n'):
                if line.strip():
                    logs.append({
                        'timestamp': datetime.utcnow().isoformat() + 'Z',
                        'host': config.get('agent_id', 'unknown'),
                        'source': log_file,
                        'message': line,
                        'level': 'INFO'
                    })
        except Exception as e:
            print(f"[ERROR] Failed to read {log_file}: {e}", file=sys.stderr)

    return logs

def send_logs(config, logs):
    """Send logs to SIEM server"""
    if not logs:
        return True

    try:
        url = f"{config['server_url']}/api/ingest"
        headers = {'X-Api-Key': config['api_key']}
        payload = {
            'agent_id': config['agent_id'],
            'logs': logs[:100]  # Batch size
        }

        response = requests.post(url, json=payload, headers=headers, timeout=10)

        if response.status_code == 200:
            result = response.json()
            print(f"[INFO] Indexed {result.get('indexed', 0)} events")
            return True
        else:
            error_msg = response.json().get('error', 'Unknown error')
            print(f"[WARN] Server returned {response.status_code}: {error_msg}", file=sys.stderr)
            return False
    except requests.exceptions.RequestException as e:
        print(f"[WARN] Connection error: {e}", file=sys.stderr)
        return False

def main():
    import os
    config_file = os.environ.get('URSUS_CONFIG', '/opt/ursus-agent/etc/config.yaml')

    if not os.path.exists(config_file):
        print(f"[ERROR] Config file not found: {config_file}", file=sys.stderr)
        sys.exit(1)

    config = load_config(config_file)

    print(f"[INFO] URSUS Agent starting for {config['agent_id']}")
    print(f"[INFO] Server: {config['server_url']}")

    interval = config.get('batch_interval', 5)

    while True:
        try:
            logs = collect_logs(config)
            if logs:
                send_logs(config, logs)
            time.sleep(interval)
        except KeyboardInterrupt:
            print("\n[INFO] Shutting down...")
            break
        except Exception as e:
            print(f"[ERROR] {e}", file=sys.stderr)
            time.sleep(interval)

if __name__ == '__main__':
    main()
AGENT_EOF
    chmod +x "${INSTALL_DIR}/src/main.py"
    success "Minimal agent created"
  fi
}

create_config() {
  local server_url="$1"
  local api_key="$2"
  local agent_id="$3"
  local log_sources="$4"

  mkdir -p "$CONFIG_DIR"

  step "Creating configuration..."

  # Determine log sources based on user choice
  local sources='[]'
  case "$log_sources" in
    1)
      # journald only
      sources='["journald"]'
      ;;
    2)
      # files only
      sources='["/var/log/syslog", "/var/log/auth.log", "/var/log/kern.log"]'
      ;;
    3)
      # both
      sources='["journald", "/var/log/syslog", "/var/log/auth.log", "/var/log/kern.log"]'
      ;;
  esac

  cat > "${CONFIG_DIR}/config.yaml" << EOF
# URSUS SIEM Agent Configuration
server_url: "${server_url}"
api_key: "${api_key}"
agent_id: "${agent_id}"

# Log collection settings
log_sources: ${sources}
batch_size: 100
batch_interval: 5

# Monitoring
enable_metrics: true
metrics_interval: 30
EOF

  chmod 600 "${CONFIG_DIR}/config.yaml"
  success "Configuration created at ${CONFIG_DIR}/config.yaml"
}

create_systemd_service() {
  step "Creating systemd service..."

  mkdir -p /etc/systemd/system

  cat > "$SERVICE_FILE" << 'SYSTEMD_EOF'
[Unit]
Description=URSUS SIEM Agent
Documentation=https://github.com/ursus-siem/logvault-agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ursus-agent
Environment="URSUS_CONFIG=/opt/ursus-agent/etc/config.yaml"
ExecStart=/opt/ursus-agent/venv/bin/python3 /opt/ursus-agent/src/main.py

# Auto-restart on failure
Restart=always
RestartSec=5

# Resource limits
MemoryMax=256M
CPUQuota=50%

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ursus-agent

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

  chmod 644 "$SERVICE_FILE"
  systemctl daemon-reload
  success "Systemd service created"
}

start_service() {
  step "Starting ${SERVICE_NAME} service..."

  if systemctl start "$SERVICE_NAME"; then
    success "Service started"
    systemctl enable "$SERVICE_NAME" > /dev/null 2>&1
    success "Service enabled for auto-start"
  else
    error "Failed to start service. Check logs with: journalctl -u ${SERVICE_NAME}"
  fi
}

show_status() {
  echo ""
  echo -e "${BOLD}Agent Installation Complete!${NC}"
  echo ""
  echo "Status:"
  systemctl status "$SERVICE_NAME" --no-pager | grep -E "Active|Main PID"
  echo ""
  echo "Check logs with:"
  echo "  journalctl -u ${SERVICE_NAME} -f"
  echo ""
  echo "View/edit configuration:"
  echo "  sudo nano ${CONFIG_DIR}/config.yaml"
  echo ""
  echo "Uninstall with:"
  echo "  sudo $0"
  echo ""
}

# ──────────────────────────────────────────────────────────────────────────────
# UPDATE CONFIGURATION
# ──────────────────────────────────────────────────────────────────────────────

update_config() {
  if [[ ! -f "${CONFIG_DIR}/config.yaml" ]]; then
    error "Configuration file not found"
  fi

  echo ""
  info "Current configuration:"
  grep -E "^(server_url|api_key|agent_id):" "${CONFIG_DIR}/config.yaml" || true
  echo ""

  # Read new values (use existing as defaults)
  current_server=$(grep "^server_url:" "${CONFIG_DIR}/config.yaml" | cut -d' ' -f2)
  current_key=$(grep "^api_key:" "${CONFIG_DIR}/config.yaml" | cut -d' ' -f2)
  current_id=$(grep "^agent_id:" "${CONFIG_DIR}/config.yaml" | cut -d' ' -f2)

  SERVER_URL=$(read_server_url "$current_server")
  API_KEY=$(read_api_key "$current_key")
  AGENT_ID=$(read_agent_id "$current_id")

  step "Updating configuration..."

  # Use sed to update config
  sed -i "s|^server_url:.*|server_url: ${SERVER_URL}|" "${CONFIG_DIR}/config.yaml"
  sed -i "s|^api_key:.*|api_key: ${API_KEY}|" "${CONFIG_DIR}/config.yaml"
  sed -i "s|^agent_id:.*|agent_id: ${AGENT_ID}|" "${CONFIG_DIR}/config.yaml"

  success "Configuration updated"

  step "Restarting service..."
  systemctl restart "$SERVICE_NAME"
  success "Service restarted"
}

change_api_key() {
  if [[ ! -f "${CONFIG_DIR}/config.yaml" ]]; then
    error "Configuration file not found"
  fi

  current_key=$(grep "^api_key:" "${CONFIG_DIR}/config.yaml" | cut -d' ' -f2)
  echo ""
  echo "Current API key: ${current_key}"
  echo ""

  API_KEY=$(read_api_key "$current_key")

  step "Updating API key..."
  sed -i "s|^api_key:.*|api_key: ${API_KEY}|" "${CONFIG_DIR}/config.yaml"
  success "API key updated"

  step "Restarting service..."
  systemctl restart "$SERVICE_NAME"
  success "Service restarted"
}

# ──────────────────────────────────────────────────────────────────────────────
# MAIN FLOW
# ──────────────────────────────────────────────────────────────────────────────

main() {
  show_header

  if existing_install_check; then
    while true; do
      show_main_menu
      read -p "Choose action [1-5]: " choice

      case "$choice" in
        1) stop_service; uninstall_agent; break ;;
        2) update_config; break ;;
        3) change_api_key; break ;;
        4) uninstall_agent; break ;;
        5) info "Exiting"; exit 0 ;;
        *) warn "Invalid choice" ;;
      esac
    done
  else
    read -p "Continue with fresh installation? (y/N): " confirm
    [[ "$confirm" != "y" ]] && { info "Cancelled"; exit 0; }
  fi

  # Fresh install flow
  if [[ "$choice" == "1" ]] || ! existing_install_check; then
    SERVER_URL=$(read_server_url)
    API_KEY=$(read_api_key)
    AGENT_ID=$(read_agent_id)
    LOG_SOURCES=$(read_log_sources)

    echo ""
    echo "Summary:"
    echo "  Server URL: $SERVER_URL"
    echo "  Agent ID: $AGENT_ID"
    echo "  Install path: $INSTALL_DIR"
    echo ""

    read -p "Proceed with installation? (y/N): " confirm
    [[ "$confirm" != "y" ]] && { info "Cancelled"; exit 0; }

    # Execute installation
    stop_service
    mkdir -p "$INSTALL_DIR"
    install_python_dependencies
    create_agent_code
    create_config "$SERVER_URL" "$API_KEY" "$AGENT_ID" "$LOG_SOURCES"
    create_systemd_service
    start_service
    show_status
  fi
}

# Run main function
main "$@"
