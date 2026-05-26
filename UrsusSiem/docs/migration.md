# Rust + Go Microservices Architecture

This directory contains the rewritten URSUS SIEM backend using a hybrid Rust + Go architecture for improved performance and reliability.

## Architecture Overview

- **logvault-rust**: Correlation engine + log parser (Axum microservice on port 8001)
  - SIGMA rule evaluation
  - Log format parsing (RFC5424, RFC3164, CEF, HTTP access log)
  - Event enrichment (IP extraction, category detection)
  - PDQL → PostgreSQL translation
  
- **logvault-go**: API gateway + ingestion layer (Gin server on port 8080)
  - JWT + API key authentication
  - Request routing to Rust engine
  - PostgreSQL database operations
  - WebSocket live log streaming
  - Fallback path when Rust engine unavailable

- **PostgreSQL**: Data storage (port 5432)
  - logs table: event storage with JSONB metadata
  - correlation_alerts: triggered rule alerts
  - sigma_rules: SIGMA rule definitions
  - incident_scenarios: incident templates
  - custom_fields: flexible field definitions

## Quick Start

### Prerequisites
- Docker & Docker Compose
- (Or: Rust 1.77+, Go 1.22+, PostgreSQL 16+)

### With Docker Compose
```bash
# Copy .env.example to .env and customize
cp .env.example .env

# Start all services (includes UI dev server in dev profile)
docker-compose up -d

# With UI dev server
docker-compose --profile dev up -d

# View logs
docker-compose logs -f logvault-go
docker-compose logs -f logvault-rust
docker-compose logs -f postgres
```

Services will be available at:
- **API Gateway**: http://localhost:8080
- **Rust Engine**: http://localhost:8001
- **PostgreSQL**: localhost:5432
- **UI Dev Server**: http://localhost:5173 (if dev profile enabled)

### Local Development

**Rust Engine**:
```bash
cd logvault-rust
cargo build --release
./target/release/logvault-rust
```

**Go Gateway**:
```bash
cd logvault-go
export DATABASE_URL="postgres://logvault:logvault-secret@localhost:5432/logvault"
export ENGINE_URL="http://localhost:8001"
go run main.go
```

**PostgreSQL** (Docker):
```bash
docker run -d \
  -e POSTGRES_USER=logvault \
  -e POSTGRES_PASSWORD=logvault-secret \
  -e POSTGRES_DB=logvault \
  -p 5432:5432 \
  -v postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine
```

## API Endpoints

### Public
- `GET  /health` - Service health check
- `POST /api/login` - Authenticate user

### Ingestion (API Key auth)
- `POST /api/ingest` - Bulk log ingestion from agents

### Authenticated (JWT Bearer token)
- `GET  /api/search` - Full-text + filter search
- `GET  /api/search/pdql` - PDQL query execution
- `GET  /api/stats` - Time-series statistics
- `GET  /api/agents` - List agents
- `GET  /api/hosts` - List hosts
- `GET  /api/correlation/alerts` - Correlation alerts
- `PATCH /api/correlation/alerts/:id` - Update alert status
- `GET  /api/assets` - Network assets

### WebSocket
- `GET  /api/logs/live?token=<jwt>` - Live log streaming

## Environment Variables

```env
# Server
ADDR=:8080
JWT_SECRET=your-secret-key
TOKEN_TTL_HOURS=8

# Database
DATABASE_URL=postgres://logvault:logvault-secret@localhost:5432/logvault

# Auth
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<bcrypt-hash>
API_KEYS=agent-key-1,agent-key-2

# Engine
ENGINE_URL=http://localhost:8001

# CORS
CORS_ORIGINS=*

# Ingestion
MAX_BATCH_SIZE=5000
LIVE_BUFFER_SIZE=500
```

## Generating Admin Password Hash

Use bcrypt to create a password hash:

```bash
# Go
go run -exec "go tool" golang.org/x/crypto/bcrypt <<< "mypassword"

# Or use online tool: https://bcrypt-generator.com/ (for dev only)
```

## Key Design Decisions

1. **Rust for Heavy Lifting**: Correlation engine and parsing handles 100K+ EPS with low latency
2. **Go for API**: Simple, fast HTTP handling and database operations
3. **PostgreSQL**: Proven reliability, JSONB for flexible metadata storage
4. **Fallback Path**: If Rust engine unavailable, Go gateway falls back to raw ingestion
5. **WebSocket Broadcast Hub**: Live log streaming with configurable buffer
6. **Dual Authentication**: JWT for user endpoints, API keys for agent ingestion

## Performance Notes

- **Rust release build**: Optimizations enabled (opt-level=3, LTO)
- **Go binary**: Statically linked (distroless container, ~10MB)
- **PostgreSQL**: Connection pooling (2-20 conns), prepared statements
- **Database indexes**: On timestamp, agent_id, host, level, service, and JSONB metadata

## Migration from Python Backend

Previous `/server/src/` (Python FastAPI) has been replaced:
- Parser logic → `logvault-rust/src/parser/`
- Correlation engine → `logvault-rust/src/correlator/`
- PDQL translator → `logvault-rust/src/pdql/`
- API handlers → `logvault-go/internal/api/`
- Database layer → `logvault-go/internal/storage/`

The UI (`/ui/src/`) remains unchanged and communicates with the new Go gateway.

## Testing

```bash
# Test API health
curl http://localhost:8080/health

# Test login
curl -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'

# Test agent ingestion
curl -X POST http://localhost:8080/api/ingest \
  -H "X-Api-Key: agent-key-1" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "logs": [
      {
        "timestamp": "2024-01-01T12:00:00Z",
        "host": "server-1",
        "source": "syslog",
        "level": "error",
        "message": "Connection timeout",
        "service": "api"
      }
    ]
  }'
```

## Troubleshooting

**Engine not reachable at startup**: Go gateway logs a warning but continues. Ingestion falls back to raw mode.

**Database connection timeout**: Check PostgreSQL is running and DATABASE_URL is correct.

**WebSocket connection refused**: Ensure JWT token is valid and passed via `?token=` query parameter.

**High CPU usage**: Check Rust engine logs for stuck regex patterns; review SIGMA rule complexity.
