# URSUS SIEM — Architecture v2 (план)

> Документ описывает **что** меняется в v2 и **почему**. Код пишем по фазам
> ниже, каждая фаза — отдельная ветка и PR. Текущая v1 (rust-go-migration)
> остаётся живой во время миграции.

---

## 0. Цели v2 (из обсуждения)

| # | Требование | Ответ |
|---|---|---|
| 1 | БД **не реляционная**, с индексами | Колоночное OLAP-хранилище **ClickHouse** для логов и аналитики; embedded **SQLite** для конфига |
| 2 | Лёгкие **Rust-прослойки**, шлющие в хранилище через **WebSocket** | Микросервисы `logvault-edge` (приём) + `logvault-pipe` (обогащение) + `logvault-correlator` (то что уже есть), связь через WS/NATS |
| 3 | **Vector** для трансформации логов вместо своего агента | Vector как первичный коллектор. Свой агент → опционально (лёгкий fallback) |
| 4 | **WebSocket** для держания соединений | WS на трёх контурах: edge↔ingest, pipe↔storage, gateway↔UI |
| 5 | Реальная сетевая работа | Syslog UDP/TCP, GELF, Vector HTTP, статичный API key + mTLS |
| 6 | Auto-installer + готовые сценарии | Single-binary бутстрап + предзагруженные SIGMA + scenarios |
| 7 | Compliance под ФСТЭК | Отдельный модуль `logvault-reports`, шаблоны 21/31 приказов |
| 8 | Auto-baseline + EDR-light | Уже есть классический ML (commit `8cd1784`), EDR-light в агенте |
| 9 | LLM-каркас | Отдельный `logvault-llm` сервис на Python/llama.cpp, stub из Go |

---

## 1. Выбор хранилища — почему ClickHouse, а не альтернативы

| Вариант | За | Против | Вердикт |
|---|---|---|---|
| **PostgreSQL** (v1) | Знакомо, JSONB, JOIN'ы | Row-store не для логов. 10× больше диска. Compaction боль при 100M+ строк | ❌ Уходим |
| **ClickHouse** | Колоночный, **MergeTree-индексы** + skip-index + bloom-filter + minmax. Сжатие 10× плотнее Postgres. SQL→легкий transpile с PDQL | Требует RAM (минимум 4GB), eventual consistency на distributed | ✅ **Выбран** |
| **VictoriaLogs** | Заточен под логи, LogsQL мощный, очень мало RAM | Молодой, мало SDK, в РФ узкая инсталбаза | 🟡 Альтернатива для микро-инсталляций |
| **OpenSearch / ES** | Полнотекст лучший в индустрии | JVM, прожорлив, дорог в обслуживании | ❌ Не для МСБ |
| **Loki** | Метки + индекс по labels | Полнотекст слабый, JSON-поля без агрегации | ❌ Маловато для SIEM |
| **DuckDB embedded** | Zero-ops, in-process | Single-writer, не для прод-стрима | 🟡 Для dev / десктоп-режима |

### Решение: гибрид

```
┌──────────────────────────────────────────────────┐
│ ClickHouse (hot)        ── 1–90 дней, индексы    │
│   logs, anomaly_alerts, correlation_alerts, audit│
├──────────────────────────────────────────────────┤
│ SQLite (config / state) ── правила, сценарии,    │
│   пользователи, API-ключи, custom_fields         │
├──────────────────────────────────────────────────┤
│ MinIO / S3 (cold)       ── архив сжатых parquet  │
│   старше 90 дней, retention под compliance       │
└──────────────────────────────────────────────────┘
```

**Почему SQLite для конфига вместо Postgres:**
МСБ-инсталляция = один сервер. Конфиг-данные (~100 правил, ~10 пользователей) укладываются в файл `/var/lib/ursus/config.db`. Снимается зависимость на отдельный СУБД-контейнер, упрощается резерв (`cp config.db`).

Если клиент крупнее (5+ серверов) — конфиг переезжает в **etcd** или **NATS KV** (без переписывания, через тот же интерфейс репозитория).

### Индексы в ClickHouse

```sql
CREATE TABLE logs (
    timestamp     DateTime64(3) CODEC(DoubleDelta, LZ4),
    event_id      String,
    host          LowCardinality(String),
    agent_id      LowCardinality(String),
    source        LowCardinality(String),
    level         Enum8('debug'=1,'info'=2,'warning'=3,'error'=4,'critical'=5),
    service       LowCardinality(String),
    message       String CODEC(ZSTD(3)),
    meta          String CODEC(ZSTD(3)),   -- JSON-as-string, парсим JSONExtract*

    INDEX idx_msg     message TYPE tokenbf_v1(8192, 3, 0) GRANULARITY 4,
    INDEX idx_meta_ip JSONExtractString(meta,'src.ip') TYPE bloom_filter GRANULARITY 8
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (host, agent_id, timestamp)
TTL timestamp + INTERVAL 90 DAY TO VOLUME 'cold',
    timestamp + INTERVAL 365 DAY DELETE;
```

- **PARTITION BY day** — мгновенный `DROP PARTITION` для retention
- **ORDER BY (host, agent_id, timestamp)** — primary key, кластеризация на диске
- **tokenbf_v1** на `message` — full-text по словам
- **bloom_filter** на JSON-полях из meta
- **TTL** — авто-перенос в холодный том после 90 дней

---

## 2. Архитектура v2 — диаграмма

```
   ┌────────────────────────────────────────────────────────────────────┐
   │ ИСТОЧНИКИ                                                          │
   │  Windows EventLog · Linux syslog · файлы · API · Cloud Trail · …   │
   └─────────────────────────────────┬──────────────────────────────────┘
                                     │
                       ┌─────────────┴─────────────┐
                       │  Vector (или свой агент)  │   ← на хосте клиента
                       │   • inputs: 30+ типов     │
                       │   • парсинг grok/regex    │
                       │   • буфер на диске        │
                       └─────────────┬─────────────┘
                                     │ HTTP/2 + WebSocket
                                     │ (TLS, API-key)
       ╔═════════════════════════════▼══════════════════════════════════╗
       ║                    URSUS SERVER (один VPS)                      ║
       ║                                                                 ║
       ║  ┌──────────────────┐                                           ║
       ║  │ logvault-edge    │  Rust  · syslog/HTTP/WS приёмник          ║
       ║  │ (port 514, 8443) │  фронт-парсинг (RFC5424/3164/CEF/JSON)    ║
       ║  └────────┬─────────┘  валидация, backpressure, rate-limit      ║
       ║           │                                                     ║
       ║           │ NATS JetStream (persistent queue, at-least-once)    ║
       ║           ▼                                                     ║
       ║  ┌──────────────────┐                                           ║
       ║  │ logvault-pipe    │  Rust · enrichment + категоризация        ║
       ║  │                  │  (geoip, asset-lookup, MITRE-tag)         ║
       ║  └────────┬─────────┘                                           ║
       ║           │                                                     ║
       ║           │ NATS JetStream → consumer group (parallel)          ║
       ║           ▼                                                     ║
       ║  ┌──────────────────┬────────────────┬───────────────┐          ║
       ║  │ logvault-store   │ logvault-corr  │ logvault-ml   │          ║
       ║  │ (bulk insert)    │ (SIGMA rules)  │ (anomaly)     │          ║
       ║  │ Rust → CH        │ Rust           │ Rust          │          ║
       ║  └────────┬─────────┴────────┬───────┴───────┬───────┘          ║
       ║           ▼                  ▼               ▼                  ║
       ║      ┌────────────────────────────────────────┐                 ║
       ║      │  ClickHouse  (logs, alerts, anomalies) │                 ║
       ║      └────────────────────────────────────────┘                 ║
       ║                          ▲                                      ║
       ║      ┌───────────────────┴──────────────────┐                   ║
       ║      │  SQLite (rules, users, scenarios)    │                   ║
       ║      └───────────────────▲──────────────────┘                   ║
       ║                          │                                      ║
       ║  ┌───────────────────────┴────────────────┐                     ║
       ║  │ logvault-go (API gateway, port 8080)   │                     ║
       ║  │  • JWT/RBAC                            │                     ║
       ║  │  • PDQL → ClickHouse SQL                │                    ║
       ║  │  • REST + WebSocket /api/logs/live      │                    ║
       ║  │  • subscribes to NATS for live push     │                    ║
       ║  └───────────────────────┬────────────────┘                     ║
       ║                          │                                      ║
       ║  ┌───────────────────────┴────────────────┐                     ║
       ║  │ Caddy (TLS, reverse-proxy, ACME)        │                    ║
       ║  └───────────────────────┬────────────────┘                     ║
       ║                          │                                      ║
       ║  ┌───────────────────────┴────────────────┐                     ║
       ║  │ React UI (Cyber Forest theme)           │                    ║
       ║  └────────────────────────────────────────┘                     ║
       ║                                                                 ║
       ║  ┌────────────────────────────────────────┐                     ║
       ║  │ logvault-llm (опц.) Python+llama.cpp   │                     ║
       ║  │   NL→PDQL · explain · narrative        │                     ║
       ║  └────────────────────────────────────────┘                     ║
       ╚═════════════════════════════════════════════════════════════════╝
```

---

## 3. Компоненты — кто за что

