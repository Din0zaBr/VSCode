# URSUS SIEM Agent — Linux Installation & Setup

This directory contains the unified Linux agent installer for URSUS SIEM. The `install-linux.sh` script handles all aspects of agent installation, configuration, updates, and removal.

## Quick Start

### Prerequisites
- Linux system (Ubuntu 20.04+, CentOS 8+, Debian 11+, or similar)
- `sudo` access or root user
- Python 3.8+ (installed automatically if missing)
- Network connectivity to SIEM server

### Installation

```bash
# Download the installer
curl -o install-linux.sh https://your-siem-server/logvault-agent/install-linux.sh
chmod +x install-linux.sh

# Run installer (requires sudo)
sudo ./install-linux.sh
```

The script will detect your system and guide you through:
1. **Server URL** — SIEM backend address (e.g., `http://localhost:8080`)
2. **API Key** — Authentication key from SIEM admin panel
3. **Agent ID** — Unique identifier (defaults to hostname)
4. **Log Sources** — Which logs to collect (journald, syslog, auth, etc.)

## Features

### ✓ Smart Installation Detection
- Automatically detects existing installations
- Offers context-aware menu based on current state:
  - **New Install** → Full setup wizard
  - **Existing Install** → Update, reconfigure, change API key, or uninstall
  - **Update** → Change configuration without full reinstall

### ✓ Python Virtual Environment
- Creates isolated Python environment at `/opt/ursus-agent/venv`
- Installs dependencies: `pyyaml`, `requests`
- No system-wide Python modifications

### ✓ Log Collection Support
- **journald** — Modern systemd journal (default)
- **syslog** — `/var/log/syslog` (Debian/Ubuntu)
- **auth** — `/var/log/auth.log` (authentication events)
- **messages** — `/var/log/messages` (RedHat/CentOS)
- **cron** — `/var/log/cron` (scheduled tasks)
- **Custom files** — Add any log file path

### ✓ Systemd Service Management
- Automatic service creation and registration
- Auto-start on boot
- Graceful stop/start during updates
- Service status monitoring: `systemctl status ursus-agent`

### ✓ Configuration Management
- Interactive config file at `/opt/ursus-agent/etc/config.yaml`
- Update config without reinstalling: `sudo ./install-linux.sh` → "Update Config"
- Change API key on-the-fly: `sudo ./install-linux.sh` → "Change API Key"
- All settings YAML-formatted for easy editing

### ✓ Clean Uninstallation
- Integrated uninstall with confirmation
- Removes service, config, and application files
- Preserves data directory for recovery if needed

## Directory Structure

```
/opt/ursus-agent/                 # Installation directory
├── venv/                          # Python virtual environment
│   ├── bin/python3                # Isolated Python binary
│   └── lib/                       # pip packages (pyyaml, requests)
├── src/                           # Agent source code
│   ├── main.py                    # Agent entry point
│   ├── config.py                  # Configuration loader
│   ├── models.py                  # Data models
│   ├── buffer.py                  # Offline buffering
│   ├── readers/                   # Log readers
│   │   ├── journald_reader.py
│   │   ├── file_reader.py
│   │   └── ...
│   └── transport/                 # Network transport
│       ├── http.py                # HTTP sender
│       └── ...
└── etc/
    └── config.yaml                # Agent configuration

/var/lib/ursus-agent/              # Data directory
└── buffer.db                       # Offline event buffer

/etc/systemd/system/
└── ursus-agent.service            # Systemd service unit
```

## Configuration File Format

The `config.yaml` file controls agent behavior:

```yaml
# Connection settings
server_url: "http://localhost:8080"
api_key: "your-api-key-here"
agent_id: "hostname"

# Batch settings
batch_size: 100
batch_interval: 5

# Log sources to collect
log_sources:
  - journald              # systemd journal
  - /var/log/syslog       # Syslog file
  - /var/log/auth.log     # Authentication events
  - /var/log/cron         # Cron jobs
  - /var/log/custom.log   # Any custom log file
```

## Common Tasks

### Check Agent Status
```bash
# View service status
sudo systemctl status ursus-agent

# View recent agent logs
sudo journalctl -u ursus-agent -n 50

# View full agent log
tail -f /var/lib/ursus-agent/agent.log
```

### Update Configuration
```bash
# Run interactive config update
sudo ./install-linux.sh

# Select "Update Config" option
# Edit settings as prompted
```

