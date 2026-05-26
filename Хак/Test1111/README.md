# LogVault — Централизованная система мониторинга логов

Система для сбора, хранения, поиска и визуализации логов с нескольких серверов. Логи хранятся в PostgreSQL с типизацией по сервисам.

```
┌──────────┐     HTTP      ┌────────────┐     ┌──────────────────┐
│  Agent 1 │──────────────►│            │     │   PostgreSQL     │
│  Agent 2 │──────────────►│   Server   │◄───►│  (типизация по   │
│  Agent N │──────────────►│  (FastAPI)  │     │   сервисам)      │
└──────────┘               └──────┬─────┘     └──────────────────┘
                                  │
                           ┌──────┴─────┐
                           │  UI (React) │
                           └────────────┘
```

**Состав системы:**

| Сервис | Технологии | Назначение |
|--------|------------|------------|
| **Agent** | Python 3.12 | Читает логи на целевой машине (файлы, journald), буферизует при потере связи, отправляет на сервер по HTTP |
| **Server** | Python 3.12, FastAPI, PostgreSQL | Принимает логи, сохраняет в БД с нормализацией по типам сервисов, обслуживает REST API и WebSocket |
| **UI** | React 18, TypeScript, Tailwind CSS, Recharts | Дашборд, поиск, просмотр логов в реальном времени, управление алертами |

---

## Требования

- Docker и Docker Compose v2
- Linux-сервер для центральной части (server + PostgreSQL + UI)
- Linux-машина для каждого агента (Ubuntu, Debian, RedOS, CentOS и др.)

Минимум RAM для центрального сервера: **512 МБ**.

---

## Развёртывание центрального сервера

### Шаг 1. Скопируйте проект на сервер

```bash
scp -r ./logvault user@<server-ip>:~/logvault
```

### Шаг 2. Создайте файл переменных окружения

```bash
cd ~/logvault
cp .env.example .env
nano .env
```

Обязательно измените следующие параметры:

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `API_KEYS` | Ключи аутентификации агентов (через запятую) | `changeme-agent-key` |
| `PG_PASSWORD` | Пароль PostgreSQL | `logvault-secret` |
| `SERVER_PORT` | Порт API-сервера | `8000` |
| `UI_PORT` | Порт веб-интерфейса | `3000` |

Для генерации надёжного API-ключа:

```bash
openssl rand -hex 32
```

### Шаг 3. Запустите

```bash
docker compose up -d --build
```

Будут подняты три контейнера:

| Контейнер | Порт | Описание |
|-----------|------|----------|
| `logvault-pg` | 5432 (только localhost) | PostgreSQL 16 |
| `logvault-server` | 8000 | FastAPI сервер |
| `logvault-ui` | 3000 | Веб-интерфейс |

### Шаг 4. Проверьте работоспособность

```bash
# Статус контейнеров
docker compose ps

# Проверка API
curl http://localhost:8000/health
# Ожидаемый ответ: {"status":"ok"}
```

Откройте в браузере: `http://<server-ip>:3000`

---

## Установка агента

Агент устанавливается на каждую машину, с которой нужно собирать логи.

### Шаг 1. Скопируйте файлы агента на целевую машину

```bash
scp -r ./logvault/agent user@<target-host>:~/logvault-agent/agent
scp ./logvault/docker-compose.agent.yml user@<target-host>:~/logvault-agent/docker-compose.yml
```

### Шаг 2. Настройте `agent/config.yaml`

```yaml
server_url: "http://<server-ip>:8000"
agent_id: "my-host-01"
api_key: "ваш-ключ-из-API_KEYS"
hostname: ""

batch_size: 200
flush_interval: 2.0
retry_base: 1.0
retry_max: 60.0
buffer_db: "/data/buffer.db"

sources:
  - type: file
    path: "/var/log/syslog"
    service: "syslog"
```

**Описание параметров:**

| Параметр | Описание |
|----------|----------|
| `server_url` | Адрес центрального сервера (IP или DNS) |
| `agent_id` | Уникальный идентификатор этого агента |
| `api_key` | Должен совпадать с одним из ключей в `API_KEYS` на сервере |
| `hostname` | Имя хоста (если пусто — определяется автоматически) |
| `batch_size` | Сколько логов отправлять за один запрос |
| `flush_interval` | Интервал отправки в секундах |
| `buffer_db` | Путь к SQLite-файлу для буферизации при потере связи |

### Шаг 3. Настройте источники логов

Агент поддерживает два типа источников:

**Чтение файлов** — для syslog, nginx, любых текстовых логов:

