# URSUS SIEM — Полная документация

## Содержание

1. [Обзор архитектуры](#1-обзор-архитектуры)
2. [Быстрый старт](#2-быстрый-старт)
3. [Конфигурация сервера](#3-конфигурация-сервера)
4. [Подключение агентов](#4-подключение-агентов)
5. [Язык запросов PDQL](#5-язык-запросов-pdql)
6. [Корреляционный движок](#6-корреляционный-движок)
7. [Управление активами](#7-управление-активами)
8. [Интеграции](#8-интеграции)
9. [API-справочник](#9-api-справочник)
10. [Схема базы данных](#10-схема-базы-данных)
11. [Устранение неполадок](#11-устранение-неполадок)

---

## 1. Обзор архитектуры

```
┌─────────────────────────────────────────────────────────────────────┐
│                         URSUS SIEM                                  │
│                                                                     │
│  Агенты (на каждом хосте)         Центральный сервер                │
│  ┌────────────────────┐           ┌──────────────────────────────┐  │
│  │  agent             │  HTTP     │  FastAPI Server              │  │
│  │  - читает файлы    ├──────────►│  - Parser (6 форматов)       │  │
│  │  - читает journald │  POST     │  - Correlator (4 типа правил)│  │
│  │  - буфер SQLite    │  /ingest  │  - Alert Engine              │  │
│  └────────────────────┘           │  - ML Engine (stub)          │  │
│                                   └──────────────┬───────────────┘  │
│                                   ┌─────────────▼──────────────┐  │
│                                   │  PostgreSQL                │  │
│                                   │  logs, rules, assets, ...   │  │
│                                   └─────────────┬───────────────┘  │
│                                                 │                   │
│                                   ┌─────────────▼──────────────┐   │
│                                   │  React UI                  │   │
│                                   │  Dashboard / PDQL / Live   │   │
│                                   └────────────────────────────┘   │
│                                                                     │
│  Caddy (reverse proxy, auto-TLS)  порты 80/443                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Стек:**

| Компонент | Технологии | Порт |
|-----------|-----------|------|
| Caddy | caddy:2-alpine | 80, 443 (публичный) |
| Server | Python 3.12, FastAPI, uvicorn | 8000 (внутренний) |
| UI | React 18, TypeScript, Tailwind, Recharts | 80 (внутренний) |
| PostgreSQL | postgres:16 + pg_cron | 5432 (localhost only) |
| Agent | Python 3.12, requests | — (исходящий) |

---

## 2. Быстрый старт

### Требования

- **Docker Desktop** ≥ 24.0 (Windows / macOS / Linux)
- Свободные порты: `80`, `443`, `5432`
- На Linux: убедитесь, что пользователь в группе `docker`

### Установка и запуск

```bash
# 1. Скопировать logvault-server/ на сервер
cd logvault-server

# 2. Создать конфигурационный файл
cp .env.example .env

# 3. Задать минимальные секреты в .env (обязательно!)
#    API_KEYS=my-secret-key
#    JWT_SECRET=my-random-jwt-secret

# 4. Быстрый запуск (установит Docker, соберёт образы, запустит)
chmod +x start.sh
sudo ./start.sh

# Или вручную:
docker compose up -d --build
docker compose ps
```

Первый запуск занимает **2–5 минут** (сборка образов).

После запуска скрипт выведет команду для установки агентов на хосты.

### Доступ к UI

Открыть в браузере: **http://IP-СЕРВЕРА**

**Учётные данные по умолчанию:**
- Логин: `admin`
- Пароль: `admin`

### Полезные команды

```bash
# Остановить
docker compose down

# Остановить и удалить данные БД
docker compose down -v

# Посмотреть логи сервера
docker compose logs -f server

# Посмотреть логи всех сервисов
docker compose logs -f

# Перезапустить только сервер
docker compose restart server

# Статус контейнеров
docker compose ps
```

---

## 3. Конфигурация сервера

Все настройки задаются через файл `.env` в директории `logvault-server/`.

### Полный список переменных

```env
# ── Домен ──────────────────────────────────────────────────
# Caddy использует это как домен для TLS-сертификата.
# Для локальной разработки: localhost (самоподписанный сертификат)
# Для продакшна: ваш домен, например siem.company.ru
DOMAIN=localhost

# ── Аутентификация агентов ──────────────────────────────────
# API-ключи агентов (через запятую для нескольких агентов)
API_KEYS=changeme-agent-key

# ── CORS ────────────────────────────────────────────────────
# Разрешённые источники для браузерных запросов
# Для локальной разработки: *
# Для продакшна: https://siem.company.ru
CORS_ORIGINS=*

# ── База данных ─────────────────────────────────────────────
PG_PASSWORD=logvault-secret
DATABASE_URL=postgresql://logvault:logvault-secret@postgres:5432/logvault

# ── JWT ─────────────────────────────────────────────────────
# Обязательно смените на случайную строку в продакшне!
JWT_SECRET=logvault-jwt-secret-change-me
JWT_EXPIRE_MINUTES=480       # Время жизни токена (480 = 8 часов)

# ── Производительность ──────────────────────────────────────
MAX_BATCH_SIZE=5000          # Макс. событий в одном запросе /ingest
LIVE_BUFFER_SIZE=500         # Буфер последних событий для WebSocket

# ── Алерты (опционально) ────────────────────────────────────
ALERT_WEBHOOK_URL=           # HTTP webhook для уведомлений
ALERT_TELEGRAM_TOKEN=        # Токен Telegram-бота
ALERT_TELEGRAM_CHAT_ID=      # ID чата для уведомлений

# ── Настройки агента (для docker-compose.agent.yml) ─────────
SERVER_URL=http://192.168.1.10:8000   # Адрес сервера URSUS
AGENT_ID=agent-01                      # Уникальный ID агента
API_KEY=changeme-agent-key             # Ключ агента (из API_KEYS)

# ── Active Directory (опционально) ──────────────────────────
AD_SERVER=                   # Например: ldap.company.ru
AD_DOMAIN=                   # Например: company.ru
AD_USERNAME=                 # Сервисный аккаунт AD
AD_PASSWORD=
AD_BASE_DN=                  # Например: DC=company,DC=ru
AD_USE_SSL=true
```

---

## 4. Подключение агентов

Агент устанавливается на каждый хост, с которого нужно собирать логи.
Он читает файлы и/или systemd journal, буферизует данные локально при потере связи и отправляет их на сервер URSUS.

### Конфигурация агента

Файл `logvault-agent/config.yaml`:

```yaml
# Адрес сервера URSUS SIEM
server_url: "https://siem.company.ru/api"   # или http://192.168.1.10:8000

# Уникальный идентификатор этого агента
agent_id: "web-server-01"

# API-ключ (должен быть в списке API_KEYS на сервере)
api_key: "changeme-agent-key"

# Имя хоста (пусто = определить автоматически)
hostname: ""

# Параметры отправки
batch_size: 200          # событий за один HTTP-запрос
flush_interval: 2.0      # секунд между отправками
retry_base: 1.0          # начальная задержка retry (секунды)
retry_max: 60.0          # максимальная задержка retry (секунды)

# Локальный буфер (SQLite) на случай недоступности сервера
buffer_db: "/data/buffer.db"

# Источники логов
sources:
  # Файловые источники
  - type: file
    path: "/var/log/syslog"
    service: "syslog"

  - type: file
    path: "/var/log/auth.log"
    service: "auth"

  - type: file
    path: "/var/log/nginx/access.log"
    service: "nginx"

  - type: file
    path: "/var/log/nginx/error.log"
    service: "nginx"

  # Systemd journal (только Linux с systemd)
  - type: journald
    unit: "sshd"
    service: "sshd"

  - type: journald
    unit: "nginx"
    service: "nginx"
```

---

### Способ 1: Дистанционная установка через сервер (рекомендуется)

Сервер URSUS раздаёт скрипт установки агента. На каждом хосте-источнике выполните одну команду:

```bash
curl -fsSL http://<SERVER_IP>:8000/agent/install | sudo bash -s -- --key <API_KEY>
```

С указанием ID агента:
```bash
curl -fsSL http://<SERVER_IP>:8000/agent/install | sudo bash -s -- --key <API_KEY> --id web-server-01
```

Скрипт автоматически:
- Установит Docker (если нет)
- Скачает конфигурацию с сервера
- Запустит агент в Docker с автоперезапуском

**Обновление агента** — та же команда, старый контейнер заменяется автоматически.

**Удаление агента:**
```bash
docker compose -f /opt/ursus-agent/docker-compose.yml down
rm -rf /opt/ursus-agent
```

---

### Способ 2: Docker Compose (ручная установка)

Скопируйте папку `logvault-agent/` на целевой хост.

```bash
cd logvault-agent

# Отредактировать config.yaml: указать server_url, agent_id, api_key
nano config.yaml

# Запустить
docker compose up -d

# Проверить
docker compose logs -f
```

Агент автоматически перезапускается при сбоях (`restart: unless-stopped`).

---

### Способ 3: Systemd-сервис (standalone-бинарник, без Docker)

Для хостов без Docker. Бинарник собирается один раз и устанавливается как системная служба.

**Сборка бинарника** (на машине с Docker):
```bash
cd logvault-agent
chmod +x build-in-docker.sh
./build-in-docker.sh
# Результат: release/logvault-agent + release/install.sh + release/config.yaml
```

**Установка на целевом хосте:**
```bash
scp -r release/ user@host:~/agent/
ssh user@host 'cd ~/agent && sudo ./install.sh --server http://<SERVER_IP>:8000 --key <KEY> --id web-01'
```

**Управление:**
```bash
systemctl status logvault-agent   # Статус
journalctl -u logvault-agent -f   # Логи
systemctl restart logvault-agent   # Перезапуск
```

---

### Способ 4: Windows-сервер

#### Вариант A: WSL2 (Windows Subsystem for Linux)

```powershell
# PowerShell (от имени администратора)
wsl --install -d Ubuntu

# Затем в WSL — дистанционная установка:
curl -fsSL http://<SERVER_IP>:8000/agent/install | sudo bash -s -- --key <API_KEY>
```

#### Вариант B: Docker Desktop для Windows

```powershell
# Скопировать logvault-agent/ и запустить:
cd logvault-agent
docker compose up -d
```

---

### Добавление нескольких агентов

На сервере в `.env` укажите несколько ключей через запятую:

```env
API_KEYS=key-for-web-01,key-for-db-01,key-for-app-01
```

Каждый агент получает свой ключ и уникальный `agent_id`.

Проверить подключённые агенты: **UI → Агенты** или `GET /agents`.

---

### Формат отправляемых событий

Агент отправляет батчи на `POST /ingest`:

```json
{
  "agent_id": "web-server-01",
  "api_key": "changeme-agent-key",
  "logs": [
    {
      "event_id": "uuid4",
      "timestamp": "2026-04-04T12:00:00Z",
      "host": "web-server-01",
      "source": "/var/log/nginx/access.log",
      "level": "INFO",
      "message": "192.168.1.5 - - [04/Apr/2026] \"GET /api/health HTTP/1.1\" 200 42",
      "service": "nginx",
      "meta": {}
    }
  ]
}
```

Заголовок: `X-Api-Key: changeme-agent-key`

---

### Логи агента — что означают уровни

| Уровень | Значение |
|---------|----------|
| `INFO` | Нормальная работа, отправка батчей |
| `WARNING` | Временная ошибка, агент повторит попытку |
| `ERROR` | Серьёзная ошибка (неверный ключ, недоступный файл) |
| `CRITICAL` | Агент не может продолжать работу |

---

## 5. Язык запросов PDQL

PDQL (Pipeline Data Query Language) — собственный язык запросов для фильтрации и анализа событий.

### Синтаксис

```
команда(аргументы) | команда(аргументы) | ...
```

### Команды

| Команда | Описание | Пример |
|---------|----------|--------|
| `filter(условие)` | Фильтрация событий | `filter(level = "ERROR")` |
| `select(поля)` | Выбор колонок | `select(time, host, message)` |
| `sort(поле asc\|desc)` | Сортировка | `sort(time desc)` |
| `limit(N)` | Ограничение результатов | `limit(100)` |
| `group(поле)` | Группировка | `group(event_src.host)` |
| `aggregate(функции)` | Агрегация | `aggregate(count(), min(time))` |

### Операторы сравнения

| Оператор | Описание | Пример |
|----------|----------|--------|
| `=` | Равно | `level = "ERROR"` |
| `!=` | Не равно | `level != "INFO"` |
| `>`, `<`, `>=`, `<=` | Сравнение | `time > "2026-01-01"` |
| `contains` | Содержит | `message contains "failed"` |
| `startswith` | Начинается с | `host startswith "web-"` |
| `endswith` | Заканчивается на | `source endswith ".log"` |
| `match` | Регулярное выражение | `message match "error.*timeout"` |
| `in [...]` | Входит в список | `level in ["ERROR", "CRITICAL"]` |

### Функции

| Функция | Описание | Пример |
|---------|----------|--------|
| `match(поле, regex)` | Regex-поиск | `match(message, "ssh.*failed")` |
| `in_subnet(поле, cidr)` | Проверка подсети | `in_subnet(src.ip, "10.0.0.0/8")` |
| `in_list([список], поле)` | Поиск в списке | `in_list(["admin","root"], subject.name)` |

### Логические операторы

```
and, or, not  (регистронезависимо: AND, OR, NOT)
```

### Функции агрегации

| Функция | Описание |
|---------|----------|
| `count()` | Количество событий |
| `count_distinct(поле)` | Количество уникальных значений |
| `sum(поле)` | Сумма (для числовых полей) |
| `avg(поле)` | Среднее значение |
| `min(поле)` / `max(поле)` | Минимум / максимум |
| `first(поле)` / `last(поле)` | Первое / последнее значение |

### Поля событий

**Базовые поля:**

| PDQL | Описание |
|------|----------|
| `time` | Время события |
| `message` / `text` | Текст сообщения |
| `level` | Уровень (CRITICAL, ERROR, WARNING, INFO, DEBUG) |
| `agent_id` | ID агента |
| `source` | Источник (путь к файлу лога) |
| `event_src.host` | Хост-источник |

**Категории:**

| PDQL | Описание |
|------|----------|
| `category.generic` | Общая категория (Access, Malware, ...) |
| `category.high` | Подкатегория (Authentication, Attack, ...) |
| `category.low` | Детальная категория (Remote, Bruteforce, ...) |

**Сетевые поля:**

| PDQL | Описание |
|------|----------|
| `src.ip` | IP источника |
| `src.host` | Хост источника |
| `src.port` | Порт источника |
| `dst.ip` | IP назначения |
| `dst.host` | Хост назначения |
| `dst.port` | Порт назначения |

**Субъект и объект:**

| PDQL | Описание |
|------|----------|
| `subject.name` | Имя пользователя (субъект действия) |
| `subject.domain` | Домен пользователя |
| `subject.account.name` | Имя учётной записи |
| `subject.process.cmdline` | Командная строка процесса |
| `object.name` | Имя объекта действия |
| `object.path` | Путь к объекту |
| `object.hash.md5` | MD5-хэш файла |
| `object.hash.sha256` | SHA256-хэш файла |

### Примеры запросов

```
# Все ошибки за последний час
filter(level = "ERROR" or level = "CRITICAL") | sort(time desc) | limit(50)

# Неудачные авторизации с внешних IP
filter(category.high = "Authentication" and message contains "failed" and not in_subnet(src.ip, "10.0.0.0/8")) | sort(time desc)

# Топ-10 хостов по количеству ошибок
filter(level = "ERROR") | group(event_src.host) | aggregate(count()) | sort(count desc) | limit(10)

# Трафик по портам назначения (поиск сканирования)
filter(dst.port != "") | group(dst.port) | aggregate(count(), count_distinct(src.ip)) | sort(count desc) | limit(20)

# Действия конкретного пользователя
filter(subject.name = "john.doe" or subject.account.name = "john.doe") | sort(time desc) | limit(100)

# Файлы с подозрительными хэшами
filter(object.hash.md5 in ["d41d8cd98f00b204e9800998ecf8427e", "098f6bcd4621d373cade4e832627b4f6"]) | select(time, host, object.path, object.hash.md5)

# Nginx 5xx ошибки
filter(service = "nginx" and message match "\" [5][0-9]{2} ") | sort(time desc)

# Группировка событий по категории
filter(time > "2026-04-01") | group(category.generic) | aggregate(count()) | sort(count desc)
```

---

## 6. Корреляционный движок

Движок запускается в фоне каждые 10 секунд и проверяет последние события на соответствие правилам.

### Типы правил

#### threshold — Порог событий

Срабатывает, когда количество событий превышает порог за заданный период.

```json
{
  "type": "threshold",
  "pattern": "Failed password|authentication failure",
  "window": 60,
  "count": 5,
  "group_by": "source_ip"
}
```

- `pattern` — regex для фильтрации событий
- `window` — временное окно в секундах
- `count` — порог срабатывания
- `group_by` — поле группировки (`source_ip`, `host`, и т.д.)

#### pattern — Паттерн

Срабатывает при совпадении с regex-паттерном.

```json
{
  "type": "pattern",
  "pattern": "sudo.*COMMAND|su\\[",
  "window": 600
}
```

#### keyword — Ключевые слова

Срабатывает при наличии любого из ключевых слов в сообщении.

```json
{
  "type": "keyword",
  "keywords": ["malware", "trojan", "ransomware", "backdoor"],
  "window": 600
}
```

#### port_scan — Сканирование портов

Срабатывает при обращении с одного IP к множеству разных портов.

```json
{
  "type": "port_scan",
  "unique_ports": 20,
  "window": 30
}
```

- `unique_ports` — порог уникальных портов
- `window` — временное окно в секундах

### Предустановленные правила

Создаются автоматически при первом запуске сервера:

| Правило | Тип | Описание |
|---------|-----|----------|
| SSH Bruteforce | threshold | 5 неудач за 60 сек с одного IP |
| FTP Bruteforce | threshold | 10 неудач за 60 сек |
| Web Bruteforce | threshold | 20 неудач за 60 сек |
| Port Scan | port_scan | 20 уникальных портов за 30 сек |
| Privilege Escalation | pattern | sudo/su команды |
| Malware Keywords | keyword | malware, trojan, ransomware, ... |
| New User Created | pattern | useradd/adduser команды |
| Root Login | pattern | прямой вход под root |

### Cooldown

Между повторными срабатываниями одного правила для одного источника — минимум **5 минут**. Это предотвращает спам алертами.

### Исключения

Перед созданием алерта движок проверяет таблицу `exclusions`. Если событие попадает под исключение — алерт не создаётся.

### Управление правилами

**UI:** Правила корреляции → Создать правило

**API:**
```bash
# Создать правило
curl -sk -X POST https://localhost/api/correlation/rules \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-rule-001",
    "name": "Много запросов к API",
    "description": "Более 100 запросов за минуту с одного IP",
    "severity": "HIGH",
    "enabled": true,
    "conditions": {
      "type": "threshold",
      "pattern": "POST /api/",
      "window": 60,
      "count": 100,
      "group_by": "source_ip"
    }
  }'

# Список правил
curl -sk https://localhost/api/correlation/rules \
  -H "Authorization: Bearer TOKEN"

# Удалить правило
curl -sk -X DELETE https://localhost/api/correlation/rules/my-rule-001 \
  -H "Authorization: Bearer TOKEN"
```

---

## 7. Управление активами

### Assets (Хосты)

Реестр всех отслеживаемых хостов. Поддерживает авто-обнаружение из логов.

**Поля:**

| Поле | Тип | Описание |
|------|-----|----------|
| hostname | string | Имя хоста (уникальное) |
| ip | string | IP-адрес |
| os | string | Операционная система |
| department | string | Отдел |
| owner | string | Ответственный |
| criticality | LOW/MEDIUM/HIGH/CRITICAL | Критичность |
| tags | список | Произвольные метки |
| status | active/inactive/decommissioned | Статус |

**Авто-обнаружение:** UI → Активы → «Обнаружить из логов»
Сервер выполняет `SELECT DISTINCT host FROM logs` и добавляет новые хосты.

### Accounts (Учётные записи)

Реестр пользователей, извлечённых из событий безопасности.

**Поля:**

| Поле | Тип | Описание |
|------|-----|----------|
| username | string | Имя пользователя |
| domain | string | Домен |
| risk_level | NORMAL/ELEVATED/HIGH/CRITICAL | Уровень риска |
| is_privileged | bool | Привилегированная учётная запись |
| is_service_account | bool | Сервисная учётная запись |

### Exclusions (Исключения)

Правила для подавления ложных срабатываний корреляции.

**Типы исключений:**

| Тип | Описание |
|-----|----------|
| `event` | Исключить события по условию |
| `host` | Исключить все события с хоста |
| `user` | Исключить все события пользователя |
| `ip` | Исключить все события с IP |
| `rule` | Отключить правило для источника |

**Пример:**

```json
{
  "name": "Исключить сканирование от мониторинга",
  "exclusion_type": "ip",
  "conditions": {
    "field": "src.ip",
    "operator": "=",
    "value": "10.0.0.5"
  },
  "scope": "correlation",
  "enabled": true
}
```

---

## 8. Интеграции

### Active Directory

Коннектор позволит синхронизировать пользователей и компьютеры из AD (фундамент, требует настройки).

**Конфигурация через .env:**

```env
AD_SERVER=ldap.company.ru
AD_DOMAIN=company.ru
AD_USERNAME=svc-ursus@company.ru
AD_PASSWORD=secret
AD_BASE_DN=DC=company,DC=ru
AD_USE_SSL=true
```

**Конфигурация через UI:** Интеграции → Active Directory → «Настроить»

**API:**
```bash
# Статус
curl -sk https://localhost/api/integrations/ad/status -H "Authorization: Bearer TOKEN"

# Тест подключения
curl -sk -X POST https://localhost/api/integrations/ad/test -H "Authorization: Bearer TOKEN"

# Синхронизация
curl -sk -X POST https://localhost/api/integrations/ad/sync -H "Authorization: Bearer TOKEN"
```

### Другие интеграции (фундамент)

| Интеграция | Категория | Статус |
|-----------|-----------|--------|
| Kaspersky EDR | edr | Заглушка |
| PT Sandbox | sandbox | Заглушка |
| PT NAD | nta | Заглушка |
| Syslog Receiver | syslog | Заглушка |
| CEF Receiver | cef | Заглушка |

Все интеграции имеют унифицированный API:
- `GET /integrations` — список
- `GET /integrations/{name}/status` — статус
- `POST /integrations/{name}/configure` — настройка
- `POST /integrations/{name}/test` — тест
- `POST /integrations/{name}/sync` — синхронизация

---

## 9. API-справочник

**Base URL:** `https://localhost/api`
**Auth:** `Authorization: Bearer <JWT-токен>` (кроме `/auth/login`)
**Agent Auth:** `X-Api-Key: <api-key>` (только `/ingest`)

### Получить токен

```bash
curl -sk -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

Ответ:
```json
{
  "token": "eyJ...",
  "username": "admin",
  "role": "admin"
}
```

### Все эндпоинты

#### Аутентификация

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/auth/login` | — | Получить JWT-токен |
| GET | `/auth/me` | JWT | Текущий пользователь |

#### Пользователи (только admin)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/users/` | Список пользователей |
| POST | `/users/` | Создать пользователя |
| DELETE | `/users/{id}` | Удалить пользователя |
| PUT | `/users/{id}/role` | Изменить роль |
| GET | `/users/{id}/agents` | Агенты пользователя |
| PUT | `/users/{id}/agents` | Назначить агенты |

#### Логи

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/ingest` | X-Api-Key | Приём событий от агента |
| GET | `/search` | JWT | Поиск по логам |
| GET | `/search/pdql` | JWT | Поиск через PDQL |
| WS | `/logs/live` | JWT (query param) | Логи в реальном времени |

**Параметры /search:**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|-------------|----------|
| q | string | "" | Полнотекстовый поиск |
| level | string | "" | Уровни через запятую |
| agent_id | string | "" | Фильтр по агенту |
| service | string | "" | Фильтр по сервису |
| host | string | "" | Фильтр по хосту |
| from | ISO datetime | "" | Начало периода |
| to | ISO datetime | "" | Конец периода |
| page | int | 1 | Страница |
| size | int | 50 (макс. 500) | Размер страницы |

#### Статистика

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/stats` | Агрегированная статистика |
| GET | `/agents` | Список агентов |
| GET | `/hosts` | Список хостов |
| GET | `/metrics/latest` | Последние метрики |

#### Корреляция

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/correlation/rules` | Список правил |
| POST | `/correlation/rules` | Создать правило (admin) |
| PUT | `/correlation/rules/{id}` | Обновить правило (admin) |
| DELETE | `/correlation/rules/{id}` | Удалить правило (admin) |
| GET | `/correlation/alerts` | Список алертов |
| PATCH | `/correlation/alerts/{id}` | Обновить статус алерта |

#### Активы

| Метод | Путь | Описание |
|-------|------|----------|
| GET/POST | `/assets` | Список / создание хостов |
| GET/PUT/DELETE | `/assets/{id}` | Детали / изменение / удаление |
| POST | `/assets/discover` | Авто-обнаружение из логов |
| GET/POST | `/accounts` | Список / создание учётных записей |
| GET/PUT/DELETE | `/accounts/{id}` | Детали / изменение / удаление |
| POST | `/accounts/discover` | Авто-обнаружение из логов |
| GET/POST | `/exclusions` | Список / создание исключений |
| GET/PUT/DELETE | `/exclusions/{id}` | Детали / изменение / удаление |

#### Система

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/health` | — | Статус сервера |
| GET | `/health/detailed` | JWT | Детальные метрики |
| GET | `/integrations` | JWT | Список интеграций |
| GET | `/ml/status` | JWT | Статус ML-подсистемы |
| POST | `/ml/anomaly` | JWT | Детекция аномалий |
| GET | `/ml/ueba/{user}` | JWT | Анализ пользователя |

---

## 10. Схема базы данных

```sql
-- Типы сервисов
services (id, name)

-- Основная таблица событий
logs (
  id          BIGSERIAL PRIMARY KEY,
  event_id    VARCHAR(64) UNIQUE,
  timestamp   TIMESTAMPTZ,
  host        VARCHAR(255),
  agent_id    VARCHAR(128),
  source      VARCHAR(512),
  level       VARCHAR(16),        -- CRITICAL/ERROR/WARNING/INFO/DEBUG
  message     TEXT,
  service_id  INTEGER → services,
  meta        JSONB               -- Обогащённые поля: category, src.ip, ...
)

-- Пользователи UI
users (id, username, password_hash, role, created_at)
user_agents (user_id, agent_id)  -- RBAC: operator видит только назначенных агентов

-- Правила корреляции
correlation_rules (id, name, description, severity, enabled, conditions JSONB, hit_count)

-- Алерты корреляции
correlation_alerts (id, created_at, rule_id, rule_name, severity,
                    status, source_ip, description, event_ids JSONB, notes)

-- Активы
assets (id, hostname, ip, os, department, owner, criticality, tags JSONB,
        status, first_seen, last_seen)

-- Учётные записи
known_accounts (id, username, domain, display_name, email,
                risk_level, is_privileged, is_service_account)

-- Исключения
exclusions (id, name, exclusion_type, conditions JSONB,
            enabled, scope, expires_at)
```

**Индексы:**

```sql
-- Основные индексы для поиска
idx_logs_timestamp      ON logs(timestamp DESC)
idx_logs_level          ON logs(level)
idx_logs_agent_id       ON logs(agent_id)
idx_logs_host           ON logs(host)
idx_logs_message_fts    ON logs USING gin(to_tsvector('english', message))
idx_logs_meta           ON logs USING gin(meta)
idx_logs_category       ON logs USING gin((meta->'category'))
```

---

## 11. Устранение неполадок

### Контейнеры не запускаются

```bash
# Посмотреть логи
docker compose logs

# Проверить порты
netstat -tulnp | grep -E "80|443|5432"

# Если порт 80 занят (например, nginx)
sudo systemctl stop nginx
```

### Агент не подключается

```bash
# Проверить доступность сервера с хоста агента
curl -k https://siem.company.ru/api/health

# Проверить правильность API-ключа
curl -k -X POST https://siem.company.ru/api/ingest \
  -H "X-Api-Key: changeme-agent-key" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"test","api_key":"changeme-agent-key","logs":[]}'
# Ожидается: {"ok":true,"indexed":0,"errors":0}

# Проверить firewall
sudo ufw status
sudo firewall-cmd --list-all   # CentOS/RHEL
```

### Ошибки авторизации (401)

```bash
# Получить новый токен
curl -sk -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

### Сбросить пароль admin

```bash
# Остановить сервер
docker compose stop server

# Подключиться к PostgreSQL
docker compose exec postgres psql -U logvault -d logvault

# В psql — сбросить пароль (bcrypt-хэш для "admin")
UPDATE users SET password = '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW'
WHERE username = 'admin';
\q

# Запустить сервер
docker compose start server
```

### Очистить все данные и начать заново

```bash
docker compose down -v
docker compose up -d --build
```

### Проверить статус системы

```bash
# Health
curl -sk https://localhost/api/health

# Детальные метрики (требует токен)
TOKEN=$(curl -sk -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | python3 -m json.tool | grep token | cut -d'"' -f4)

curl -sk https://localhost/api/health/detailed \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Swagger UI

Интерактивная документация всех API-эндпоинтов доступна по адресу:

```
https://localhost/api/docs
```
