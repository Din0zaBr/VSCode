# LogVault — Project Context & Development Guide

## What is this project

LogVault is a centralized log monitoring solution consisting of three containerized services:

1. **Agent** (Python 3.12) — deployed on each target machine, reads local logs (files + journald), buffers offline, sends to server via HTTP
2. **Server** (Python 3.12, FastAPI) — central API: receives log batches, stores in PostgreSQL with service type classification, serves search/stats/WebSocket live, runs alerting engine
3. **UI** (React 18 + TypeScript + Tailwind CSS) — web dashboard: charts, heatmaps, live log stream, full-text search, alert rule management

Architecture: **Variant A** (HTTP direct). The transport layer is abstracted (`Transport` base class) so adding Kafka/NATS for Variant B requires only a new transport implementation + config switch.

---

## Technical Specification (Requirements)

### Mandatory
- Three services (agent, server, UI), each containerized including the agent
- Agent reads local logs (files and/or journald), supports follow-mode and local buffering when server is unreachable
- Full-text search across logs (engine: Elasticsearch)
- Configurable alerts for anomalies — at minimum Telegram or webhook channel; user does NOT have to enable alerts
- Real-time log viewing from the web interface (WebSocket)
- Horizontally scalable by adding agents
- Log visualization (error/warning counts, frequency, dates, heatmaps) — exclusively in the UI, no Grafana

### Evaluation Criteria
- Compliance with mandatory requirements
- Additional functionality or architectural decisions
- Code cleanliness / readability
- UX/UI, search flexibility, convenient troubleshooting for the end user
- Deployment manifest included
- Security of the solution and agent connections

### Key UX Requirement
An engineer connects to a machine with the agent, selects which programs to monitor, and the agent provides those logs. Each log entry must include at minimum: date/time, level (warn/info/error), text, application (service), and node (host).

---

## Project Structure

```
logvault/
├── agent/                     # Agent service
│   ├── Dockerfile             # python:3.12-slim + systemd
│   ├── requirements.txt       # pydantic, pyyaml, requests
│   ├── config.yaml            # Default config (mounted at /etc/logvault/)
│   └── src/
│       ├── main.py            # Entry point: reader threads + flush worker + graceful shutdown
│       ├── config.py          # Pydantic config from YAML (AgentConfig, SourceConfig)
│       ├── models.py          # LogEvent, IngestBatch with SHA-256 event_id generation
│       ├── buffer.py          # SQLite-backed offline queue (push/peek/delete)
│       ├── readers/
│       │   ├── base.py        # Abstract LogReader(source, service) -> Generator[LogEvent]
│       │   ├── file_reader.py # Tail-follow with offset persistence, parses syslog/nginx/access formats
│       │   └── journald_reader.py  # journalctl --follow --output=json subprocess
│       └── transport/
│           ├── base.py        # Abstract Transport.send(batch) -> bool
│           └── http.py        # HTTP POST /ingest with 5-attempt exponential backoff
│
├── server/                    # Server service
│   ├── Dockerfile             # python:3.12-slim, uvicorn on :8000
│   ├── requirements.txt       # fastapi, uvicorn, psycopg2-binary, pydantic, requests
│   ├── init.sql               # PostgreSQL schema (services + logs tables, indexes)
│   └── src/
│       ├── main.py            # FastAPI app with lifespan (PG init, alert thread), CORS
│       ├── config.py          # Settings from env vars (DATABASE_URL, API_KEYS, alert channels)
│       ├── auth.py            # verify_api_key dependency (X-Api-Key header)
│       ├── models.py          # LogEvent, IngestRequest/Response, AlertRule, AlertChannel, StatsQuery
│       ├── routers/
│       │   ├── ingest.py      # POST /ingest — auth, size limit, pipeline, live broadcast
│       │   ├── search.py      # GET /search — q, level, agent_id, service, host, source, from, to, page, size
│       │   ├── logs.py        # WS /logs/live — WebSocket with subscriber queues
│       │   ├── stats.py       # GET /stats — ES aggregations (over_time, by_level/service/agent/host/source, heatmap)
│       │   ├── agents.py      # GET /agents — agent list with last_seen
│       │   └── alerts.py      # GET/POST/PUT/DELETE /alerts/ — CRUD for alert rules
│       └── services/
│           ├── postgres.py       # PGService: bulk_index, search, get_stats, get_agents (PostgreSQL)
│           ├── pipeline.py       # IngestPipeline: validate -> enrich -> bulk_index
│           └── alerting.py       # Background alert loop (30s), threshold + regex rules, webhook + Telegram
│
├── ui/                        # UI service
│   ├── Dockerfile             # node:20-alpine multi-stage -> nginx:alpine
│   ├── nginx.conf             # SPA routing + /api/ proxy to server:8000
│   ├── index.html
│   ├── package.json           # react, react-router-dom, @tanstack/react-query, recharts, react-hot-toast, tailwind
│   ├── vite.config.ts         # Dev proxy /api -> localhost:8000
│   ├── tailwind.config.js     # Custom "vault" color palette
│   ├── tsconfig.json
│   ├── postcss.config.js
│   └── src/
│       ├── main.tsx           # React root: QueryClient, BrowserRouter, Toaster
│       ├── App.tsx            # Navigation (Dashboard, Live Logs, Search, Alerts) + Routes
│       ├── index.css          # Tailwind imports + custom scrollbar
│       ├── api/client.ts      # Typed API client: search, stats, agents, alerts CRUD; wsUrl()
│       ├── hooks/
│       │   ├── useWebSocket.ts  # Real-time log stream with pause/resume buffering
│       │   └── useSearch.ts     # react-query wrapper for search API
│       ├── pages/
│       │   ├── Dashboard.tsx    # Stat cards, TimeChart, PieChart, HeatMap, ServiceBar, agents table
│       │   ├── LiveLogs.tsx     # WebSocket stream, filters (text/level/service/host/agent), expandable detail
│       │   ├── Search.tsx       # Full-text search with all filters + host + source, pagination
│       │   └── Alerts.tsx       # Alert rule CRUD form (threshold/regex, webhook/telegram channels)
│       └── components/
│           ├── LogTable.tsx      # Sortable table with expandable detail row (all fields + meta)
│           ├── TimeChart.tsx     # Stacked area chart by level over time (recharts)
│           ├── LevelPieChart.tsx # Donut chart by log level
│           ├── HeatMap.tsx       # Day×Hour grid colored by volume
│           └── ServiceBarChart.tsx # Horizontal bar chart of top services
│
├── docker-compose.yml         # Central stack: postgres + server + ui
├── docker-compose.agent.yml   # Agent deploy on remote host
├── .env.example               # All config vars with comments
├── .gitignore
└── README.md                  # Full deployment guide (Russian)
```

