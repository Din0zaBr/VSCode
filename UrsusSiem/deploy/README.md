# deploy/ — развёртывание URSUS SIEM

Здесь docker-compose файлы, Caddyfile и шаблон .env для всех trrier'ов.

## Файлы

| | Tier | Что добавляет |
|---|---|---|
| `docker-compose.yml`         | **Micro** | Базовый стек: Postgres + engine + gateway + ui + caddy |
| `docker-compose.medium.yml`  | **S/M** preview | ClickHouse как hot storage |
| `docker-compose.pro.yml`     | **Pro** preview | logvault-llm сервис |
| `Caddyfile`                  | — | Reverse-proxy: `/api/*` → gateway, `/` → ui |
| `.env.example`               | — | Шаблон секретов — копируется в `.env` через `install.sh` |

## Быстрый запуск

### 1. Базовый (Micro)

```bash
cd deploy
cp .env.example .env
# отредактируй .env: задай JWT_SECRET, ADMIN_PASSWORD_HASH, API_KEYS
docker compose up -d
```

После запуска:
- UI: <http://localhost/>
- API: <http://localhost:8080/api>
- Syslog: UDP/TCP `:514`

### 2. S/M tier (с ClickHouse)

```bash
docker compose -f docker-compose.yml -f docker-compose.medium.yml up -d
```

Hot storage переезжает с Postgres на ClickHouse. Постгрес остаётся для
метаданных (правила, пользователи, audit-log).

### 3. Pro tier (с LLM)

```bash
# Положи GGUF модель в ../models/vikhr-7b-instruct.gguf (~5 GB)
docker compose -f docker-compose.yml -f docker-compose.pro.yml --profile ai up -d
```

После старта в UI на странице Events появится поле «Спросить по-человечески».

## Что в .env

| Переменная | Что | По умолчанию |
|---|---|---|
| `JWT_SECRET` | Подпись JWT-токенов | случайная при `install.sh` |
| `ADMIN_USERNAME` | Имя стартового админа | `admin` |
| `ADMIN_PASSWORD_HASH` | bcrypt-хеш пароля | генерится при первом запуске |
| `API_KEYS` | Ключи для агентов (через запятую) | случайные при `install.sh` |
| `POSTGRES_PASSWORD` | Пароль PG | случайный при `install.sh` |
| `CORS_ORIGINS` | Allowed origins | `*` |
| `URSUS_SYSLOG_UDP/TCP` | Адрес syslog listener | `:514` |
| `CLICKHOUSE_PASSWORD` | для S/M tier | `ursus-secret` |
| `URSUS_LLM_MODELS_DIR` | Куда смонтировать модели | `../models` |
| `URSUS_LLM_GPU_LAYERS` | GPU offload (0 = CPU only) | `0` |

## Backup

```bash
# Postgres (Micro)
docker exec ursus-postgres-1 pg_dump -U logvault logvault > backup-$(date +%F).sql

# ClickHouse (S/M)
docker exec ursus-clickhouse clickhouse-backup create
docker exec ursus-clickhouse clickhouse-backup upload --tables=ursus.* ...

# Конфиг
tar czf backup-config-$(date +%F).tar.gz \
    .env \
    ../server/configs/scenarios \
    ../server/configs/compliance \
    Caddyfile
```

## Логи и debug

```bash
docker compose logs -f                # всё
docker compose logs -f gateway        # только Go gateway
docker compose logs -f engine         # только Rust engine
docker compose exec gateway sh        # внутрь контейнера

# Prometheus метрики
curl http://localhost:8080/metrics
```

## Что дальше

- Установить агенты: [docs/agent-deploy.md](../docs/agent-deploy.md)
- Настроить Telegram: [docs/notifications/telegram.md](../docs/notifications/telegram.md)
- ФСТЭК отчёты: [docs/compliance/fstec-21.md](../docs/compliance/fstec-21.md)
- Проблемы: [docs/troubleshooting.md](../docs/troubleshooting.md)
