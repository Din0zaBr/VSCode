# URSUS SIEM

Централизованная система мониторинга и корреляции событий информационной безопасности.

```
┌──────────────┐                    ┌─────────────────────────────────────┐
│  Agent 1     │─── HTTP POST ────►│           URSUS SIEM Server         │
│  Agent 2     │─── /ingest ──────►│                                     │
│  Agent N     │──────────────────►│  ┌─────────┐  ┌──────────────────┐  │
└──────────────┘                   │  │ Parser  │  │ Correlation      │  │
                                   │  │ (6 fmt) │  │ Engine (4 types) │  │
┌──────────────┐                   │  └────┬────┘  └────────┬─────────┘  │
│  agent_v     │                   │       │                │            │
│ (OpenSearch) │                   │  ┌────▼────────────────▼─────────┐  │
└──────────────┘                   │  │       PostgreSQL              │  │
                                   │  │  logs, correlation_rules,     │  │
                                   │  │  assets, accounts, exclusions │  │
                                   │  └──────────────┬───────────────┘  │
                                   └─────────────────┼──────────────────┘
                                                     │
                                              ┌──────▼──────┐
                                              │  React UI   │
                                              │  Dashboard  │
                                              │  PDQL Search│
                                              │  Live Logs  │
                                              └─────────────┘
```

## Возможности

### Сбор и обогащение событий
- **Агенты** читают логи из файлов и journald, буферизуют при потере связи
- **Расширенный парсер** — RFC 5424, RFC 3164, CEF, Nginx/Apache, Windows Event Log, syslog
- **Трёхуровневая категоризация** событий (generic / high / low) по стандарту MaxPatrol SIEM

### Корреляционный движок
- **4 типа правил**: threshold (с group_by), pattern (regex), keyword, port_scan
- **8 предустановленных правил** обнаружения (bruteforce, privilege escalation, port scan и др.)
- **Cooldown** — защита от спама алертов (5 мин между одинаковыми срабатываниями)

### PDQL — язык запросов
Собственный язык запросов для фильтрации событий, аналог MaxPatrol SIEM:

```
filter(level = "ERROR" and src.ip != "127.0.0.1") | select(time, host, message) | sort(time desc) | limit(100)
```

**Операторы:** `=`, `!=`, `>`, `<`, `>=`, `<=`, `IN`, `MATCH`, `CONTAINS`, `STARTSWITH`, `ENDSWITH`
**Логика:** `AND`, `OR`, `NOT`
**Функции:** `match()`, `in_subnet()`, `in_list()`
**Pipeline:** `filter()`, `select()`, `sort()`, `limit()`, `group()`, `aggregate()`

**Агрегация:**
```
filter(level = "ERROR") | group(event_src.host) | aggregate(count(), min(time), max(time)) | sort(count desc) | limit(20)
```

### Управление активами
- **Assets** — реестр хостов с авто-обнаружением из логов
- **Accounts** — учётные записи, извлечённые из событий
- **Exclusions** — правила исключения для подавления ложных срабатываний

### Интеграции (фундамент)
- **Active Directory** — синхронизация пользователей и групп (заглушка, требует ldap3)
- **Kaspersky EDR**, **PT Sandbox**, **PT NAD** — подключение ИБ-продуктов (заглушки)
- **Syslog / CEF Receiver** — приём событий по стандартным протоколам (заглушки)

### ML Engine (фундамент)
- Детекция аномалий, кластеризация, UEBA — интерфейсы для будущих моделей

---

## Стек технологий

| Компонент | Технологии |
|-----------|-----------|
| **Server** | Python 3.12, FastAPI, PostgreSQL, WebSocket |
| **UI** | React 18, TypeScript, Tailwind CSS, Recharts |
| **Agent** | Python 3.12, requests, SQLite (буфер) |
| **Инфраструктура** | Docker Compose, Caddy (reverse proxy, auto-TLS) |

---

## Быстрый старт

### 1. Клонировать и настроить

```bash
cd Хак/Test1111
cp .env.example .env
# Отредактировать .env: задать API_KEYS, JWT_SECRET, PG_PASSWORD
```

### 2. Запустить стек

```bash
docker-compose up -d
```

Сервисы:
- **UI**: http://localhost (через Caddy)
- **API**: http://localhost/api
- **PostgreSQL**: localhost:5432 (только localhost)

### 3. Подключить агент

На целевой машине:

```bash
# Отредактировать agent/config.yaml — указать server_url и api_key
docker-compose -f docker-compose.agent.yml up -d
```

