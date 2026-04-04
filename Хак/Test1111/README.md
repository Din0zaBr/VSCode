# URSUS SIEM

Централизованная система мониторинга и корреляции событий информационной безопасности.

```
                                    ┌─────────────────────────────────────┐
┌──────────────┐                    │           URSUS SIEM Server         │
│  Agent 1     │─── HTTP POST ────►│                                     │
│  Agent 2     │─── /ingest ──────►│  ┌─────────┐  ┌──────────────────┐  │
│  Agent N     │──────────────────►│  │ Parser  │  │ Correlation      │  │
└──────────────┘                   │  │ (6 fmt) │  │ Engine (4 types) │  │
                                   │  └────┬────┘  └────────┬─────────┘  │
                                   │  ┌────▼────────────────▼─────────┐  │
                                   │  │       PostgreSQL              │  │
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

## Структура проекта

```
ursus-siem/
├── logvault-server/        # Серверная часть (ставится на 1 машину)
│   ├── server/             #   FastAPI backend + PostgreSQL
│   ├── ui/                 #   React frontend
│   ├── docker-compose.yml  #   Весь стек в одном файле
│   ├── start.sh            #   Быстрый запуск
│   └── .env                #   Конфигурация
│
├── logvault-agent/         # Агент сбора логов (ставится на каждый хост)
│   ├── src/                #   Исходный код агента
│   ├── Dockerfile          #   Docker-образ агента
│   ├── docker-compose.yml  #   Запуск через Docker
│   ├── install.sh          #   Установка как systemd-сервис
│   ├── build-in-docker.sh  #   Сборка standalone-бинарника
│   └── config.yaml         #   Конфигурация по умолчанию
│
└── README.md               # Этот файл
```

---

## Быстрый старт

### 1. Запуск сервера

Скопировать `logvault-server/` на сервер (Ubuntu/Debian):

```bash
cd logvault-server
cp .env.example .env
nano .env                    # Задать API_KEYS, JWT_SECRET, PG_PASSWORD
chmod +x start.sh
sudo ./start.sh
```

После запуска скрипт выведет IP сервера и команду для установки агентов.

Сервисы:
- **UI**: `http://<IP>` (через Caddy)
- **API**: `http://<IP>:8000`
- **API Docs**: `http://<IP>:8000/docs`

### 2. Установка агента на хосты

#### Способ A: Дистанционно через сервер (рекомендуется)

На каждом хосте-источнике выполнить одну команду:

```bash
curl -fsSL http://<SERVER_IP>:8000/agent/install | sudo bash -s -- --key <API_KEY>
```

Можно указать ID агента:
```bash
curl -fsSL http://<SERVER_IP>:8000/agent/install | sudo bash -s -- --key <API_KEY> --id web-server-01
```

Скрипт автоматически:
- Установит Docker (если нет)
- Скачает конфиг с сервера
- Запустит агент в контейнере с автоперезапуском

#### Способ B: Docker Compose (ручная установка)

Скопировать `logvault-agent/` на хост:

```bash
cd logvault-agent
# Отредактировать config.yaml: указать server_url и api_key
docker compose up -d
```

#### Способ C: Systemd-сервис (без Docker)

Собрать бинарник и установить как сервис:

```bash
# На машине для сборки:
cd logvault-agent
chmod +x build-in-docker.sh
./build-in-docker.sh        # Создаст release/logvault-agent

# На целевом хосте:
scp -r release/ user@host:~/agent/
ssh user@host 'cd ~/agent && sudo ./install.sh --server http://<SERVER_IP>:8000 --key <KEY>'
```

---

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
Собственный язык запросов для фильтрации событий:

```
filter(level = "ERROR" and src.ip != "127.0.0.1") | select(time, host, message) | sort(time desc) | limit(100)
```

**Операторы:** `=`, `!=`, `>`, `<`, `>=`, `<=`, `IN`, `MATCH`, `CONTAINS`, `STARTSWITH`, `ENDSWITH`
**Pipeline:** `filter()`, `select()`, `sort()`, `limit()`, `group()`, `aggregate()`

### Управление активами
- **Assets** — реестр хостов с авто-обнаружением из логов
- **Accounts** — учётные записи, извлечённые из событий
- **Exclusions** — правила исключения для подавления ложных срабатываний

---

## Стек технологий

| Компонент | Технологии |
|-----------|-----------|
| **Server** | Python 3.12, FastAPI, PostgreSQL, WebSocket |
| **UI** | React 18, TypeScript, Tailwind CSS, Recharts |
| **Agent** | Python 3.12, requests, SQLite (буфер) |
| **Инфраструктура** | Docker Compose, Caddy (reverse proxy, auto-TLS) |

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
| GET/POST | `/correlation/rules` | CRUD правил корреляции |
| GET/PATCH | `/correlation/alerts` | Список и обновление алертов |

### Активы
| Метод | Путь | Описание |
|-------|------|----------|
| GET/POST | `/assets` | Реестр хостов |
| POST | `/assets/discover` | Авто-обнаружение из логов |
| GET/POST | `/accounts` | Учётные записи |
| GET/POST | `/exclusions` | Правила исключения |

### Развёртывание агентов
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/agent/install` | Скрипт установки агента |
| GET | `/agent/config` | Конфигурация агента |
| GET | `/agent/compose` | docker-compose.yml агента |

### Система
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Статус сервера |
| GET | `/health/detailed` | Детальные метрики |
| GET | `/stats/*` | Статистика для дашборда |
| GET | `/agents` | Список подключённых агентов |

---

## Управление

```bash
# Сервер
cd logvault-server
docker compose logs -f          # Логи
docker compose down             # Остановить
docker compose restart          # Перезапустить

# Агент (Docker)
docker logs -f ursus-agent      # Логи
docker restart ursus-agent      # Перезапуск

# Агент (systemd)
journalctl -u logvault-agent -f # Логи
systemctl restart logvault-agent
```

---

## Лицензия

Проект разработан в рамках хакатона.