```yaml
sources:
  - type: file
    path: "/var/log/syslog"          # Ubuntu / Debian
    service: "syslog"
  - type: file
    path: "/var/log/messages"        # RedOS / CentOS / RHEL
    service: "syslog"
  - type: file
    path: "/var/log/nginx/error.log"
    service: "nginx"
```

**Чтение journald** — для systemd-сервисов:

```yaml
sources:
  - type: journald
    unit: "sshd"
    service: "sshd"
  - type: journald
    unit: "nginx"
    service: "nginx"
```

Поле `service` определяет тип сервиса. На сервере эти типы нормализуются в отдельную таблицу `services` в PostgreSQL — это позволяет фильтровать и группировать логи по сервисам.

### Шаг 4. Запустите агента

```bash
cd ~/logvault-agent
docker compose up -d --build
```

### Шаг 5. Проверьте

```bash
# Логи агента
docker compose logs -f agent

# Должны увидеть:
# Agent agent-01 starting on <hostname>
# Started reader: /var/log/syslog
# Flush worker started (interval=2.0s, batch=200)
```

Агент автоматически появится в списке на дашборде веб-интерфейса.

---

## Схема базы данных

```sql
-- Таблица типов сервисов (нормализация)
CREATE TABLE services (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(128) UNIQUE NOT NULL   -- "syslog", "nginx", "sshd"
);

-- Таблица логов
CREATE TABLE logs (
    id         BIGSERIAL PRIMARY KEY,
    event_id   VARCHAR(64) UNIQUE NOT NULL,
    timestamp  TIMESTAMPTZ NOT NULL,
    host       VARCHAR(255),
    agent_id   VARCHAR(128),
    source     VARCHAR(512),            -- "/var/log/syslog", "journald:sshd"
    level      VARCHAR(16),             -- DEBUG, INFO, WARNING, ERROR, CRITICAL
    message    TEXT,
    service_id INTEGER REFERENCES services(id),  -- FK на тип сервиса
    meta       JSONB                    -- произвольные метаданные
);
```

Индексы: `timestamp`, `level`, `agent_id`, `service_id`, `host`, `source`, полнотекстовый GIN-индекс на `message`.

---

## Веб-интерфейс

### Dashboard

- Карточки: общее число логов, ошибки, предупреждения, кол-во агентов
- Частота логов по времени (stacked area chart по уровням)
- Распределение по уровням (pie chart)
- Тепловая карта ошибок (день / час)
- Топ-сервисы (bar chart)
- Таблица подключённых агентов (agent_id, хост, число логов, последняя активность)
- Выбор интервала: 5m / 15m / 1h / 6h / 1d

### Live Logs

- Просмотр логов в реальном времени через WebSocket
- Фильтры: уровень, сервис, агент, хост, текст
- Пауза / возобновление потока
- Раскрытие записи для просмотра деталей и метаданных

### Search

- Полнотекстовый поиск по сообщениям (PostgreSQL tsvector)
- Фильтры: уровень, сервис, агент, хост, источник, диапазон дат
- Пагинация результатов
- Подсветка найденного текста

### Alerts

- Правила алертов с двумя типами условий:
  - **Threshold**: количество логов уровня X превысило N за M минут
  - **Regex**: в логах найден паттерн
- Каналы уведомлений: Webhook URL, Telegram Bot

---

## REST API

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| POST | `/ingest` | Приём батча логов от агента (заголовок `X-Api-Key`) |
| GET | `/search` | Полнотекстовый поиск с фильтрами |
| GET | `/stats` | Агрегации для графиков дашборда |
| GET | `/agents` | Список агентов с последней активностью |
| WS | `/logs/live` | Логи в реальном времени (WebSocket) |
| GET | `/alerts/` | Список правил алертов |
| POST | `/alerts/` | Создать правило |
| DELETE | `/alerts/{id}` | Удалить правило |
| PUT | `/alerts/` | Заменить все правила |
| GET | `/health` | Проверка работоспособности |

**Параметры поиска** (`GET /search`):

| Параметр | Тип | Описание |
|----------|-----|----------|
| `q` | string | Полнотекстовый запрос |
| `level` | string | Фильтр по уровню (через запятую: `ERROR,WARNING`) |
| `service` | string | Фильтр по имени сервиса |
| `agent_id` | string | Фильтр по ID агента |
| `host` | string | Фильтр по хосту |
| `source` | string | Фильтр по источнику |
| `from` | string | Начало диапазона (ISO 8601) |
| `to` | string | Конец диапазона (ISO 8601) |
| `page` | int | Страница (от 1) |
| `size` | int | Размер страницы (1-500, по умолчанию 50) |