---

## Структура проекта

```
Хак/Test1111/
├── server/                    # FastAPI backend
│   ├── src/
│   │   ├── main.py            # Точка входа, lifespan, роутеры
│   │   ├── config.py          # Конфигурация из env
│   │   ├── auth.py            # JWT + API key аутентификация
│   │   ├── models.py          # Pydantic модели
│   │   ├── routers/           # API эндпоинты
│   │   │   ├── ingest.py      # POST /ingest — приём логов
│   │   │   ├── search.py      # GET /search, GET /search/pdql
│   │   │   ├── logs.py        # WebSocket /logs/live
│   │   │   ├── correlation.py # CRUD правил и алертов корреляции
│   │   │   ├── assets.py      # Assets, Accounts, Exclusions
│   │   │   ├── alerts.py      # Threshold-алерты
│   │   │   ├── stats.py       # Статистика для дашборда
│   │   │   ├── agents.py      # Список агентов
│   │   │   ├── ml.py          # ML API (заглушки)
│   │   │   └── integrations.py# Управление интеграциями
│   │   ├── services/          # Бизнес-логика
│   │   │   ├── postgres.py    # PostgreSQL операции
│   │   │   ├── pipeline.py    # Validate -> Enrich -> Index
│   │   │   ├── parser.py      # Парсер логов + категоризация
│   │   │   ├── pdql.py        # PDQL -> SQL транслятор
│   │   │   ├── correlator.py  # Корреляционный движок
│   │   │   ├── alerting.py    # Threshold-алерты + Telegram
│   │   │   ├── ml_engine.py   # ML заглушки
│   │   │   └── system_health.py # Мониторинг здоровья
│   │   └── integrations/      # Коннекторы к ИБ-продуктам
│   ├── init.sql               # Схема БД
│   ├── Dockerfile
│   └── requirements.txt
├── ui/                        # React frontend
│   ├── src/
│   │   ├── App.tsx            # Роутинг + навигация
│   │   ├── api/client.ts      # TypeScript API клиент
│   │   ├── components/        # PDQLInput, HeatMap, Charts...
│   │   └── pages/             # Dashboard, Search, LiveLogs,
│   │                          # CorrelationRules, Assets...
│   ├── Dockerfile
│   └── package.json
├── agent/                     # Агент сбора логов
│   ├── src/
│   │   ├── readers/           # File, journald
│   │   └── transport/         # HTTP с retry
│   ├── config.yaml
│   └── Dockerfile
├── docker-compose.yml         # Основной стек
├── docker-compose.agent.yml   # Агент (отдельно)
├── Caddyfile                  # Reverse proxy
└── .env.example               # Шаблон конфигурации
```

---

## API эндпоинты

### Аутентификация
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/auth/login` | Получить JWT токен |
| POST | `/auth/register` | Регистрация пользователя (admin) |

### Логи
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/ingest` | Приём логов от агента (X-Api-Key) |
| GET | `/search` | Поиск по логам |
| GET | `/search/pdql` | Поиск через PDQL |
| WS | `/logs/live` | WebSocket — логи в реальном времени |

### Корреляция
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/correlation/rules` | Список правил корреляции |
| POST | `/correlation/rules` | Создать правило (admin) |
| PUT | `/correlation/rules/{id}` | Обновить правило (admin) |
| DELETE | `/correlation/rules/{id}` | Удалить правило (admin) |
| GET | `/correlation/alerts` | Список алертов корреляции |
| PATCH | `/correlation/alerts/{id}` | Обновить статус алерта |

### Активы
| Метод | Путь | Описание |
|-------|------|----------|
| GET/POST | `/assets` | Список / создание хостов |
| POST | `/assets/discover` | Авто-обнаружение из логов |
| GET/POST | `/accounts` | Список / создание учётных записей |
| GET/POST | `/exclusions` | Список / создание исключений |

### Система
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Статус сервера |
| GET | `/health/detailed` | Детальные метрики (auth) |
| GET | `/stats/*` | Статистика для дашборда |
| GET | `/agents` | Список подключённых агентов |
| GET | `/integrations` | Список интеграций |
| GET | `/ml/status` | Статус ML-подсистемы |

---

## agent_v (OpenSearch)

В директории `Хак/agent_v/` находится автономный агент для отправки логов в OpenSearch/Elasticsearch. Он не зависит от основного стека URSUS SIEM и может использоваться отдельно для интеграции с существующей инфраструктурой ELK/OpenSearch.

---

## Лицензия

Проект разработан в рамках хакатона.