### Change API Key
```bash
sudo ./install-linux.sh

# Select "Change API Key" option
# Enter new key when prompted
```

### View Current Configuration
```bash
cat /opt/ursus-agent/etc/config.yaml
```

### Uninstall Agent
```bash
sudo ./install-linux.sh

# Select "Uninstall" option
# Confirm removal
```

### Manual Service Control
```bash
# Start agent
sudo systemctl start ursus-agent

# Stop agent
sudo systemctl stop ursus-agent

# Restart agent
sudo systemctl restart ursus-agent

# Enable/disable auto-start
sudo systemctl enable ursus-agent
sudo systemctl disable ursus-agent
```

## Troubleshooting

### Agent fails to start
1. Check service status: `sudo systemctl status ursus-agent`
2. View logs: `sudo journalctl -u ursus-agent -n 100`
3. Verify config file: `cat /opt/ursus-agent/etc/config.yaml`
4. Test connectivity: `curl -v http://your-siem-server:8080/health`

### API key validation fails
1. Verify API key in config: `grep api_key /opt/ursus-agent/etc/config.yaml`
2. Check key is enabled in SIEM admin panel
3. Generate new key if expired: `sudo ./install-linux.sh` → "Change API Key"

### No logs being collected
1. Check log sources in config: `grep log_sources -A 5 /opt/ursus-agent/etc/config.yaml`
2. Verify agent has read permissions: `sudo -u ursus-agent cat /var/log/syslog`
3. Check journald permissions: `sudo -u ursus-agent journalctl -n 1`
4. Verify log files exist and are readable

### Agent crashes or restarts repeatedly
1. Check service logs: `sudo journalctl -u ursus-agent -n 200`
2. Review config for syntax errors: `python3 /opt/ursus-agent/src/config.py /opt/ursus-agent/etc/config.yaml`
3. Verify disk space: `df -h /var/lib/ursus-agent`
4. Check network connectivity: `curl -I http://your-siem-server:8080`

### Permission denied errors
1. Ensure script runs with sudo: `sudo ./install-linux.sh`
2. Check file permissions: `ls -la /opt/ursus-agent/etc/`
3. Verify systemd service user: `grep User= /etc/systemd/system/ursus-agent.service`

## Advanced Configuration

### Add Custom Log File
Edit `/opt/ursus-agent/etc/config.yaml` and add the file path to `log_sources`:

```yaml
log_sources:
  - journald
  - /var/log/syslog
  - /var/log/custom-app.log  # Add your custom log
```

Then restart the agent:
```bash
sudo systemctl restart ursus-agent
```

### Change Batch Settings
Edit `/opt/ursus-agent/etc/config.yaml`:

```yaml
batch_size: 500        # Collect 500 events before sending
batch_interval: 10     # Send every 10 seconds, even if batch not full
```

These settings balance network usage vs. real-time detection.

### View Agent Source Code
```bash
# Explore agent implementation
ls -la /opt/ursus-agent/src/
cat /opt/ursus-agent/src/main.py

# View dependencies
pip list --path /opt/ursus-agent/venv/
```

## Security Considerations

1. **API Key Protection** — The API key in `config.yaml` should be treated as a secret
   - File permissions are `0600` (readable by root/service only)
   - Never commit API keys to version control

2. **Log File Permissions** — Agent runs as `ursus-agent` user
   - Ensure user has read permissions to log files
   - Use log rotation to prevent disk fill

3. **Network Security**
   - Use HTTPS to SIEM server (configure as `https://` in config)
   - Consider firewall rules limiting agent outbound connections
   - Verify server certificate if using self-signed HTTPS

4. **Service Isolation** — Agent runs in isolated systemd service
   - Has no shell access
   - Runs with minimal privileges (non-root)
   - No network listening (only outbound connections)

## Support & Issues

For issues or feature requests:
1. Check logs: `sudo journalctl -u ursus-agent -n 200`
2. Review configuration: `cat /opt/ursus-agent/etc/config.yaml`
3. Verify network connectivity: `curl http://your-siem-server:8080/health`
4. Report issues with complete logs and configuration (redact API keys)

## Version History

- **v1.0** (2024-04-21) — Initial release
  - Interactive installation wizard
  - Multi-source log collection (journald, syslog, custom files)
  - Automatic service management
  - Configuration updates without reinstall
  - Built-in uninstall functionality
