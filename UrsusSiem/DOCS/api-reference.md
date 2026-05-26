# API-справочник URSUS SIEM

Базовый URL: `http://<host>:8000`

Swagger UI: `http://<host>:8000/docs`

---

## Аутентификация

### JWT-токен (для UI и операторов)

```http
POST /auth/login
Content-Type: application/json

{"username": "admin", "password": "admin"}
```

**Ответ:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "role": "admin"
}
```

Используйте токен в заголовке:
```http
Authorization: Bearer <access_token>
```

### API-ключ (для агентов)

```http
X-Api-Key: ursus-ваш_ключ
```

---

## Эндпоинты

### /auth — Авторизация

| Метод | Путь | Описание |
|-------|------|---------|
| POST | `/auth/login` | Получить JWT-токен |
| GET | `/auth/me` | Текущий пользователь |

**GET /auth/me** (требует токен):
```json
{
  "username": "admin",
  "role": "admin",
  "user_id": 1,
  "agents": null
}
```

---

### /ingest — Приём логов

Требует заголовок `X-Api-Key`.

```http
POST /ingest
X-Api-Key: ursus-ваш_ключ
Content-Type: application/json

{
  "logs": [
    {
      "timestamp": "2025-01-15T12:34:56Z",
      "host": "server01",
      "level": "ERROR",
      "message": "Failed password for root from 192.168.1.100 port 22",
      "source": "sshd",
      "agent_id": "agent-linux-01",
      "meta": {
        "src.ip": "192.168.1.100",
        "event_src.host": "server01"
      }
    }
  ]
}
```

**Ответ:**
```json
{"saved": 1, "total": 1}
```

**Поля события:**

| Поле | Тип | Обязательно | Описание |
|------|-----|------------|---------|
| `timestamp` | ISO 8601 string | Да | Время события |
| `message` | string | Да | Текст сообщения |
| `host` | string | Нет | Имя хоста-источника |
| `level` | string | Нет | INFO/WARNING/ERROR/CRITICAL |
| `source` | string | Нет | Сервис (sshd, nginx…) |
| `agent_id` | string | Нет | Идентификатор агента |
| `meta` | object | Нет | Произвольные поля JSONB |

---

### /search — Поиск событий

Требует JWT-токен.

#### Полнотекстовый поиск

```http
GET /search?q=failed+password&level=ERROR&from=2025-01-01T00:00:00Z&to=2025-01-02T00:00:00Z&page=1&size=100
Authorization: Bearer <token>
```

**Параметры:**

| Параметр | Тип | Описание |
|----------|-----|---------|
| `q` | string | Поисковый запрос (FTS) |
| `level` | string | Фильтр по уровню |
| `host` | string | Фильтр по хосту |
| `agent_id` | string | Фильтр по агенту |
| `from` | ISO 8601 | Начало периода |
| `to` | ISO 8601 | Конец периода |
| `page` | int | Страница (от 1) |
| `size` | int | Размер страницы (макс. 5000) |

**Ответ:**
```json
{
  "logs": [
    {
      "event_id": 12345,
      "timestamp": "2025-01-15T12:34:56Z",
      "host": "server01",
      "agent_id": "agent-linux-01",
      "level": "ERROR",
      "message": "Failed password for root from 192.168.1.100 port 22",
      "source": "sshd",
      "meta": {
        "src.ip": "192.168.1.100",
        "event_type": "auth_failure",
        "category": {"generic": "Access", "high": "Authentication", "low": "Remote"},
        "subject.process.id": "1234"
      }
    }
  ],
  "total": 1,
  "page": 1,
  "size": 100
}
```

#### PDQL-поиск

```http
GET /search/pdql?q=filter(level+!%3D+"INFO")+|+sort(time+desc)&page=1&size=100&from=...&to=...
Authorization: Bearer <token>
```

Полный синтаксис PDQL — см. [pdql.md](pdql.md).

#### Перепарсинг метаданных

```http
POST /search/reparse-meta?batch=500
Authorization: Bearer <token>
```

Заново применяет парсер ко всем событиям (полезно после обновления parser.py).

---

### /stats — Статистика

```http
GET /stats?interval=1h&from=2025-01-15T00:00:00Z&to=2025-01-15T23:59:59Z
Authorization: Bearer <token>
```

**Ответ:**
```json
{
  "buckets": [
    {"time": "2025-01-15T10:00:00Z", "count": 145, "errors": 12},
    {"time": "2025-01-15T11:00:00Z", "count": 230, "errors": 5}
  ],
  "total": 1450,
  "top_hosts": [{"host": "server01", "count": 800}],
  "top_levels": [{"level": "INFO", "count": 1200}]
}
```

---

### /correlation — Правила и алерты корреляции

#### Правила

```http
GET /correlation/rules                   # Список правил
POST /correlation/rules                  # Создать правило
PUT /correlation/rules/{id}              # Обновить правило
DELETE /correlation/rules/{id}           # Удалить правило
```

**Тело запроса (POST/PUT):**
```json
{
  "name": "Множество неудачных входов",
  "severity": "HIGH",
  "enabled": true,
  "conditions": {
    "type": "threshold",
    "field": "message",
    "pattern": "Failed password",
    "threshold": 5,
    "window_seconds": 300,
    "group_by": "src.ip"
  },
  "sigma_rule": "title: Brute Force SSH\nstatus: stable\n..."
}
```

#### Алерты корреляции

```http
GET /correlation/alerts?status=OPEN&page=1&size=50
PATCH /correlation/alerts/{id}   # Обновить статус (OPEN → CLOSED)
```

---

### /alerts — Пороговые алерты

```http
GET /alerts                  # Список правил алертов
POST /alerts                 # Создать правило
DELETE /alerts/{id}          # Удалить правило
PUT /alerts                  # Обновить правило
```

**Тело запроса:**
```json
{
  "name": "Критические события",
  "condition": "level = 'CRITICAL'",
  "threshold": 1,
  "window_minutes": 5,
  "severity": "CRITICAL",
  "notify_webhook": true,
  "notify_telegram": true
}
```

---

### /agents — Агенты и хосты

```http
GET /agents        # Список агентов с метриками
GET /hosts         # Список обнаруженных хостов
```

**Ответ /agents:**
```json
[
  {
    "agent_id": "agent-linux-01",
    "host": "server01",
    "last_seen": "2025-01-15T12:34:56Z",
    "status": "online",
    "events_last_hour": 1250,
    "cpu_percent": 12.5,
    "mem_percent": 45.2
  }
]
```

---

### /assets — Инвентарь активов

```http
GET /assets                    # Список хостов
POST /assets                   # Добавить хост
PUT /assets/{id}               # Обновить хост
DELETE /assets/{id}            # Удалить хост