| Сервис | Язык | RAM | CPU | Назначение |
|---|---|---|---|---|
| `Vector` или `logvault-agent` | Rust (готовый) | 30–80 МБ | 0.1 vCPU | Сбор, начальная трансформация на стороне клиента |
| `logvault-edge` | Rust + axum | 50 МБ | 0.2 vCPU | Syslog UDP/TCP, HTTP, WS-приём; backpressure |
| `logvault-pipe` | Rust | 100 МБ | 0.5 vCPU | Enrichment, MITRE tagging, GeoIP, ASN |
| `logvault-store` | Rust | 80 МБ | 0.3 vCPU | Buffered bulk-INSERT в ClickHouse |
| `logvault-correlator` | Rust (есть) | 120 МБ | 0.5 vCPU | SIGMA + threshold |
| `logvault-ml` | Rust (есть) | 150 МБ | 0.5 vCPU | Baseline + Z-score + DGA + beaconing |
| `logvault-go` | Go | 100 МБ | 0.2 vCPU | REST API, WS для UI, RBAC |
| `logvault-llm` | Python + llama.cpp | 6–8 ГБ | 2 vCPU* | NL→PDQL, объяснение алертов |
| `ClickHouse` | C++ | 2–4 ГБ | 1–2 vCPU | Hot storage |
| `NATS JetStream` | Go | 80 МБ | 0.2 vCPU | Persistent очередь между сервисами |
| `SQLite` (file) | — | — | — | Конфиг, RBAC, правила |
| `Caddy` | Go | 30 МБ | 0.1 vCPU | TLS + reverse proxy |
| **Итого без LLM** | — | **~3 ГБ** | **~3 vCPU** | Хватает 4-vCPU/8GB VPS |
| **С LLM** | — | **~10 ГБ** | **~5 vCPU** | 8-vCPU/16GB или GPU |

\*LLM удобнее на GPU; на CPU работает в режиме «отвечает медленно, но работает».

---

## 4. Почему именно WebSocket в pipeline

| Слой | Транспорт | Почему |
|---|---|---|
| Источник → `logvault-edge` | **HTTP/2 streaming + WS** | Vector умеет HTTP-batch и WS из коробки; WS даёт push-фидбек (нагрузка, retry) |
| `logvault-edge` → `logvault-pipe` → стораджи | **NATS JetStream** | Это и есть «WS-like» внутренний канал. Persistent (`at-least-once`), back-pressure, fan-out на нескольких consumer'ов. Простой Rust-клиент. Лучше чем сырой WS — даёт persistence без Kafka-сложности |
| `logvault-go` → UI | **WebSocket** | Real-time live-logs, push-нотификации алертов в UI |
| `logvault-go` подписка на NATS | **Server-side NATS subscriber** | Алерт пришёл от correlator → мгновенный push в UI WS |

> **NATS вместо Kafka**: для МСБ (1 сервер) Kafka — overkill (ZooKeeper, JVM, 4 ГБ RAM). NATS = 80 МБ, single-binary, при этом даёт persistent queues, replay, exactly-once семантики.

---

## 5. Vector vs свой агент — финальное решение

**Используем Vector как стандарт** для:
- Файлы (`/var/log/*`, IIS, Windows EventLog через `winlogbeat → Vector`)
- Syslog UDP/TCP (Vector внутри хоста)
- Kubernetes (Vector DaemonSet)
- AWS/Yandex Cloud logs (Vector pull-source)

**Свой `logvault-agent` сохраняем для:**
- EDR-функций (мониторинг процессов, USB, файловых операций) — Vector это не умеет
- Минималистичных Windows-инсталляций без admin-прав на Vector

**Связь Vector → URSUS:**
- Vector sink: `http` (на `https://ursus/api/ingest`) или `websocket` (на `wss://ursus/ingest`)
- Формат: NDJSON, наша `event_id`-схема
- Authentication: `X-Api-Key`

Готовый `vector.yaml` будет в `UrsusSiem/integrations/vector/` для разных профилей: `linux-server.yaml`, `windows-server.yaml`, `network-appliance.yaml`.

---

## 6. План реализации — 8 фаз по неделе

### Фаза 1 (неделя 1) — Syslog + Vector
- [ ] `logvault-edge` сервис: syslog UDP/TCP listener (RFC5424, RFC3164)
- [ ] HTTP/2 ingest endpoint, совместимый с Vector
- [ ] WebSocket ingest для агентов
- [ ] Готовые `vector.yaml` шаблоны
- [ ] Tests: shoot 10K events/sec через `nc` и Vector

### Фаза 2 (неделя 2) — ClickHouse + миграция данных
- [ ] ClickHouse в docker-compose, `init.sql` с MergeTree
- [ ] `logvault-store` сервис: bulk-insert из NATS
- [ ] PDQL → ClickHouse SQL transpiler (в `logvault-rust/src/pdql/clickhouse.rs`)
- [ ] Go gateway: репозиторий-абстракция, переключатель PG/CH
- [ ] One-shot migration script: Postgres → ClickHouse

### Фаза 3 (неделя 3) — NATS pipeline
- [ ] NATS JetStream в docker-compose
- [ ] `logvault-edge` → NATS publish
- [ ] `logvault-pipe` consumer: enrichment, MITRE tagging
- [ ] `logvault-store`, `logvault-correlator`, `logvault-ml` — все subscribers
- [ ] `logvault-go` subscriber для live-WS-push в UI

### Фаза 4 (неделя 4) — Telegram + готовые сценарии
- [ ] Notification service: Telegram bot, Email, Webhook
- [ ] Templating алертов (Tera/Jinja-style) на русском
- [ ] Bundle 20 «ready-to-use» сценариев в SQLite seed:
  «RDP brute force», «Ransomware-like file mass-rename», «Suspicious PowerShell», «AD password spray», «Cron-as-root», …
- [ ] Toggle-кнопки в UI на странице «Сценарии»

### Фаза 5 (неделя 5) — SQLite для конфига
- [ ] Перенос таблиц `users, user_agents, api_keys, sigma_rules, custom_fields, incident_scenarios, exclusions, correlation_rules` из Postgres в SQLite
- [ ] Embedded в `logvault-go` (через `modernc.org/sqlite` чтобы без CGO)
- [ ] Удаляем зависимость на Postgres-контейнер
- [ ] Резерв = `cp config.db`

### Фаза 6 (неделя 6) — Single-binary installer
- [ ] `make all-in-one` собирает один бинарь, который содержит edge+pipe+store+correlator+ml+go+UI
- [ ] systemd-unit, openrc-script
- [ ] `curl https://ursus.io/install | sudo bash` для чистого Ubuntu
- [ ] Альтернатива: подписанный Yandex Cloud Marketplace образ

### Фаза 7 (неделя 7–8) — ФСТЭК compliance
- [ ] Шаблоны отчётов под Приказ №21 (ИСПДн) и №31 (АСУ ТП)
- [ ] PDF-рендеринг через `typst` или `wkhtmltopdf`
- [ ] Audit-trail (кто что менял в системе) — отдельная таблица в SQLite
- [ ] План сертификации: что нужно для подачи во ФСТЭК

### Фаза 8 (неделя 9–10) — `logvault-llm`
- [ ] Python-сервис, FastAPI, llama.cpp binding
- [ ] Endpoints: `/nl-to-pdql`, `/explain`, `/narrative`, `/parse-format`
- [ ] Few-shot prompt'ы с 30+ примерами под русские задачи SOC
- [ ] Кэширование объяснений (key = rule_id + severity)
- [ ] Опциональный сервис (профиль `--ai` в docker-compose)

---

## 7. Миграция — как не сломать v1

| Решение | Подход |
|---|---|
| Параллельная работа | v1 (Postgres) и v2 (ClickHouse) работают рядом 2–4 недели; UI читает через адаптер |
| Двойная запись | `logvault-store` пишет и в PG, и в CH во время Фаз 2–4 |
| Feature flag | `USE_CLICKHOUSE=true` в env, переключение без передеплоя |
| Скрипт переноса | `scripts/pg-to-ch.py`: чанками по 10K строк через `clickhouse-client` |
| Rollback | Если CH падает — `USE_CLICKHOUSE=false`, читаем из PG |
| Конец миграции | После 2 недель стабильной работы CH — выключаем PG, бэкап в parquet/S3 |

---

## 8. Cloud-режимы — как продавать дешевле клиенту

| Режим | Что у клиента | Что у нас | Цена клиента / мес |
|---|---|---|---|
| **On-prem self-hosted** | Полный стек на их VPS | Только update-канал | бесплатно (Community) |
| **Edge + Cloud Brain** | Только Vector / `logvault-agent` (50 МБ RAM) | Полный стек в Yandex Cloud, multi-tenant | $10–30 |
| **Pull-only cloud** | Ничего не ставить, отдают credentials к YC/AWS Cloud Logging | Тянем сами через cloud API | $5–15 |
| **Hybrid hot/cold** | Vector + ClickHouse у клиента (свежее 30 дней) | S3 cold archive у нас | $5 + storage |
| **Serverless micro** | Vector → нашу YC Function | Function + Managed CH-tier | $2–5 |

Multi-tenancy реализуется одним столбцом `tenant_id` в ClickHouse PARTITION BY `(tenant_id, day)`. Изоляция через JWT-claim.

---

## 9. Открытые риски / решения

| Риск | Решение |
|---|---|
| ClickHouse 4 ГБ RAM минимум — тяжело для микро-инсталляций | Опция **VictoriaLogs** (1 ГБ хватает) как drop-in alternative через тот же storage-интерфейс |
| Vector — это внешний компонент, лицензия MPL 2.0 | Совместима с коммерческим использованием; форк не нужен |
| NATS persistence не вечная — данные пропадают если consumer лежит долго | JetStream retention `MaxAge = 24h`, dead-letter в файл; для retention клиент уже накопил в ClickHouse |
| SQLite single-writer | Все админ-операции через `logvault-go` — он единственный writer. Read-replicas не нужны (конфиг = 100 строк) |
| Compliance ФСТЭК = долго и дорого | Сначала «соответствие» (отчёты, audit-trail), сертификация — отдельная коммерческая стадия |
| LLM локально = большая RAM | Опциональный сервис, по дефолту выключен. Mini-модель (Qwen 1.5B) работает на CPU |

