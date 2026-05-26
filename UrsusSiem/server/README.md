# server/ — серверная часть URSUS SIEM

Всё что крутится **на стороне URSUS-сервера** (не на хостах клиента).

## Структура

```
server/
├── gateway/      # Go API gateway (logvault-go)
│                 # REST API + WebSocket + syslog listener + embedded UI
│                 # Порт: 8080 (HTTP), 514 (syslog UDP/TCP)
│
├── engine/       # Rust микросервис (logvault-engine)
│                 # Парсер логов · корреляция · SIGMA · ML · OCSF · Threat Intel
│                 # Порт: 8001 (вызывается gateway-ем)
│
├── llm/          # 🔴 v2.2 preview — Python LLM сервис (Pro tier)
│                 # llama.cpp + Vikhr 7B · NL→PDQL · объяснение алертов
│                 # Порт: 8000
│
├── ui/           # React + TypeScript + Vite (Cyber Forest theme)
│                 # Сборка через npm run build → встраивается в gateway
│
├── migrations/   # SQL миграции для всех БД
│                 # *.sql применяются автоматически при первом запуске Postgres
│                 # clickhouse/*.sql — для S/M tier (deploy/docker-compose.medium.yml)
│
└── configs/      # Конфиги, монтируются в gateway-контейнер
    ├── scenarios/    # 20 готовых сценариев (rdp-brute-force, ransomware, …)
    ├── sigma_rules/  # 60 SIGMA-правил
    └── compliance/   # Шаблон отчёта ФСТЭК №21 + typst-рендеринг
```

## Запуск целиком

Из корня репо:
```bash
docker compose -f deploy/docker-compose.yml up -d
```

Поднимет Postgres + engine + gateway + ui + caddy.

## Запуск отдельных компонентов для разработки

### Gateway (Go)
```bash
cd server/gateway
go build ./...
DATABASE_URL=postgres://... ENGINE_URL=http://localhost:8001 ./gateway
```

### Engine (Rust)
```bash
cd server/engine
cargo build --release
./target/release/logvault-engine
```

### LLM (Pro tier)
```bash
cd server/llm
docker build -t ursus-llm .
docker run -v $(pwd)/../../models:/models:ro -p 8000:8000 ursus-llm
```

### UI (dev mode)
```bash
cd server/ui
npm install
npm run dev   # http://localhost:5173 с прокси на http://localhost:8080/api
```

## Дополнительная документация

- [docs/api.md](../docs/api.md) — REST API reference
- [docs/migration.md](../docs/migration.md) — миграция с Python-стека
- [PLAN_V2.md](../PLAN_V2.md) — архитектурный план
