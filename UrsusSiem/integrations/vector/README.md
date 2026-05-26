# URSUS SIEM ⇄ Vector profiles

[Vector](https://vector.dev) is a high-performance log/metrics router
written in Rust. URSUS accepts Vector's `http` sink with the `ndjson`
codec out of the box via the `POST /api/ingest/vector` endpoint.

## Why Vector over our own agent?

| | Vector | URSUS agent |
|---|---|---|
| Inputs supported | 60+ (journald, file, k8s, kafka, syslog, …) | 2–3 |
| Buffer-on-disk during outage | ✅ built-in | basic |
| Throughput | 100K+ events/sec | ~10K |
| Resource footprint | ~30–80 MB RAM | similar |
| Community / docs | large | none |
| Windows EventLog | ✅ | ❌ |

**Recommendation:** use Vector for log collection. Keep the URSUS agent for
EDR-style host telemetry (processes, USB, file integrity) — Sprint 11.

## Profiles in this directory

| File | Where to install | What it collects |
|---|---|---|
| [`linux-server.yaml`](linux-server.yaml) | Each Linux host | `journald` + `/var/log/auth.log`, `/var/log/syslog` |
| [`windows-server.yaml`](windows-server.yaml) | Each Windows host | Security/System/Application event logs |
| [`network-syslog.yaml`](network-syslog.yaml) | A relay host in the DMZ | Receives syslog UDP/TCP, forwards to URSUS |

## Quick start (Linux)

```bash
# 1. install Vector
curl -1sLf https://repositories.timber.io/public/vector/setup.deb.sh | sudo -E bash
sudo apt-get install -y vector

# 2. drop in the profile
sudo curl -fsSL https://raw.githubusercontent.com/Din0zaBr/VSCode/main/UrsusSiem/integrations/vector/linux-server.yaml \
  -o /etc/vector/vector.yaml

# 3. environment with URSUS server + API key
sudo tee /etc/default/vector >/dev/null <<EOF
URSUS_SERVER=https://siem.example.com
URSUS_API_KEY=changeme-agent-key
EOF

# 4. restart
sudo systemctl restart vector
sudo journalctl -u vector -f       # check logs flow
```

Within ~10 seconds you should see events on the URSUS UI **Live Logs** page.

## Quick start (Windows)

```powershell
Invoke-WebRequest https://packages.timber.io/vector/0.40.0/vector-0.40.0-x86_64-pc-windows-msvc.zip -OutFile vector.zip
Expand-Archive vector.zip -DestinationPath 'C:\Program Files\Vector'

# copy windows-server.yaml here:
Copy-Item windows-server.yaml 'C:\Program Files\Vector\config\vector.yaml'

# set environment variables
[Environment]::SetEnvironmentVariable('URSUS_SERVER', 'https://siem.example.com', 'Machine')
[Environment]::SetEnvironmentVariable('URSUS_API_KEY', 'changeme-agent-key', 'Machine')

# register and start as a service
New-Service -Name Vector -BinaryPathName '"C:\Program Files\Vector\bin\vector.exe" --config "C:\Program Files\Vector\config\vector.yaml"'
Start-Service Vector
```

## Quick start (Syslog relay)

```bash
# on a small VM (1 vCPU / 512 MB is enough)
sudo apt-get install -y vector
sudo cp network-syslog.yaml /etc/vector/vector.yaml
sudo systemctl restart vector

# point network gear at this host on UDP/TCP 514
```

If your network appliances cannot reach an internal aggregator, point them
directly at the **URSUS syslog listener** (also UDP/TCP 514) — see
[`docs/syslog.md`](../../docs/syslog.md).

## Authentication

All profiles use `X-Api-Key` header authentication. Generate keys via:

```bash
curl -X POST http://localhost:8080/api/admin/api-keys \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "linux-fleet"}'
```

For TLS, route Vector through Caddy (which already terminates TLS) on
port 443 with the same URI.

## Validating

```bash
# locally
vector validate /etc/vector/vector.yaml

# tail Vector's own logs
journalctl -u vector -f
```

If events don't show up in URSUS:
1. Check Vector logs for HTTP 4xx/5xx
2. Verify `URSUS_API_KEY` is in URSUS's `API_KEYS` env list
3. `curl -k https://siem.example.com/api/ingest/vector -H "X-Api-Key: …"` — should return 401 *with* key error, not connection refused