---

## Структура проекта

```
logvault/
├── agent/                        # Агент сбора логов
│   ├── Dockerfile
│   ├── config.yaml               # Конфигурация агента
│   ├── requirements.txt
│   └── src/
│       ├── main.py               # Точка входа, потоки чтения + отправки
│       ├── config.py             # Загрузка YAML-конфигурации
│       ├── models.py             # LogEvent, IngestBatch
│       ├── buffer.py             # Офлайн-буфер (SQLite)
│       ├── readers/
│       │   ├── base.py           # Абстрактный LogReader
│       │   ├── file_reader.py    # Чтение файлов (syslog, nginx, access log)
│       │   └── journald_reader.py  # Чтение systemd journal
│       └── transport/
│           ├── base.py           # Абстрактный Transport
│           └── http.py           # HTTP POST с retry и backoff
│
├── server/                       # API-сервер
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── init.sql                  # Схема БД (таблицы services, logs, индексы)
│   └── src/
│       ├── main.py               # FastAPI-приложение
│       ├── config.py             # Настройки из переменных окружения
│       ├── auth.py               # Аутентификация по X-Api-Key
│       ├── models.py             # Pydantic-модели API
│       ├── routers/
│       │   ├── ingest.py         # POST /ingest
│       │   ├── search.py         # GET /search
│       │   ├── logs.py           # WebSocket /logs/live
│       │   ├── stats.py          # GET /stats
│       │   ├── agents.py         # GET /agents
│       │   └── alerts.py         # CRUD /alerts/
│       └── services/
│           ├── postgres.py       # PGService — работа с PostgreSQL
│           ├── pipeline.py       # Валидация, обогащение, вставка
│           └── alerting.py       # Фоновый цикл проверки алертов
│
├── ui/                           # Веб-интерфейс
│   ├── Dockerfile                # Сборка + nginx
│   ├── nginx.conf                # Проксирование /api/ на сервер
│   ├── package.json
│   └── src/
│       ├── App.tsx               # Навигация и маршруты
│       ├── main.tsx              # React root
│       ├── api/client.ts         # Типизированный API-клиент
│       ├── hooks/                # useSearch, useWebSocket
│       ├── pages/                # Dashboard, LiveLogs, Search, Alerts
│       └── components/           # LogTable, TimeChart, LevelPieChart, HeatMap, ServiceBarChart
│
├── docker-compose.yml            # Центральный стек (postgres + server + ui)
├── docker-compose.agent.yml      # Docker Compose для агента
├── .env.example                  # Пример переменных окружения
└── README.md
```

---

## Безопасность

- Агенты аутентифицируются по API-ключу в заголовке `X-Api-Key`
- PostgreSQL доступен только внутри docker-сети (порт 5432 проброшен на 127.0.0.1)
- Ограничение размера батча на `/ingest` (по умолчанию 5000 записей)
- CORS настраивается через переменную `CORS_ORIGINS`
- Файл `.env` с секретами не коммитится (указан в `.gitignore`)

---

## Масштабирование

Добавление нового агента:

1. Скопируйте `agent/` и `docker-compose.agent.yml` на новую машину
2. Задайте уникальный `agent_id` в `config.yaml`
3. Укажите `server_url` и `api_key`
4. Запустите `docker compose up -d --build`

Агент автоматически появится в веб-интерфейсе после отправки первого батча логов.

---

## Устранение неполадок

**Агент не отправляет логи:**

```bash
# Проверьте доступность сервера с машины агента
curl http://<server-ip>:8000/health

# Проверьте логи агента
docker compose logs -f agent

# Частые причины:
# - api_key не совпадает с API_KEYS на сервере (ответ 401)
# - server_url указывает на неправильный адрес
# - Файл лога не существует (на RedOS: /var/log/messages, не /var/log/syslog)
```

**PostgreSQL не запускается:**

```bash
docker compose logs postgres

# Частые причины:
# - Порт 5432 уже занят другим процессом
# - Нет прав на запись в docker volume
```

**UI не загружается:**

```bash
docker compose ps
docker compose logs ui

# Проверьте, что server запущен и доступен
```

**Логи не появляются в поиске:**

```bash
# Проверьте, что данные попадают в БД
docker compose exec postgres psql -U logvault -d logvault -c "SELECT count(*) FROM logs;"

# Проверьте типы сервисов
docker compose exec postgres psql -U logvault -d logvault -c "SELECT * FROM services;"
```
