# Архитектура URSUS SIEM

## Обзор

URSUS SIEM построен на четырёхуровневой архитектуре: агенты сбора → backend-сервер → база данных → web-интерфейс. Все компоненты упакованы в Docker-контейнеры и управляются через Docker Compose.

---

## Схема развёртывания

```
┌─────────────────────────────────────────────────────────────────┐
│                   Внешние источники событий                      │
│   Агент Linux   │   Syslog UDP/TCP   │   CEF-совместимые СЗИ   │
└────────┬────────┴────────┬───────────┴──────────────────────────┘
         │ POST /ingest    │ Syslog listener
         ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│               Docker Bridge: 172.20.0.0/24                       │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Caddy (Reverse Proxy)                         │  │
│  │   :8000  /api/*  → server:8000                            │  │
│  │   :8080  /*      → ui:80                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│           ↓                                ↓                     │
│  ┌─────────────────────┐   ┌───────────────────────────────┐   │
│  │   FastAPI Server    │   │       React UI (nginx)        │   │
│  │   Python 3.12       │   │   React 18 + TanStack Query   │   │
│  │   ├ 15 роутеров     │   │   Vite + TypeScript           │   │
│  │   ├ 9 сервисов      │   │   17 страниц дашборда         │   │
│  │   └ 3 фоновых потока│   └───────────────────────────────┘   │
│  └──────────┬──────────┘                                        │
│             ↓                                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  PostgreSQL 15+                           │  │
│  │  10 таблиц │ JSONB-метаданные │ FTS-индексы              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         ↑
   Браузер администратора / оператора
```

---

## Компоненты

### 1. Backend (FastAPI)

**Файл запуска**: `server/src/main.py`

Сервер инициализирует все компоненты при старте через `asynccontextmanager lifespan` и регистрирует 15 роутеров.

| Роутер | Префикс | Назначение |
|--------|---------|-----------|
| `auth_router` | `/auth` | Вход, получение токена |
| `users_router` | `/users` | Управление пользователями и ролями |
| `ingest` | `/ingest` | Приём пачек логов от агентов |
| `logs` | `/logs` | WebSocket стриминг в реальном времени |
| `search` | `/search` | Полнотекстовый поиск и PDQL |
| `stats` | `/stats` | Временные ряды и агрегаты |
| `metrics` | `/metrics` | Метрики агентов |
| `correlation` | `/correlation` | Правила и алерты корреляции |
| `alerts` | `/alerts` | Пороговые алерты |
| `agents` | `/agents` | Список агентов и хостов |
| `assets` | `/assets` | Инвентарь активов |
| `integrations` | `/integrations` | Сторонние подключения |
| `ml` | `/ml` | Модули ML (аномалии, UEBA) |
| `agent_deploy` | `/agent` | Скрипты установки агентов |
| `api_keys` | `/admin/api-keys` | Управление API-ключами |

**Фоновые потоки** (daemon threads):
- `alert_loop` — проверяет пороговые алерты каждые 60 секунд
- `correlation_loop` — запускает движок корреляции каждые 30 секунд
- `health_loop` — собирает метрики состояния системы каждые 60 секунд

---

### 2. Слой сервисов

```
server/src/services/
├── pipeline.py      # Конвейер: валидация → обогащение → индексация
├── parser.py        # Универсальный парсер (Syslog, CEF, Nginx, Windows Events)
├── pdql.py          # Парсер и транслятор PDQL → SQL
├── postgres.py      # Абстракция БД (1300+ строк)
├── correlator.py    # Движок корреляции (пороговые правила)
├── alerting.py      # Доставка алертов (Webhook, Telegram)
├── system_health.py # Мониторинг состояния сервера
└── ml_engine.py     # ML-движок (аномалии, классификация)
```

#### Конвейер обработки события

```
POST /ingest (пачка логов)
        ↓
[pipeline.py] Валидация (timestamp + message обязательны)
        ↓
[parser.py]   Обогащение:
              • Определение категории (3 уровня)
              • Тип события (event_type)
              • Извлечение IP-адресов
              • Сопоставление с полями схемы (src.ip, event_src.host…)
              • Извлечение PID, PPID, UID из текста
        ↓
[postgres.py] Пакетная запись в таблицу logs
        ↓
[correlator.py] Фоновая проверка правил (каждые 30 с)
```

---

### 3. База данных (PostgreSQL)

**Схема**: `server/init.sql`

| Таблица | Назначение | Ключевые поля |
|---------|-----------|--------------|
| `logs` | Основная таблица событий | event_id, timestamp, host, agent_id, level, message, meta (JSONB) |
| `users` | Учётные записи SIEM | username, password_hash, role, created_at |
| `user_agents` | Привязка операторов к агентам | user_id, agent_id |
| `services` | Справочник сервисов/программ | id, name |
| `correlation_rules` | Правила корреляции | id, name, severity, conditions (JSONB), sigma_rule |
| `correlation_alerts` | Срабатывания правил | rule_id, status, triggered_at, notes |
| `api_keys` | API-ключи агентов | key_value, name, enabled, created_at |
| `assets` | Инвентарь хостов | hostname, ip, os, department, criticality |
| `known_accounts` | Учётные записи пользователей | username, domain, role, risk_level |
| `exclusions` | Правила подавления алертов | conditions (JSONB), comment |