GET /accounts                  # Список учётных записей
POST /accounts                 # Добавить учётную запись

GET /exclusions                # Правила подавления
POST /exclusions               # Добавить правило подавления
DELETE /exclusions/{id}        # Удалить правило
```

---

### /admin/api-keys — Управление API-ключами

Требует роль `admin`.

```http
GET /admin/api-keys            # Список ключей
POST /admin/api-keys           # Создать ключ
DELETE /admin/api-keys/{id}    # Удалить ключ
PATCH /admin/api-keys/{id}     # Включить/выключить ключ
```

**POST /admin/api-keys:**
```json
{"name": "Агент сервер-01"}
```

**Ответ** (ключ показывается только один раз):
```json
{
  "id": 3,
  "name": "Агент сервер-01",
  "key": "ursus-a8f3c2d1e4b5f6a7...",
  "created_at": "2025-01-15T12:00:00Z"
}
```

---

### /metrics — Метрики агентов

```http
GET /metrics/latest
Authorization: Bearer <token>
```

**Ответ:**
```json
[
  {
    "agent_id": "agent-linux-01",
    "host": "server01",
    "cpu_percent": 12.5,
    "mem_percent": 45.2,
    "disk_percent": 68.0,
    "events_total": 45230,
    "uptime_seconds": 86400,
    "last_seen": "2025-01-15T12:34:56Z"
  }
]
```

---

### /logs/live — WebSocket стриминг

```
WS /logs/live?token=<JWT>
```

После подключения сервер стримит новые события в реальном времени в формате JSON:

```json
{
  "event_id": 99999,
  "timestamp": "2025-01-15T12:34:56.789Z",
  "host": "server01",
  "level": "ERROR",
  "message": "Failed password for root",
  "agent_id": "agent-linux-01"
}
```

Операторы видят только события от своих агентов.

---

### /health — Состояние системы

```http
GET /health          # Быстрая проверка
GET /health/detailed # Детальные метрики
```

**GET /health:**
```json
{"status": "ok", "timestamp": "2025-01-15T12:34:56Z"}
```

**GET /health/detailed:**
```json
{
  "status": "ok",
  "db": "ok",
  "cpu_percent": 15.3,
  "mem_percent": 52.1,
  "disk_percent": 45.0,
  "events_last_hour": 1250,
  "uptime_seconds": 86400
}
```

---

## Коды ошибок

| Код | Описание |
|-----|---------|
| 400 | Неверный запрос (отсутствуют обязательные поля) |
| 401 | Нет токена или токен устарел |
| 403 | Недостаточно прав (роль не подходит) |
| 404 | Ресурс не найден |
| 422 | Ошибка валидации тела запроса |
| 500 | Внутренняя ошибка сервера |

---

## Примеры запросов (curl)

```bash
# Получить токен
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r .access_token)

# Отправить событие (агент)
curl -X POST http://localhost:8000/ingest \
  -H "X-Api-Key: ursus-mykey" \
  -H "Content-Type: application/json" \
  -d '{"logs":[{"timestamp":"2025-01-15T12:00:00Z","host":"srv01","level":"ERROR","message":"test error","agent_id":"a1"}]}'

# PDQL-поиск
curl "http://localhost:8000/search/pdql?q=filter(level!%3D%22INFO%22)%7Csort(time+desc)&size=50" \
  -H "Authorization: Bearer $TOKEN"

# Создать API-ключ
curl -X POST http://localhost:8000/admin/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"prod-server-01"}'
```