---

## Data Model (LogEvent)

The unified contract used across all three services:

```
event_id    : str   — SHA-256 hash of timestamp+source+message (idempotent dedup)
timestamp   : str   — ISO 8601 (UTC)
host        : str   — hostname of the machine running the agent
agent_id    : str   — unique agent identifier from config
source      : str   — log origin: "/var/log/syslog", "journald:sshd", etc.
level       : str   — DEBUG | INFO | WARN | WARNING | ERROR | CRITICAL
message     : str   — log line text
service     : str   — application name: "nginx", "sshd", "syslog", etc.
meta        : dict  — structured fields extracted by readers:
                      file_reader: process, pid, syslog_host, remote_ip, method, path, status_code, body_bytes
                      journald_reader: pid, uid, gid, exe, cmdline, comm, transport, unit, boot_id, machine_id
```

## PostgreSQL Schema

- Table `services` — normalized service types (id, name UNIQUE)
- Table `logs` — all log events with `service_id` FK referencing `services(id)`, JSONB `meta` column
- Indexes: timestamp DESC, level, agent_id, service_id, host, source, GIN full-text on message
- Full-text search via `to_tsvector('simple', message) @@ plainto_tsquery()`
- Stats aggregations via SQL GROUP BY + date_trunc / date_bin

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /ingest | Receive log batch from agent (auth: X-Api-Key) |
| GET | /search | Full-text search with filters (q, level, agent_id, service, host, source, from, to, page, size) |
| GET | /stats | Aggregation data for dashboard charts |
| GET | /agents | List of connected agents with last_seen |
| WS | /logs/live | Real-time log stream via WebSocket |
| GET | /alerts/ | List alert rules |
| POST | /alerts/ | Create alert rule |
| DELETE | /alerts/{id} | Delete alert rule |
| PUT | /alerts/ | Replace all alert rules |
| GET | /health | Health check |

## Security

- API-key auth for agents (X-Api-Key header, keys in .env)
- PostgreSQL not exposed externally (docker internal network only)
- Batch size and payload limits on /ingest
- CORS configurable via CORS_ORIGINS env var
- .env excluded from version control

## Deployment

**Central server:** `docker compose up -d --build` (starts PG + server + UI)
**Each agent host:** copy agent/ + docker-compose.agent.yml, edit config.yaml, `docker compose up -d --build`

## Current Status

All core features are implemented and complete:
- [x] Agent with file + journald readers, SQLite buffer, HTTP transport
- [x] Server with FastAPI, PostgreSQL storage with service types, search, stats, WebSocket live, alerting
- [x] UI with Dashboard, Live Logs, Search, Alerts pages
- [x] Docker Compose manifests for central stack and agent
- [x] README with full deployment guide

## Architecture Decision: Variant A → B Migration Path

Current: agents POST batches directly to server over HTTP.
Future (Variant B): agents publish to a message broker (Kafka/NATS).

The migration requires only:
1. Add `KafkaTransport` in `agent/src/transport/kafka.py` implementing `Transport.send()`
2. Add Kafka to docker-compose.yml
3. Create an `Ingestor` consumer service reusing `server/src/services/pipeline.py`
4. Switch agent config: `transport: kafka`

No changes needed to: data model, PG storage, UI, search API, alerting.

## Code Conventions

- Python: type hints everywhere, Pydantic models, `from __future__ import annotations`
- TypeScript: strict mode, functional components, hooks
- Styling: Tailwind CSS with custom `vault` color palette, dark theme (gray-950 background)
- No Grafana — all visualization is custom in the React UI using recharts