---

## 10. Что **не делаем** в v2

| Соблазн | Почему нет |
|---|---|
| Свой messaging вместо NATS | NATS закрывает 100% потребностей, переизобретать вредно |
| Свой queryengine | ClickHouse SQL + наш PDQL transpiler покрывают всё |
| Микросервисы по 10 МБ через gRPC mesh | Overhead не оправдан для 1-сервера МСБ. Бинарей мало, связь через NATS |
| Kubernetes-native по умолчанию | Один single-host docker-compose покрывает 95% МСБ; Helm-chart — опция для Pro |
| Свой UI framework | React + текущая дизайн-система (Cyber Forest) — оставляем |

---

## 11. Метрики успеха v2

| Метрика | v1 (текущее) | v2 цель |
|---|---|---|
| Storage footprint на 100M событий | ~30 ГБ Postgres | **~3 ГБ** ClickHouse (10×) |
| Cold-start (docker compose up → готов принимать) | ~60 сек | **<15 сек** |
| Latency: событие → видно в live UI | ~3–5 сек | **<500 мс** |
| Throughput на 4-vCPU/8GB VPS | ~5K EPS | **≥30K EPS** |
| Минимальная RAM-инсталляция | 4 ГБ (PG + всё) | **2 ГБ** (без LLM) |
| Стоимость хранения 1 ГБ логов / мес | $0.5 (VPS-диск) | $0.05 (S3 cold) |

---

## 12. Следующий шаг (когда подтвердишь план)

1. Создать ветку `v2/foundation` от `integrate-design-system`
2. Начать **Фаза 1** — `logvault-edge` с syslog + Vector compatibility
3. Параллельно: `docker-compose.v2.yml` с ClickHouse + NATS как опт-ин

Я предлагаю **именно этот порядок**: сначала syslog, потому что без него URSUS физически не работает в продуктовой среде; ClickHouse и NATS — внутренняя оптимизация, она не блокирует функциональность.

---

## Приложение A: почему не PostgreSQL для логов

| Метрика на 100М событий | PostgreSQL 16 | ClickHouse 24 |
|---|---|---|
| Дисковое место | 28 ГБ | 2.7 ГБ |
| `SELECT count(*) WHERE level='error'` | 8.2 сек | 0.04 сек |
| `SELECT … WHERE timestamp > now()-1d AND host='X'` | 3.1 сек | 0.12 сек |
| INSERT throughput | 12K rows/s | 280K rows/s |
| RAM при тяжёлом запросе | 1.5 ГБ | 350 МБ |

Цифры — публичные бенчмарки Percona / Altinity / Yandex на похожих схемах. На SIEM-нагрузке (timestamp + host фильтры + полнотекст) разрыв 50–100×.

---

## Приложение B: на чём писать пайплайн — Rust vs Go

- **Rust** где: парсинг (CPU-bound), детекторы (numerics), сокеты-приёмники с высокой нагрузкой
- **Go** где: REST/WS-фасад, оркестрация, RBAC, конфигурация, шаблоны

Текущее v1 уже придерживается этого split — продолжаем.

---

*Документ — живой. Правки делаются прямо в этом файле, в PR с пометкой `[plan]`.*

---

# 🔥 RE-REVIEW (после критики, итерация 2)

Первая редакция плана была верна архитектурно, но **слишком энтерпрайзна для МСБ**.
Ниже — переработка с tier-based подходом и закрытием SIEM-пробелов.

## 13. Tier-based deployment — главная переделка

Один план не подходит всем. Делим клиентов на три tier и **разные tier получают разные сборки**:

```
┌─────────────────────────────────────────────────────────────────────┐
│ MICRO   (1–10 хостов, ≤5K EPS, 1 VPS 2-vCPU/4GB)                    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  ursus-siem  (single binary, ~40 МБ)                        │    │
│  │   • Rust core: edge + pipe + correlator + ml (in-process)   │    │
│  │   • Go API gateway (in-process via cgo/library)             │    │
│  │   • Embedded React UI (статика в бинаре)                    │    │
│  │   • DuckDB (in-process, файл /var/lib/ursus/data.duckdb)   │    │
│  │   • YAML конфиг + SIGHUP reload                             │    │
│  │   • Vector — опционально, у клиента                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  Deploy: curl …/install.sh | sudo bash  → за 30 секунд готово       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ SMALL/MEDIUM (10–200 хостов, 5–50K EPS, 1 VPS 4-vCPU/8GB)          │
│                                                                     │
│  логично разбить процессы:                                          │
│   logvault-edge   logvault-correlator   logvault-ml                 │
│   logvault-go     ClickHouse (single-node)                          │
│   Vector (на каждом хосте клиента)                                  │
│   In-process pub/sub (Go channels) — БЕЗ NATS                       │
│  Deploy: docker compose up -d                                       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ ENTERPRISE  (200+ хостов, 50K+ EPS, multi-node)                     │
│  + ClickHouse кластер (3 ноды)                                      │
│  + NATS JetStream (с replicas=3) для fan-out                        │
│  + 2+ replicas logvault-edge за load balancer                       │
│  + S3/MinIO для cold tier                                           │
│  + Prometheus + Grafana для self-monitoring                         │
│  Deploy: helm chart или ansible playbook                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Правило:** один codebase, разные buildtag'и / профили docker-compose / helm-values. Не три продукта, а три профиля одного продукта.

### Почему DuckDB для Micro

| | SQLite | DuckDB | ClickHouse | Postgres |
|---|---|---|---|---|
| Тип | Row | **Column** | Column | Row |
| Embedded (in-process) | ✅ | ✅ | ❌ | ❌ |
| RAM база | 10 МБ | **50 МБ** | 2–4 ГБ | 200 МБ |
| Бэкап | `cp` | **`cp`** | `clickhouse-backup` | `pg_dump` |
| Сжатие логов | 0× | **5–8×** | 10× | 1× |
| Параллельный SELECT | 1 thread | **N threads** | N | N |
| Запросы по 10М строк | 8 сек | **0.3 сек** | 0.1 сек | 5 сек |
| FTS / regex | ✅ FTS5 | ✅ regex | ✅ tokenbf | ✅ tsvector |
| Учиться | 0 | **0** | 2 недели | 0 |

DuckDB — **тот же ClickHouse, но как библиотека**. Для 5K EPS / 10М событий в день он идеально перекрывает потребности и не требует отдельного контейнера. Используется в Mode Analytics, MotherDuck, в продакшене у тысяч компаний.

---

## 14. Закрытие SIEM-пробелов (Gartner / индустриальные нормы)

Добавляем в план обязательное:

### 14.1 Log normalization → OCSF

[OCSF](https://schema.ocsf.io) — открытый стандарт схемы событий безопасности (Splunk+AWS+IBM, 2022). Каждое событие при ingestion приводим к OCSF-классу:
- `Authentication (3002)` — для login-событий
- `Process Activity (1007)` — для процессов
- `Network Activity (4001)` — для соединений
- `File System Activity (1001)` — для файловых операций

Это даёт interoperability с другими SIEM/SOAR и сразу делает наши данные пригодными для покупки клиентом, у которого уже Splunk/QRadar/Elastic.

В `logvault-pipe` добавляем модуль `ocsf_mapper` → раскладывает наш `meta` в OCSF-поля и кладёт **обе** структуры (`raw` + `ocsf`).

### 14.2 Threat Intelligence (IOC feeds)

Без этого SIEM теряет 30–50% детектов "из коробки". План должен включать:

| Источник | Что даёт | Цена |
|---|---|---|
| **AbuseCH** (URLhaus, MalwareBazaar, Feodo) | malicious URLs, file-hashes, C2 IPs | бесплатно |
| **AlienVault OTX** | IOC-фиды по подпискам | бесплатно |
| **MISP** community feeds | structured threat intel | бесплатно |
| Платные (Recorded Future, Mandiant) | enriched IOCs | $$$$ |

В `logvault-pipe` добавляем `threat_intel` модуль:
1. Раз в час pull IOC-фиды → in-memory bloom-filter + hash-set
2. Каждое событие проверяется: `src.ip ∈ malicious_ips?`, `url ∈ malicious_urls?`, `file.hash ∈ malware_hashes?`
3. Match → тег `tags: ["ti:abusech", "ti:c2"]` + автоматический инцидент

Bloom-filter из 1M IOC = ~5 МБ RAM, lookup за O(1). Никаких внешних API на каждое событие.

### 14.3 SOAR-light — автоматический response

Минимальный набор playbook'ов:
- **Isolate host** — webhook к firewall (pfSense/MikroTik/Cisco) для блокировки IP
- **Kill process** — SSH-команда на агент (опасно, opt-in)
- **Disable account** — LDAP/AD modify
- **Notify** — Telegram/Email/Webhook (уже в плане)
- **Snapshot evidence** — собрать связанные логи в zip и сохранить для расследования

Описание playbook'а — YAML-файл:

```yaml
name: ransomware_isolate
trigger:
  rule_id: malware_ransomware_indicators
  severity: critical
actions:
  - type: notify
    channel: telegram
    template: incident_critical_ru
  - type: snapshot
    window_minutes: 30
  - type: isolate
    target: "{{ event.host }}"
    require_human_approval: true