**Индексы производительности**:
```sql
CREATE INDEX idx_logs_ts      ON logs (timestamp DESC);
CREATE INDEX idx_logs_level   ON logs (level);
CREATE INDEX idx_logs_agent   ON logs (agent_id);
CREATE INDEX idx_logs_fts     ON logs USING GIN (to_tsvector('russian', message));
CREATE INDEX idx_logs_meta    ON logs USING GIN (meta);
```

---

### 4. Аутентификация и авторизация

**Два механизма**:

```
┌─────────────────────────────────────────────────────────┐
│                      Запрос к API                        │
├─────────────────────────────────────────────────────────┤
│  Заголовок Authorization: Bearer <JWT>                  │
│  → Декодирование HS256, проверка exp                    │
│  → Извлечение: username, role, agents[]                 │
├─────────────────────────────────────────────────────────┤
│  Заголовок X-Api-Key: <key>                             │
│  → Проверка в .env API_KEYS                             │
│  → Проверка в таблице api_keys (БД)                     │
│  → Только для POST /ingest                              │
└─────────────────────────────────────────────────────────┘
```

**Роли**:
| Роль | Доступ |
|------|--------|
| `admin` | Полный доступ ко всем данным и настройкам |
| `operator` | Только события привязанных агентов, без настроек системы |

---

### 5. Frontend (React)

**Стек**: React 18, React Router 6, TanStack Query v5, Recharts, Tailwind CSS, TypeScript 5.

**Ключевые страницы**:
| Страница | Компонент | Описание |
|----------|-----------|---------|
| Дашборд | `Dashboard.tsx` | Сводные метрики, графики |
| Канал событий | `Events.tsx` | PDQL-фильтрация, инфинити-скролл, сортировка |
| Поиск | `Search.tsx` | Полнотекстовый поиск |
| Live-логи | `LiveLogs.tsx` | WebSocket стриминг |
| Алерты | `Alerts.tsx` | Пороговые правила |
| Корреляция | `CorrelationRules.tsx` | SIGMA-правила |
| Активы | `Assets.tsx` | Инвентарь хостов, вкладка Агенты |
| Администрирование | `SystemAdmin.tsx` | API-ключи, настройки |

**Взаимодействие с API**: TanStack Query (кэш, авто-обновление). Базовый URL берётся из `VITE_API_URL` или `/api` по умолчанию.

---

### 6. Интеграции

```
server/src/integrations/
├── base.py                  # Абстрактный класс + реестр
├── active_directory.py      # LDAP/AD синхронизация
├── kaspersky_edr.py         # Kaspersky EDR
├── positive_technologies.py # PT Sandbox + PT NAD
├── generic_syslog.py        # UDP/TCP Syslog приёмник
└── generic_cef.py           # CEF-парсер
```

Каждая интеграция реализует интерфейс:
```python
connect() / disconnect() / health_check()
pull_events() / push_event()
pull_ioc() / create_incident() / quarantine_host() / block_ip()
```

---

## Потоки данных

### Приём событий (агент → база)

```
Агент
  → POST /api/ingest  {X-Api-Key, logs: [{timestamp, host, level, message, meta}]}
  → Валидация (400 если нет timestamp или message)
  → parse_and_enrich(message) → meta обогащение
  → bulk INSERT в таблицу logs
  → 200 OK {saved: N}
```

### Канал событий (UI → база)

```
Events.tsx
  → GET /api/search/pdql?q=sort(time+desc)&page=1&size=100&from=...&to=...
  → PDQLParser.parse(q) → AST
  → PDQLToSQL.translate(ast) → SQL + параметры
  → PostgreSQL SELECT + LIMIT/OFFSET
  → JSON: {logs: [...], total: N, page: N}
```

### WebSocket стриминг

```
LiveLogs.tsx
  → WS /api/logs/live?token=<JWT>
  → Сервер: asyncio.Queue(maxsize=1000)
  → Новые события из /ingest → push в queue
  → Стриминг подписчикам (role-based filter)
```

---

## Технологический стек

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Backend | FastAPI | 0.115+ |
| ORM / DB | asyncpg / PostgreSQL | 15+ |
| Аутентификация | python-jose (JWT HS256) | — |
| Хеширование паролей | bcrypt (passlib) | — |
| Frontend | React | 18.3 |
| Сборка frontend | Vite | 6.0 |
| Запросы данных | TanStack Query | 5.60 |
| Графики | Recharts | 2.13 |
| CSS | Tailwind CSS | 3.4 |
| Reverse proxy | Caddy | 2 |
| Контейнеризация | Docker + Compose | v2 |