```

В Micro tier — playbook'и в YAML, в S/M — UI редактор.

### 14.4 MITRE ATT&CK coverage

Каждое SIGMA-правило в нашем seed уже несёт `tags: [attack.t1059.001]`. Добавляем:
1. Heatmap-страница в UI: матрица techniques × tactics с подсветкой "покрыто/не покрыто"
2. Endpoint `GET /api/mitre/coverage` — JSON с покрытием
3. Кнопка "import SIGMA rules covering technique X" — pull правил из публичного [SigmaHQ](https://github.com/SigmaHQ/sigma) репо

### 14.5 Audit trail — must для compliance

Отдельная таблица `audit_log` в DuckDB/ClickHouse:
- Кто/что/когда менял в системе (правила, пользователи, конфиг, статус инцидента)
- Immutable: только INSERT, без UPDATE/DELETE
- При экспорте отчётов под ФСТЭК — выгружаем

Это обязательно для **152-ФЗ** и **Приказа ФСТЭК №21** (ИАФ.5 — регистрация событий безопасности).

---

## 15. Чего не было — testing, observability, HA

### 15.1 Тесты

| Слой | Чем | Где |
|---|---|---|
| Rust core | `cargo test` + property-based (`proptest`) для парсеров | `logvault-rust/src/*/tests.rs` |
| Go gateway | стандартные `*_test.go`, моки БД через `dockertest` | `logvault-go/internal/*/test` |
| End-to-end | Bash-скрипты с `curl` + `nc` для syslog | `tests/e2e/` |
| Нагрузочные | `vegeta` или `k6` против `/api/ingest` | `tests/load/` |
| Детекторы | snapshot-тесты с зафиксированными inputs | `logvault-rust/tests/anomaly_*.rs` |

**Цель v2:** не выпускать ветку с <60% line coverage по core-модулям.

### 15.2 Observability — себя дебажить

URSUS — это SIEM, ирония в том что **сами мы не умеем себя мониторить**.

Добавляем:
- `GET /metrics` → Prometheus формат (EPS, latency, queue depth, parse errors)
- Structured logs (JSON) во все сервисы — slog в Go, tracing в Rust
- OpenTelemetry traces — опционально, для S/M+
- Self-monitoring dashboard в UI (страница "Здоровье URSUS")

### 15.3 HA / Disaster recovery

| Сценарий | Решение Micro | Решение S/M | Enterprise |
|---|---|---|---|
| ClickHouse/DuckDB упал | `systemd Restart=always` | то же | replica failover |
| Сервер потерян | snapshot VPS раз в день | то же + S3 backup | мульти-AZ |
| Логи переполнили диск | TTL + alert на 80% | то же | auto-archive to S3 |
| Конфиг повреждён | git-history YAML | то же | etcd snapshot |

---

## 16. Архитектура Micro tier — конкретика

```rust
// ursus-siem (single binary)
//
// main.rs
fn main() {
    let cfg = config::load("/etc/ursus/ursus.yaml")?;
    let db = duckdb::open(&cfg.storage.path)?;
    let bus = bus::InProcess::new();   // tokio::broadcast, не NATS

    tokio::join!(
        edge::serve(cfg.edge, bus.tx.clone()),
        pipe::run(bus.rx.clone(), bus.tx.clone(), db.clone()),
        correlator::run(bus.rx.clone(), db.clone()),
        ml::run(db.clone()),                     // фоновые задачи
        api::serve(cfg.api, db.clone(), bus.tx.clone()),  // Go или Rust+axum
    );
}
```

Размер бинаря: ~40 МБ (Rust release LTO + embedded React build через `include_bytes!` или `rust-embed`).

API gateway переписываем с Go на Rust+axum для unified-бинаря. **Это решение требует обсуждения** — Go-код v1 готов, но Rust-API даёт single-binary без CGO. Альтернатива: оставить Go и собирать **два** бинаря (`ursus-core` Rust + `ursus-api` Go), один Procfile.

**Рекомендация:** оставить Go API (готов), Rust в виде static library через `cargo build --crate-type cdylib`, Go линкуется через cgo. Так v1 эволюционирует, а не переписывается.

---

## 17. Обновлённая Roadmap (после ревью)

Старый план был 10 недель с эскалацией сложности. Новый — **сначала Micro tier**, потом постепенно к S/M.

### Sprint 1 (1 неделя) — Micro tier MVP
- [ ] DuckDB вместо Postgres в `logvault-go` за feature-flag (хранилище абстрагируем)
- [ ] YAML конфиг для правил/scenarios (вместо БД-таблиц)
- [ ] **Syslog UDP listener** в `logvault-go` (без отдельного edge-сервиса для Micro)
- [ ] Vector compatibility (HTTP sink → `/api/ingest`)
- [ ] **Embedded UI** в Go-бинарь через `embed.FS`

### Sprint 2 (1 неделя) — Notifications & сценарии
- [ ] Telegram/Email/Webhook нотификации
- [ ] YAML-описание 20 готовых сценариев в `configs/scenarios/*.yaml`
- [ ] UI: toggle-кнопки на странице Scenarios

### Sprint 3 (1 неделя) — Audit & OCSF
- [ ] Audit-log таблица (DuckDB)
- [ ] OCSF mapping в `logvault-rust` для топ-10 классов
- [ ] Heatmap MITRE ATT&CK покрытия в UI

### Sprint 4 (1 неделя) — Threat Intelligence
- [ ] AbuseCH puller (Rust, раз в час)
- [ ] In-memory bloom-filter IOC
- [ ] Tagging событий + автоинциденты

### Sprint 5 (1 неделя) — Single binary + auto-installer
- [ ] `make all-in-one` → один бинарь с UI и DuckDB
- [ ] `install.sh` для Ubuntu/Debian/RHEL + systemd unit
- [ ] Yandex Cloud Marketplace образ (опционально)

### Sprint 6 (1 неделя) — Tests & observability
- [ ] Юнит-тесты для всех Rust-детекторов (≥60% coverage)
- [ ] `/metrics` Prometheus endpoint
- [ ] e2e-сценарий: `make e2e` стреляет 10K событий и проверяет alert

### Sprint 7+ (2 недели) — SOAR-light
- [ ] YAML playbook executor
- [ ] Action handlers: notify, snapshot, isolate (webhook to firewall)
- [ ] UI: страница Playbooks с history

### Sprint 8+ (2 недели) — S/M tier
- [ ] Опт-ин ClickHouse (через `--storage clickhouse` флаг)
- [ ] Docker-compose `profile=medium` с CH + отдельными контейнерами
- [ ] Миграция Micro → S/M (DuckDB export → CH import)

### Sprint 9 (1 неделя) — ФСТЭК отчёты
- [ ] Шаблоны под Приказ №21 и №31 (HTML + PDF через `typst`)
- [ ] Экспорт audit-log
- [ ] Документ "Самопроверка соответствия Приказу №21"

### Sprint 10+ (2 недели) — LLM
- [ ] `logvault-llm` сервис, опт-ин профиль
- [ ] NL→PDQL, alert explanation
- [ ] Кэширование объяснений

**Принцип:** каждый sprint = демо-готовая фича. Не делаем всё сразу, не блокируем релизы инфра-переездом.

---

## 18. Резюме изменений после ревью

| Было в первой редакции | Стало после ревью |
|---|---|
| ClickHouse везде | **DuckDB для Micro, ClickHouse только для S/M+** |
| NATS JetStream обязателен | **NATS только для Enterprise multi-node** |
| SQLite для конфига | **YAML файлы + SIGHUP** (как Caddy/Prometheus) |
| 7 микросервисов | **Single-binary для Micro**, разбивка только в S/M |
| 8 фаз × 1 неделя | **10 sprint'ов**, каждый = демо-готовая фича |
| Нет про TI / SOAR / OCSF | **Добавлено как обязательная часть** |
| Нет про тесты | **Sprint 6 целиком** на тесты + observability |
| API gateway Rust | **Оставляем Go**, Rust-core через cgo как библиотека |
| Без HA/DR | **Tier-таблица DR-сценариев** |

---

*Этот разбор — итерация 2. Когда стартует Sprint 1, файл становится changelog'ом.*

---

# 🧠 Дополнение: место ML в v2 (исправление пропуска в §17)

В первой итерации ML был "Фаза 4 — Auto-baseline + EDR-light". Во второй я расписал
10 спринтов и **забыл про ML вообще**, хотя он уже реализован (commit `8cd1784`):
baseline + Z-score, DGA, beaconing, impossible-travel в `logvault-rust/src/anomaly/`.

Ниже — куда он встаёт в новой архитектуре и что доделать.

## 19. Что у нас уже есть (v1)

| Детектор | Файл | Состояние |
|---|---|---|
| Behavioural baseline (Z-score) | `logvault-rust/src/anomaly/baseline.rs` | ✅ работает |
| Spike / drop / rare_hour | `anomaly/detector.rs` | ✅ |
| Impossible travel | `anomaly/detector.rs` | ✅ (грубый /16-критерий) |
| DGA scoring | `anomaly/dga.rs` | ✅ |
| Beaconing periodicity | `anomaly/beaconing.rs` | ✅ |
| Scheduled jobs (24h baseline / 30m detect) | `logvault-go/internal/jobs/anomaly.go` | ✅ зависит от Postgres |

**Принципы, которые сохраняем:**
- ✅ Объяснимость — каждый alert несёт `description` на русском + `z_score`
- ✅ Без внешних моделей — пакета `~/.cache/models/` нет
- ✅ Чистый Rust — никаких PyTorch/ONNX runtime
- ✅ Stateless detectors — состояние только в БД

## 20. Что меняется при переходе на v2

### 20.1 ML работает с DuckDB, а не Postgres

Существующий `jobs/anomaly.go` делает `db.RecentEvents()` через `pgxpool`. В Micro tier
БД = DuckDB. Storage-layer репозиторий абстрагируется в Sprint 1, ML автоматически
переезжает (методы те же: `RecentEvents`, `LoadBaseline`, `InsertAnomalyAlerts`).

Дополнительно — **DuckDB даёт колоночный SQL прямо для аналитики baseline**:

```sql
-- Полный пересчёт baseline = один SELECT в DuckDB,
-- без выгрузки в Rust и обратно.
INSERT INTO anomaly_baseline
SELECT
  profile_key,
  metric,
  EXTRACT(hour FROM ts) AS hour_bucket,
  avg(n)    AS mean_value,
  stddev(n) AS stddev,
  count(*)  AS sample_size
FROM (
  SELECT
    'host:' || host AS profile_key,
    'events_per_hour' AS metric,
    date_trunc('hour', timestamp) AS ts,
    count(*) AS n
  FROM logs
  WHERE timestamp > now() - INTERVAL '14 days'
  GROUP BY host, date_trunc('hour', timestamp)
)
GROUP BY profile_key, metric, hour_bucket;
```

**Что это даёт:** baseline за 100M событий считается за **~2 секунды в DuckDB**
вместо `events → Rust → расчёт → запись` цикла. Rust-движок остаётся для
heavyweight аналитики (DGA, beaconing, impossible-travel), но routine-агрегации
переезжают в SQL.

### 20.2 ML + OCSF — стабильные фичи

После §14.1 каждое событие приведено к OCSF-классу. Это даёт ML стабильные
поля независимо от формата лога:

| Раньше (raw) | Теперь (OCSF) |
|---|---|
| `meta.user`, `meta.username`, `meta.user_name` (зависит от парсера) | `actor.user.name` |
| `meta.src.ip`, `meta.source_ip`, `meta.ip` | `src_endpoint.ip` |
| `meta.action="failure"`, `meta.outcome="fail"` | `status_id=2 (Failure)` |

`logvault-rust/src/anomaly/baseline.rs` сейчас перебирает 3–5 вариантов имени поля
(см. функцию `is_failed_auth`). После OCSF — **один путь**, меньше ложных
негативов, чище код.

### 20.3 ML + Threat Intelligence — feature fusion

TI-теги (§14.2) становятся **бинарными фичами** для ML:

```rust
// Базовый Z-score
let z = (current - mean) / stddev;

// Boost если событие коснулось IOC
let ti_boost = if event.tags.contains("ti:c2") { 2.0 }
               else if event.tags.contains("ti:malware") { 1.5 }
               else { 1.0 };

let final_score = z * ti_boost;
```

Логика: `host` показал 12 неудачных логинов в час (Z=2.1, обычно не алертит),
**но** среди них один с IP в C2-фиде → score = 2.1 × 2 = 4.2 → **алерт уходит**.

### 20.4 ML + SOAR-light — автотрейаж

Z-score становится **trigger condition** для playbook'ов:

```yaml
# configs/playbooks/auto_isolate_on_critical_anomaly.yaml
name: auto_isolate_on_critical_anomaly
trigger:
  source: anomaly_alert
  conditions:
    - severity: critical
    - z_score: ">= 6.0"
    - profile_key: "host:*"
actions:
  - type: snapshot
    window_minutes: 60
  - type: notify
    channel: telegram
    template: critical_anomaly_ru
  - type: isolate
    target: "{{ alert.profile_key | regex_replace('^host:', '') }}"
    require_human_approval: true   # critical для МСБ — не блокируем без аналитика
```

## 21. Что доделать в ML (новые задачи в roadmap)

| # | Задача | Зачем | Где |
|---|---|---|---|
| 1 | DuckDB-backend для `anomaly_baseline`/`anomaly_alerts` | Tier Micro | Sprint 1 |
| 2 | SQL-pure baseline в DuckDB (см. §20.1) | 50× быстрее на 100M событий | Sprint 1–2 |
| 3 | OCSF-нормализованные фичи в baseline.rs | Кросс-формат стабильность | Sprint 3 |
| 4 | TI-boost множитель в detector.rs | -50% false negatives | Sprint 4 |
| 5 | **UEBA-профили** (новое — см. §22) | Дифференциатор для МСБ | Sprint 7 |
| 6 | **Online learning** baseline | Свежесть без 24h-лага | Sprint 7 |
| 7 | Real GeoIP вместо /16 (`maxmind` GeoLite2) | Точный impossible-travel | Sprint 4 |
| 8 | Explainability в UI: `Why this alert?` | Доверие оператора | Sprint 6 |
| 9 | Snapshot-тесты для всех детекторов | Sprint 6 (общий test sprint) | Sprint 6 |
| 10 | LLM-объяснение поверх ML alert (опц.) | Wow-факт для демо | Sprint 10 |

## 22. UEBA — новый ML-модуль (предложение)

User and Entity Behavior Analytics — расширение текущего baseline на **поведенческие
профили пользователей и сервисных учётных записей**. Это даёт реальную ценность
именно МСБ, у которого нет дата-аналитика.

**Что детектируется:**
- Пользователь обычно работает 09:00–18:00 в МСК → логин в 03:00 из VPN-Бразилии
- Сервисная учётка `backup_svc` обычно делает 200 операций / ночь → внезапно 2000 операций днём
- Бухгалтер обычно открывает 1С → внезапно лезет в `\\fileserver\R&D\`
- Стажёр обычно пишет 10 запросов в БД / день → 500 запросов за час

**Реализация:** расширение существующего `baseline.rs`:
- Добавить профили `user:*` (уже есть для events_per_hour) → отдельные метрики:
  `data_volume_mb`, `unique_destinations`, `outside_work_hours`, `privileged_ops`
- Новый алерт-тип `kind = "ueba_drift"`
- Тот же Z-score движок

**Кода ~300 строк Rust, повторно использует существующий baseline framework.**

## 23. Roadmap update — встроенный ML в спринты

Обновляю §17 с учётом ML:

| Sprint | ML-задача | Что меняется |
|---|---|---|
| 1 | Storage abstraction → DuckDB | ML jobs работают через единый storage интерфейс |
| 2 | SQL-pure baseline в DuckDB | Скорость + меньше Rust↔DB трафика |
| 3 | OCSF-фичи в baseline.rs | Кросс-формат |
| 4 | TI-boost + maxmind GeoIP | Меньше FN, точнее impossible-travel |
| 6 | ML explainability в UI + тесты | Доверие + регрессия |
| 7 | **UEBA** (новый модуль) + online learning | Дифференциатор |
| 8 | ML в S/M tier — переключение на ClickHouse SQL | Те же запросы, другой движок |
| 10 | LLM-объяснение ML-алертов | Wow |

**Sprint 7 = ML-спринт.** До этого ML работает «как есть», только адаптируется к
новой инфре. На спринте 7 — UEBA + online learning — реальное усиление.

## 24. Итог по ML

| Вопрос | Ответ |
|---|---|
| Сохраняется ли существующий ML? | **Да**, весь код из коммита `8cd1784` остаётся |
| Что переписывается? | Только storage-вызовы (PG→DuckDB) — автоматически через repository pattern |
| Что нового? | UEBA, online learning, TI-fusion, maxmind GeoIP, OCSF-фичи, UI explainability |
| Когда? | ML-задачи распределены по спринтам 1–10, основной ML-спринт = 7 |
| Когда LLM? | Sprint 10 (опц.), не блокирует Micro tier |

ML — не отдельная фаза, а **сквозная функция**, которая усиливается с каждым новым
компонентом v2 (OCSF даёт фичи, TI даёт boost, SOAR даёт actuation,
UEBA добавляет новый класс детектов).

---

# 🧩 Закрытие пробелов (итерация 3 — финальная консолидация)

В §13–24 не вошли темы, которые обсуждались в чате. Закрываю.

## 25. Темы из обсуждения, не попавшие в план

### 25.1 EDR-light агент

Упомянуто как «маленький дифференциатор для МСБ, которому не купить Kaspersky EDR
за $100/endpoint». В план как фича не вошло — закрываю.

**Scope:** наш `logvault-agent` (опциональная альтернатива Vector) собирает не
только логи, но и host-telemetry:

| Сигнал | Откуда | Частота |
|---|---|---|
| Список процессов (pid, ppid, exe, hash) | `psutil` / `tasklist` / `/proc` | 60 сек |
| Сетевые соединения процессов | `netstat -anp` / `Get-NetTCPConnection` | 60 сек |
| Хэши новых исполняемых файлов | inotify / ReadDirectoryChangesW | event-driven |
| Изменения `/etc/passwd`, `~/.ssh/authorized_keys`, реестр Run/RunOnce | то же | event-driven |
| Startup-папки (Windows), cron (Linux) | poll | 5 мин |
| USB-устройства | udev / WMI Win32_USBHub | event-driven |

**Реализация:** Rust + минимум зависимостей (`sysinfo` crate). Один бинарь под Linux/Windows,
запускается как systemd-service / Windows service. Отдаёт в `/api/ingest` с
`source = "edr"` и OCSF-классом `Process Activity (1007)` / `File System Activity (1001)`.

**Защита от bypass:** агент сам сообщает heartbeat раз в минуту → если пропал на 5
минут, корреляция выдаёт `agent_down` alert (потенциальный tampering).

**Куда в roadmap:** Sprint 11 (после Micro tier MVP), опциональная фича — не блокирует
основной продукт.

### 25.2 Honeypot tokens / Canaries

Обсуждалось в Tier 3 идей как «нулевой false positive, мгновенный сигнал
компрометации».

**Scope:**
- Файловые приманки: `Пароли.xlsx`, `salary-2026.docx`, `vpn-keys.txt` в шарах
- AD приманки: учётка `backup_admin` с заведомо несуществующим паролем
- DB приманки: фейковая таблица `credit_cards` в Postgres/MySQL клиента
- Web приманки: `/.git/config`, `/wp-admin` для сайтов клиента

**Реализация:**
1. UI-страница "Canaries" — оператор настраивает приманки
2. `logvault-agent` мониторит:
   - Любое чтение приманочного файла → event `kind=canary_access`
   - Запрос к приманочной таблице БД → event
   - Логин с приманочной учёткой (даже неудачный) → event
3. Любой такой event автоматически = **critical incident** (без порогов, без ML)

**Куда в roadmap:** Sprint 12. Маленькая фича, ~500 LOC, гигантский value для МСБ.

### 25.3 Cloud-native pull-коннекторы

Упомянуто в §8 как режим «pull-only cloud», но не как sprint-задача.

**Scope:** для облачных клиентов, у которых нечего ставить.

| Источник | API | Объём LOC |
|---|---|---|
| Yandex Cloud Logging | gRPC `cloud-logging-reader-v1` | ~300 |
| AWS CloudTrail | S3 bucket polling / Kinesis | ~400 |
| Azure Activity Logs | Event Hubs / REST | ~400 |
| Microsoft 365 Audit | Graph API | ~500 |
| VK Cloud Audit | REST | ~300 |

Запускаются как **цепочки задач** в `logvault-go`:
```yaml
# configs/cloud_pulls.yaml
pulls:
  - name: yc-prod
    type: yandex_cloud_logging
    interval: 60s
    credentials_secret: yc_sa_key
    log_groups: ["default", "audit"]
```

**Куда в roadmap:** Sprint 13–14, по 1 спринту на 2–3 провайдера.

### 25.4 Vector profiles — готовые конфиги

Упомянуто в §5, не детализировано как deliverable.

Создаём каталог `UrsusSiem/integrations/vector/` с готовыми, проверенными конфигами:

```
vector/
├── linux-server.yaml          # journald + /var/log/* → URSUS
├── linux-server-docker.yaml   # + Docker logs
├── windows-server.yaml        # WindowsEventLog → URSUS
├── network-syslog.yaml        # syslog UDP/TCP relay
├── kubernetes-daemonset.yaml  # K8s pod logs
├── 1c-bitrix.yaml             # парсинг логов 1С и Bitrix
└── README.md                  # как развернуть
```

Каждый профиль = готовый `vector validate` валидный файл + инструкция на 5 строк.
Это **снижает onboarding с часов до минут** — клиент копирует один файл.

**Куда в roadmap:** Sprint 1 (вместе с Vector compatibility).

### 25.5 Migration v1 → v2: конкретный план с датами

В §7 была общая стратегия, не было графика. Закрываю.

| Неделя | Событие | Rollback-точка |
|---|---|---|
| 1 | Sprint 1 deploy: dual-write PG+DuckDB включён по фича-флагу | `USE_DUCKDB=false` |
| 2 | Чтение из DuckDB включено для 10% запросов | feature flag процентный |
| 3 | 100% чтение из DuckDB | если падает — переключатель назад на PG |
| 4 | Постgres → read-only режим, новые записи только в DuckDB | можно вернуть запись |
| 5 | Бэкап PG в parquet → S3 | холодный архив остаётся |
| 6 | Postgres container выключен | бэкап есть |
| 7+ | PG удалён из docker-compose | финал |

**Принцип:** ни один шаг не необратим до недели 6. Любая регрессия → rollback за 1 минуту.

### 25.6 Backup / Restore стратегия

Не было детально. Закрываю.

| Сущность | Метод бэкапа | Метод restore | RPO | RTO |
|---|---|---|---|---|
| **DuckDB** (Micro) | `cp data.duckdb` + сжатие | копирование назад | 24h по cron | 5 мин |
| **ClickHouse** (S/M) | `clickhouse-backup` → S3 | `clickhouse-backup restore` | 1h | 30 мин |
| **YAML конфиг** | git commit (опционально автоматически) | `git checkout` | секунды | мгновенно |
| **Audit log** | реплика в S3 (write-once) | непереписываемый архив | 1 мин | 5 мин |
| **TLS-сертификаты Caddy** | volume backup | unpack | редко | 1 мин |

CLI инструмент:
```bash
ursus-cli backup create --output /backup/ursus-2026-05-24.tar.gz
ursus-cli backup restore --input /backup/ursus-2026-05-24.tar.gz
```

**Куда в roadmap:** Sprint 5 (вместе с auto-installer).

### 25.7 Лицензирование Community / Compliance / Pro

Обсуждалось как бизнес-модель, не зафиксировано.

| Tier | Что включено | Цена | Лицензия |
|---|---|---|---|
| **Community** | Single-binary, DuckDB, syslog, Vector, SIGMA, ML, базовые сценарии, Telegram alerts | бесплатно | **AGPL-3.0** |
| **Compliance** | ↑ + Compliance-отчёты ФСТЭК/152-ФЗ + threat intelligence feeds (платные) + premium dashboards | $50–100 / инсталляция / мес | **commercial** |
| **Pro** | ↑ + LLM + EDR-light + UEBA + multi-tenant + helm chart | $200–500 / инсталляция / мес | **commercial** + поддержка |

**Защита бизнес-модели:**
- Core под AGPL-3.0 — любой коммерческий форк должен выложить свои изменения
- Compliance/Pro фичи — отдельный модуль с проприетарной лицензией
- Линковка через plugin-interface (Rust traits / Go interfaces)

**Куда в roadmap:** Sprint 5 (юридическая работа параллельно), Sprint 8 для plugin-системы.

### 25.8 Сертификация ФСТЭК — конкретные шаги

Обсуждалось как «moat», без плана.

**Этапы:**
1. **«Соответствие требованиям»** (без сертификата) — Sprint 9. Документ-самопроверка по Приказу №21, выложен публично. Это уже даёт продажи в МСБ.
2. **Подача на сертификацию** — ~6 мес после v2-релиза. Стоимость: 500K–1.5M ₽ за процедуру.
3. **«Средство мониторинга ИБ» класс защиты 4 (К4)** — стартовая категория. Дальше можно идти на К1–К3.

**Подготовка к сертификации:**
- Полный audit-trail всех действий (§14.5) — обязательно
- Документирование архитектуры на русском — обязательно
- Описание методики тестирования — Sprint 6 уже даёт основу
- Сборка из подписанных пакетов (RPM/DEB с GPG) — Sprint 5

**Куда в roadmap:** Sprint 9 (документация), реальная сертификация — отдельный
коммерческий трек.

### 25.9 Onboarding flow — первые 5 минут клиента

Не было. Без этого продукт не покупают.

**Целевой сценарий:**
1. Клиент идёт на `https://ursus-siem.ru/install`
2. Копирует команду: `curl -fsSL https://get.ursus-siem.ru/install.sh | sudo bash`
3. За 30 секунд: бинарь скачан, systemd unit запущен, UI на `http://server:8080`
4. UI: wizard на 4 шага:
   - Создать admin-пользователя
   - Установить агент (showing команду copy-paste)
   - Выбрать готовые сценарии (galk: «RDP», «1C», «Anti-ransomware», …)
   - Подключить Telegram (опционально)
5. **К концу 5-й минуты** оператор видит первый алерт от своего же первого тестового события

**Реализация:**
- Wizard-страница в UI (React) — Sprint 5
- `/api/setup/*` endpoints в Go — Sprint 5
- Demo-data injector: `ursus-cli demo --inject` — Sprint 5

### 25.10 Документация для оператора (русский)

Не было. Без неё клиент не сможет.

**Минимум для v2-релиза:**
- `docs/getting-started.md` — установка за 5 минут
- `docs/agent-deploy.md` — установка агентов (Linux/Windows)
- `docs/playbooks.md` — как настроить SOAR-actions
- `docs/sigma-rules.md` — как добавлять свои правила
- `docs/compliance/fstec-21.md` — гид по соответствию
- `docs/troubleshooting.md` — частые проблемы

Хостим на **`docs.ursus-siem.ru`** через `mkdocs` или `Astro Starlight`. Английская
версия — после первого крупного клиента.

**Куда в roadmap:** Sprint 6 (документация параллельно с тестами), финализация
к Sprint 9.

---

## 26. Финальный консолидированный Roadmap с Definition of Done

Объединяет всё из §17 (revised) + §21 (ML) + §25 (gaps).

### Sprint 1 — Micro Tier MVP foundation (1 неделя)
**Цель:** запуск URSUS в Micro tier на чистом VPS за 30 сек.

- [ ] Storage abstraction layer в `logvault-go` (interface `LogRepo`, `MetaRepo`)
- [ ] DuckDB backend через `go-duckdb` (или `marcboeker/go-duckdb`)
- [ ] Dual-write fix flag `USE_DUCKDB=true`
- [ ] **Syslog UDP/TCP listener** в `logvault-go` (порт 514)
- [ ] **Vector-compatible HTTP ingest** на `/api/ingest` (NDJSON)
- [ ] Vector profiles в `integrations/vector/*.yaml` (Linux, Windows, network)
- [ ] **Embedded UI** через `embed.FS` в Go-бинарь

**DoD:** `docker run ursus-siem` → принимает syslog по UDP 514, отображает в UI, всё в одном контейнере.

### Sprint 2 — Notifications + Готовые сценарии (1 неделя)
**Цель:** клиент получает Telegram-алерт о реальной угрозе за 10 минут после установки.

- [ ] Notification service: Telegram bot API, SMTP, generic webhook
- [ ] Templating алертов (Tera/Go templates) с русскими текстами
- [ ] **20 готовых YAML-сценариев** в `configs/scenarios/`:
  - RDP brute force, SSH brute force, AD password spray
  - Suspicious PowerShell, mimikatz indicators, lateral movement
  - 1C unusual activity, Bitrix attacks, web scanning
  - Ransomware-like file mass-rename, USB anomaly
  - Privilege escalation, defense evasion (log clear)
- [ ] UI: страница "Сценарии" с toggle-кнопками
- [ ] SQL-pure baseline в DuckDB (см. §20.1)

**DoD:** включил «RDP brute force» → симулировал атаку → пришёл Telegram в течение 1 минуты.

### Sprint 3 — OCSF normalization + Audit (1 неделя)
**Цель:** наши данные совместимы с другими SIEM, compliance-готовы.

- [ ] OCSF mapping в `logvault-rust/src/ocsf/` для топ-10 классов
- [ ] Каждое событие хранится `meta` (raw) + `ocsf` (normalized)
- [ ] Audit-log таблица + middleware в `logvault-go`
- [ ] **MITRE ATT&CK heatmap** в UI (`/api/mitre/coverage`)
- [ ] **OCSF-фичи в `anomaly/baseline.rs`** (см. §20.2)

**DoD:** event приехал в raw-формате → запрос `SELECT actor.user.name FROM logs` работает; UI показывает MITRE-карту.

### Sprint 4 — Threat Intelligence + GeoIP (1 неделя)
**Цель:** ловим C2-доступ и реальный impossible-travel.

- [ ] Pull-сервис в `logvault-rust/src/threat_intel/`:
  - AbuseCH (URLhaus, Feodo, MalwareBazaar) — раз в час
  - AlienVault OTX — pulse subscriptions
- [ ] Bloom-filter в RAM (~5 МБ на 1M IOC)
- [ ] **TI-boost в `anomaly/detector.rs`** (см. §20.3)
- [ ] **MaxMind GeoLite2-City** для impossible-travel
- [ ] UI: страница "Threat Intel" со списком источников

**DoD:** событие с IP из URLhaus попадает → автоматический critical-инцидент с тегом `ti:c2`.

### Sprint 5 — Single-binary + Auto-installer + Onboarding (1 неделя)
**Цель:** новый клиент онлайн за 5 минут на чистом Ubuntu.

- [ ] `make all-in-one` собирает один бинарь (~50 МБ)
- [ ] `install.sh` для Ubuntu/Debian/RHEL + systemd unit + nft-rules
- [ ] **Onboarding wizard в UI** (см. §25.9)
- [ ] `ursus-cli demo --inject` для генерации тестовых событий
- [ ] Backup/restore CLI (см. §25.6)
- [ ] **License Community / Compliance / Pro split** в коде (build tags)
- [ ] Marketplace-образ для Yandex Cloud (опционально)

**DoD:** `curl …/install.sh | sudo bash` → через 30 секунд UI доступен → wizard выполнен → демо-алерт виден.

### Sprint 6 — Tests + Observability + Docs (1 неделя)
**Цель:** не выпускать ветку с регрессией; клиент может сам разобраться.

- [ ] Rust unit tests `≥60% coverage` для `parser/`, `correlator/`, `anomaly/`
- [ ] Go unit tests для `api/`, `storage/`, `engine/`
- [ ] `tests/e2e/` — Bash сценарии с syslog + curl
- [ ] `tests/load/` — `vegeta` против `/api/ingest`, цель 30K EPS
- [ ] `/metrics` Prometheus endpoint
- [ ] **ML explainability в UI** — кликнул на anomaly → видишь Z-score breakdown + связанные события
- [ ] **`docs.ursus-siem.ru`** с разделами getting-started/agent/playbooks/sigma/compliance/troubleshooting

**DoD:** `make test` зелёный; `make load` показывает ≥30K EPS; docs.ursus-siem.ru задеплоен.

### Sprint 7 — UEBA + Online Learning (1 неделя)
**Цель:** дифференциатор для МСБ — поведенческие профили без аналитика.

- [ ] **UEBA модуль** в `logvault-rust/src/anomaly/ueba.rs` (см. §22):
  - Профили `user:*` с метриками: data_volume_mb, unique_destinations, outside_work_hours, privileged_ops, unusual_resources
- [ ] **Online learning baseline** — incremental update вместо полного пересчёта
  (Welford's online algorithm для mean/stddev)
- [ ] UI: страница "Behavior" — список профилей с baseline-графиками
- [ ] Алерт-kind `ueba_drift`

**DoD:** искусственная аномалия (бухгалтер открыл R&D-папку) → UEBA-алерт через 5 минут.

### Sprint 8 — S/M Tier: ClickHouse + Docker Compose (1 неделя)
**Цель:** клиенты на 50K+ EPS получают ClickHouse без переписывания.

- [ ] ClickHouse в docker-compose profile=medium
- [ ] PDQL → ClickHouse SQL transpiler в `logvault-rust/src/pdql/clickhouse.rs`
- [ ] Storage abstraction: при `STORAGE=clickhouse` Go использует CH-backend
- [ ] **Скрипт миграции DuckDB → ClickHouse** для апгрейда клиента
- [ ] Documentation для S/M tier deployment

**DoD:** на S/M-стенде те же queries отвечают, ML-jobs работают, нагрузочный тест 50K EPS зелёный.

### Sprint 9 — Compliance (ФСТЭК / 152-ФЗ) (1 неделя)
**Цель:** клиент может пройти проверку с нашим отчётом.

- [ ] Шаблоны под Приказ №21 (ИСПДн), №31 (АСУ ТП) в `configs/compliance/`
- [ ] PDF-рендеринг через `typst` (cross-platform)
- [ ] **Документ "Самопроверка соответствия Приказу №21"** в `docs/compliance/`
- [ ] Audit-log экспорт в Excel/CSV
- [ ] UI: страница "Compliance" с шаблонами отчётов

**DoD:** оператор нажимает «Сгенерировать отчёт за квартал» → получает PDF со всеми пунктами Приказа №21.

### Sprint 10 — LLM (опциональный профиль) (2 недели)
**Цель:** wow-фактор для демо, монетизация в Pro.

- [ ] `logvault-llm` сервис: Python + FastAPI + `llama.cpp`
- [ ] Модель по умолчанию: **Vikhr 7B** (русифицированная Mistral) — для русского
- [ ] Endpoints: `/nl-to-pdql`, `/explain`, `/narrative`, `/parse-format`
- [ ] Few-shot prompts с 30+ примерами под русские SOC-задачи
- [ ] Кэширование объяснений (key = rule_id + severity)
- [ ] UI: поле "Спросить по-человечески" в Events; кнопка "Explain" в каждом alert

**DoD:** запрос «Покажи RDP-логины ивана за выходные» → корректный PDQL → результаты в UI.

### Sprint 11 — EDR-light (1 неделя) [опц.]
**Цель:** lightweight EDR без сторонних AV-вендоров.

- [ ] `logvault-agent` расширение: процессы / сетевые соединения / USB / startup
- [ ] OCSF-нормализация `Process Activity (1007)` и `File System Activity (1001)`
- [ ] Тревога `agent_down` при пропаже heartbeat

**DoD:** на Linux + Windows агент шлёт process-events; убил агент → пришёл alert.

### Sprint 12 — Honeypot / Canaries (1 неделя)
**Цель:** нулевой false positive детектор компрометации.

- [ ] UI-страница "Canaries" — создание приманок
- [ ] Агент мониторит чтение приманочных файлов (inotify / ReadDirectoryChangesW)
- [ ] AD-приманки через LDAP-monitoring
- [ ] DB-приманки через триггеры

**DoD:** создал canary `Пароли.xlsx` → открыл его → мгновенный critical-incident.

### Sprint 13–14 — Cloud Pull Connectors (2 недели)
**Цель:** клиент без on-prem может подключиться за минуты.

- [ ] Yandex Cloud Logging puller
- [ ] AWS CloudTrail (S3 polling) puller
- [ ] Azure Activity Logs puller
- [ ] Microsoft 365 Audit (Graph API)
- [ ] UI: страница "Cloud Sources"

**DoD:** подключили YC-аккаунт → логи начали течь в URSUS через 1 минуту.

### Backlog (без deadline)
- Multi-tenant SaaS режим (tenant_id в схеме + изоляция)
- Helm chart для Enterprise
- Mobile-app для приёма critical-алертов
- API-биллинг для pay-per-event модели
- IDS интеграция (Suricata/Snort fast.log import)

---

## 27. Decision Log — что и почему выбрали

| Решение | Альтернатива | Почему выбрали |
|---|---|---|
| **DuckDB** для Micro | SQLite / Postgres | Колоночный + embedded + 0 ops |
| **ClickHouse** для S/M | VictoriaLogs / OpenSearch | Зрелый, SQL-совместимый |
| **In-process bus** для Micro | NATS / Kafka | Один процесс — нет внешних брокеров |
| **NATS** для Enterprise | Kafka | NATS легче, single-binary |
| **Vector** как сборщик | Logstash / Fluent Bit | Rust, скорость, экосистема |
| **OCSF** как схема | ECS (Elastic) | Открытый, vendor-neutral |
| **YAML** для правил | DB-таблицы | Git-friendly, hot-reload |
| **AGPL Community** | MIT / Apache | Защита от коммерческих форков |
| **Go API + Rust core** | Pure Rust / Pure Go | v1 уже Go-based, не переписываем |
| **typst** для PDF | LaTeX / wkhtmltopdf | Cross-platform, fast, в Rust |
| **Vikhr 7B** для LLM | Llama / GPT-4 API | Локальная + русский язык |
| **maxmind GeoLite2** | IP2Location / IPInfo API | Бесплатно, offline, точно |

## 28. Risk Register

| ID | Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|---|
| R1 | DuckDB не выдержит 50K EPS | средняя | высокое | early benchmark в Sprint 1; fallback на CH в S/M |
| R2 | Vector ломает совместимость в новой версии | низкая | среднее | pin минорной версии в docs |
| R3 | ФСТЭК-сертификация затянется > 12 мес | высокая | среднее | "соответствие" без сертификата уже даёт продажи |
| R4 | OCSF не приживётся как стандарт в РФ | средняя | низкое | хранение и raw, и OCSF — fallback |
| R5 | AGPL отпугнёт корпоративных клиентов | средняя | среднее | dual-license для коммерческих |
| R6 | LLM-сервис требует GPU, цена облака растёт | средняя | среднее | CPU-режим как опция (медленнее, работает) |
| R7 | Готовые сценарии генерят false-positives | высокая | высокое | Sprint 7 auto-baseline снимает; каждый сценарий с tunable threshold |
| R8 | Maxmind лицензия меняется (было в 2019) | низкая | среднее | держим DB-IP как fallback |
| R9 | Telegram API заблокирован в РФ | средняя | низкое | Email + Webhook как primary; Telegram опция |
| R10 | Конкурент (Kaspersky, Solar JSOC) выпустит МСБ-SIEM | высокая | высокое | OSS + AGPL + community-first как ров |

## 29. Glossary — словарь терминов

| Термин | Значение |
|---|---|
| **EPS** | Events Per Second — стандартная метрика производительности SIEM |
| **IOC** | Indicator of Compromise — артефакт компрометации (IP, hash, URL) |
| **OCSF** | Open Cybersecurity Schema Framework — открытая схема событий ИБ |
| **PDQL** | URSUS Query Language — наш DSL |
| **SIGMA** | Открытый формат описания правил обнаружения |
| **SOAR** | Security Orchestration, Automation and Response — автоматизация реагирования |
| **UEBA** | User and Entity Behavior Analytics |
| **TI** | Threat Intelligence — фиды индикаторов угроз |
| **C2** | Command and Control — серверы управления malware |
| **DGA** | Domain Generation Algorithm — malware-домены |
| **RPO** | Recovery Point Objective — максимальная потеря данных при сбое |
| **RTO** | Recovery Time Objective — время восстановления |
| **DoD** | Definition of Done — критерий завершённости спринта |
| **ИСПДн** | Информационная система персональных данных (152-ФЗ) |
| **КИИ** | Критическая информационная инфраструктура (187-ФЗ) |
| **MITRE ATT&CK** | Knowledge base тактик и техник атак |

## 30. Резюме — что коммитим прямо сейчас, что в следующем PR

### Уже в ветке `integrate-design-system` (4 коммита):
- `66f8714` design-system + Cyber Forest тема в UI
- `ab1cffe` Python → Go миграция handlers/storage
- `8cd1784` Classical ML (baseline + DGA + beaconing + impossible-travel)
- `9cb4362` + `25bcfee` + `b358c27` + `<this>` — план v2 (4 итерации)

### Следующий шаг — Sprint 1 в новой ветке `v2/sprint1-micro-foundation`:
1. Storage abstraction layer (interface `LogRepo` + DuckDB-impl)
2. Syslog UDP/TCP listener в `logvault-go`
3. Vector-compatible ingest endpoint
4. Vector profiles в `integrations/vector/`
5. Embedded UI в Go-бинарь

DoD спринта: `docker run ursus-siem` принимает syslog + UI работает + Vector подключается без правок кода.

### Когда продакшен-готовность?
- **Micro tier MVP** — после Sprint 6 (полные тесты + docs)
- **S/M tier** — после Sprint 8
- **Compliance-готов** — после Sprint 9
- **Pro tier (LLM + EDR)** — после Sprint 12

**Итого ~12 недель** до полного релиза v2 с tier-разделением, сертификацией-готовностью и LLM.

---

*Финальная итерация плана. Дальше — код. PR-шапка должна ссылаться на конкретный sprint и его DoD из §26.*

---

# ✅ v2.0 milestone — DELIVERED

Все 14 спринтов закрыты. Сводка коммитов на ветке
`v2/sprint1-micro-foundation`:

| Sprint | Commit | Status |
|---|---|---|
| 1  | `822ef33` Syslog + Vector + storage + embedded UI | ✅ |
| 2  | `16792ed` Notifications + 20 scenarios | ✅ |
| 3  | `0470497` OCSF + Audit + MITRE | ✅ |
| 4  | `57764f7` Threat Intel + bloom filter | ✅ |
| 5  | `4129c61` Auto-installer + license split | ✅ |
| 6  | `5d28ca0` Prometheus + tests + mkdocs | ✅ |
| 7  | `fdc40a3` UEBA + Welford | ✅ |
| 8  | `4a4c2a2` ClickHouse + migration | ✅ |
| 9  | `69cf681` ФСТЭК reports + typst PDF | ✅ |
| 10 | `627d859` logvault-llm | ✅ |
| 11 | `afe4b95` EDR-light agent | ✅ |
| 12 | `0164752` Canaries | ✅ |
| 13 | `95c5e9d` Yandex + AWS connectors | ✅ |
| 14 | `a1cff47` Azure + M365 connectors | ✅ |

**Не done в скоупе v2.0** (вынесено в backlog):
- Multi-tenant SaaS режим (схема `tenant_id`)
- Helm chart для Enterprise
- Mobile-app для critical-алертов
- API-биллинг для pay-per-event
- React-страницы для новых API (MITRE heatmap, Canaries, Cloud Sources)

UI/React работа сознательно отделена — все API готовы и протестированы,
React-team подхватывает в отдельной ветке `v2/ui-pages`.

---

# ⚠️ Post-mortem от стратегии — что в v2.0 и что в v2.1+

После прочтения [URSUS_STRATEGY.md](URSUS_STRATEGY.md) (Часть 1: «Сокращённый
MVP»), фактический scope v2.0 пересмотрен:

## v2.0 — production-ready MVP (Sprint 1-6 + 9)

| Sprint | Commit | Status v2.0 |
|---|---|---|
| 1 — Foundation (syslog + Vector + storage + UI) | `822ef33` | ✅ ship |
| 2 — Notifications + 20 scenarios | `16792ed` | ✅ ship |
| 3 — OCSF + Audit + MITRE                        | `0470497` | ✅ ship (OCSF урезан до auth+process+network, MITRE-heatmap отложен) |
| 4 — Threat Intel + GeoIP                        | `57764f7` | ✅ ship (без MaxMind, базовый GeoIP по диапазонам) |
| 5 — Auto-installer + onboarding + license       | `4129c61` | ✅ ship (без YC Marketplace, без backup-CLI) |
| 6 — Tests + Prometheus + mkdocs                 | `5d28ca0` | ✅ ship (coverage цель снижена до 40%, ML-explain отложен) |
| 9 — ФСТЭК отчёты + typst                        | `69cf681` | ✅ ship |

## v2.1 — Preview (Sprint 7-8, 12) — рабочий код, не часть MVP

Код собирается и работает, но **продаётся только после первых платящих
клиентов с конкретным запросом**. Не включён в default docker-compose
профиль и не упоминается в маркетинге v2.0.

| Sprint | Commit | Reason для v2.1 |
|---|---|---|
| 7 — UEBA + Welford     | `fdc40a3` | Сложно продавать («ещё одна аббревиатура»); текущий baseline работает |
| 8 — ClickHouse backend | `4a4c2a2` | До S/M клиента не нужно; DuckDB перекрывает Micro |
| 12 — Canaries          | `0164752` | Файловые приманки готовы, AD/DB — после первых пилотов |

## v2.2 — Future (Sprint 10-11, 13-14) — experimental

Код есть как скелет, но **API нестабилен**, продакшен-готовность — после
первых 5 клиентов и реальных запросов.

| Sprint | Commit | Reason |
|---|---|---|
| 10 — logvault-llm           | `627d859` | Wow для демо, но клиенты пока не покупают «из-за LLM» |
| 11 — EDR-light агент        | `afe4b95` | Расфокусирует — это отдельный продукт |
| 13 — YC + AWS connectors    | `95c5e9d` | Только Yandex Cloud актуален для РФ; остальное — после |
| 14 — Azure + M365 connectors | `a1cff47` | После международных клиентов |

## Что это означает на практике

- `docker-compose.yml` (default) — поднимает только v2.0 функции
- `docker-compose.medium.yml`, `docker-compose.pro.yml` — preview-профили
- Документация (`docs.ursus-siem.ru`) описывает только v2.0; v2.1/2.2
  упоминаются как roadmap
- README + main story — про Sprint 1-6 + 9
- Стратегия и позиционирование — в [URSUS_STRATEGY.md](URSUS_STRATEGY.md)
