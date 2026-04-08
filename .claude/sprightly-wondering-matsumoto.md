# План: Интеграция Ursus SIEM + PDQL в LogVault

## Контекст

В репозитории два проекта: **корневой Ursus Insight SIEM** (Flask, SQLite, Jinja2) и **Хак/Test1111 LogVault** (FastAPI, PostgreSQL, React). Задача:
1. Перенести парсер + корреляцию из Ursus в LogVault
2. Отвязать домен `kronos-nexus.online`, очистить секреты
3. Добавить поддержку языка запросов **PDQL** (как в MaxPatrol SIEM) для фильтрации событий
4. Добавить трёхуровневую категоризацию событий (generic/high/low)
5. Удалить корневые папки, создать единый проект **URSUS SIEM**

---

## Фаза 0: Ветка и очистка

### 0.1 Создать ветку
```bash
git checkout -b feature/integrate-ursus
```

### 0.2 Убрать домен `kronos-nexus.online`

| Файл | Было | Стало |
|------|------|-------|
| `Хак/Test1111/.env` стр.4 | `DOMAIN=kronos-nexus.online` | `DOMAIN=localhost` |
| `Хак/Test1111/.env` стр.10 | `CORS_ORIGINS=https://kronos-nexus.online` | `CORS_ORIGINS=*` |
| `Хак/Test1111/.env` стр.44 | `SERVER_URL=https://kronos-nexus.online/api` | `SERVER_URL=http://localhost:8000` |
| `Хак/Test1111/Caddyfile` стр.1 | `{$DOMAIN:kronos-nexus.online}` | `{$DOMAIN:localhost}` |
| `Хак/Test1111/docker-compose.yml` стр.15 | `DOMAIN=${DOMAIN:-kronos-nexus.online}` | `DOMAIN=${DOMAIN:-localhost}` |
| `Хак/Test1111/agent/config.yaml` стр.1 | `server_url: "https://kronos-nexus.online/api"` | `server_url: "http://localhost:8000"` |

### 0.3 Очистить секреты в `.env`
- Стр.36: `ALERT_TELEGRAM_TOKEN=7324265100:AAG...` -> `ALERT_TELEGRAM_TOKEN=`
- Стр.39: `ALERT_TELEGRAM_CHAT_ID=1008269659` -> `ALERT_TELEGRAM_CHAT_ID=`

---

## Фаза 1: Расширенный парсер + категоризация событий

### 1.1 Парсер логов
**Источник:** `core/parser.py` (~240 строк)
**Новый файл:** `Хак/Test1111/server/src/services/parser.py`

Портировать:
- Все regex-паттерны: `_RFC5424`, `_RFC3164`, `_SYSLOG_PLAIN`, `_NGINX_ACCESS`, `_WIN_EVENT`, `_CEF`, `_IP_RE`
- Функции: `parse_syslog_priority()`, `detect_severity()`, `detect_event_type()`, `extract_ips()`
- Маппинг severity: Ursus HIGH -> ERROR, MEDIUM -> WARNING, LOW -> INFO

### 1.2 Трёхуровневая категоризация событий
**В том же файле:** `Хак/Test1111/server/src/services/parser.py`

Добавить словарь категорий по стандарту MaxPatrol SIEM (3 уровня):

```python
# Структура: {generic: {high: [low1, low2, ...]}}
EVENT_CATEGORIES = {
    "Access": {
        "Authentication": ["Default Credentials", "Host", "Local", "Remote", "Service", "Unknown Type"],
        "Authorization": ["Host", "Network", "Object", "User"],
        "Accounting": ["Network Accounting", "Address Translation", "Connections & Sessions", ...],
    },
    "Attacks & Recon": {
        "Attack": ["Bruteforce", "Complex Attack", "DDoS", "DoS", "HIPS Alert", ...],
        "Recon": ["Crawling/Dictionary Bruteforce", "Enumeration", "Fingerprinting", ...],
    },
    "Malware": {
        "Backdoor": ["Curing", "Detection", "Epidemic", "Mitigation"],
        "Bootkit": [], "Botnet": [], "Rootkit": [], "Trojan": [], "Virus": [], "Worm": [],
    },
    # ... полный словарь из документации PDQL
}
```

Функция `detect_category(message: str) -> dict`:
- Анализирует текст сообщения regex-паттернами
- Возвращает `{"generic": "...", "high": "...", "low": "..."}`
- Маппинг: "ssh|login|auth" -> Access/Authentication, "malware|virus|trojan" -> Malware, "scan|recon|nmap" -> Attacks & Recon/Recon, и т.д.

### 1.3 Интеграция в pipeline
**Файл:** `Хак/Test1111/server/src/services/pipeline.py`

```python
from server.src.services.parser import parse_and_enrich

@staticmethod
def enrich(event: LogEvent, agent_id: str) -> dict[str, Any]:
    doc = event.model_dump()
    if not doc.get("agent_id"):
        doc["agent_id"] = agent_id
    doc["level"] = (doc.get("level") or "INFO").upper()
    # NEW: парсер + категоризация
    enrichment = parse_and_enrich(doc["message"], doc.get("meta", {}))
    doc["meta"] = {**doc.get("meta", {}), **enrichment}
    if enrichment.get("detected_level"):
        doc["level"] = enrichment["detected_level"]
    return doc
```

Результат обогащения в `meta`:
```json
{
  "category": {"generic": "Access", "high": "Authentication", "low": "Remote"},
  "event_type": "auth_failure",
  "source_ips": ["192.168.1.100"],
  "detected_level": "ERROR"
}
```

### 1.4 Индекс для категорий
**Файл:** `Хак/Test1111/server/init.sql`

```sql
CREATE INDEX IF NOT EXISTS idx_logs_category ON logs USING gin ((meta->'category'));
```

---

## Фаза 2: Поддержка языка PDQL

### 2.1 PDQL-парсер (серверная часть)
**Новый файл:** `Хак/Test1111/server/src/services/pdql.py`

Реализовать парсер/транслятор PDQL -> SQL (PostgreSQL).

**Поддерживаемый синтаксис:**

1. **Pipe-синтаксис (текстовый):**
   ```
   filter(level = "ERROR" and host contains "prod") | select(time, host, message) | sort(time desc) | limit(100)
   ```

2. **Операторы сравнения:**
   - `=`, `!=`, `>`, `<`, `>=`, `<=`
   - `IN [val1, val2, ...]`
   - `MATCH "regex_pattern"` — трансляция в PostgreSQL `~*`
   - `STARTSWITH value` -> SQL `LIKE 'value%'`
   - `ENDSWITH value` -> SQL `LIKE '%value'`
   - `CONTAINS value` -> SQL `ILIKE '%value%'`

3. **Логические операторы:** `AND`, `OR`, `NOT` (регистронезависимые)

4. **Функции:**
   - `match(field, "pattern")` -> PostgreSQL `field ~* 'pattern'`
   - `in_subnet(field, "cidr")` -> PostgreSQL `field::inet <<= 'cidr'::inet`
   - `in_list([values], field)` -> PostgreSQL `field = ANY(ARRAY[values])`

5. **Команды pipeline:**
   - `filter(...)` -> WHERE clause
   - `select(field1, field2)` -> определяет колонки результата
   - `sort(field asc/desc)` -> ORDER BY
   - `limit(N)` -> LIMIT
   - `group(field)` -> GROUP BY (с агрегацией)

**Полный маппинг полей PDQL -> SQL (таблица logs + meta JSONB):**

Поля первого уровня (прямые колонки таблицы `logs`):

| PDQL поле | SQL поле | Тип |
|-----------|----------|-----|
| `time` | `l.timestamp` | TIMESTAMPTZ |
| `text` / `message` | `l.message` | TEXT |
| `level` | `l.level` | VARCHAR |
| `agent_id` | `l.agent_id` | VARCHAR |
| `source` | `l.source` | VARCHAR |
| `service` | `s.name` (JOIN) | VARCHAR |

Все остальные поля хранятся в `l.meta` (JSONB) с вложенной структурой. Доступ через `->` и `->>`:

**Источник (src):**

| PDQL поле | SQL выражение |
|-----------|---------------|
| `src.host` | `l.meta->>'src_host'` |
| `src.ip` | `l.meta->>'src_ip'` |
| `assigned_src_ip` | `l.meta->>'assigned_src_ip'` |
| `src.port` | `(l.meta->>'src_port')::int` |
| `src.geo.country` | `l.meta->'src_geo'->>'country'` |
| `src.geo.org` | `l.meta->'src_geo'->>'org'` |

**Назначение (dst):**

| PDQL поле | SQL выражение |
|-----------|---------------|
| `dst.hostname` | `l.meta->>'dst_hostname'` |
| `dst.host` | `l.meta->>'dst_host'` |
| `dst.ip` | `l.meta->>'dst_ip'` |
| `dst.port` | `(l.meta->>'dst_port')::int` |
| `dst.geo.org` | `l.meta->'dst_geo'->>'org'` |

**Событие:**

| PDQL поле | SQL выражение |
|-----------|---------------|
| `msgid` | `l.meta->>'msgid'` |
| `protocol` | `l.meta->>'protocol'` |
| `reason` | `l.meta->>'reason'` |
| `action` | `l.meta->>'action'` |
| `status` | `l.meta->>'status'` |
| `duration` | `(l.meta->>'duration')::numeric` |

**Субъект (subject):**

| PDQL поле | SQL выражение |
|-----------|---------------|
| `subject` | `l.meta->>'subject'` |
| `subject.domain` | `l.meta->'subject'->>'domain'` |
| `subject.name` | `l.meta->'subject'->>'name'` |
| `subject.group` | `l.meta->'subject'->>'group'` |
| `subject.type` | `l.meta->'subject'->>'type'` |
| `subject.version` | `l.meta->'subject'->>'version'` |
| `subject.account.contact` | `l.meta->'subject'->'account'->>'contact'` |
| `subject.account.domain` | `l.meta->'subject'->'account'->>'domain'` |
| `subject.account.name` | `l.meta->'subject'->'account'->>'name'` |
| `subject.process.meta` | `l.meta->'subject'->'process'->>'meta'` |
| `subject.process.cmdline` | `l.meta->'subject'->'process'->>'cmdline'` |
| `subject.process.fullpath` | `l.meta->'subject'->'process'->>'fullpath'` |

**Объект (object):**

| PDQL поле | SQL выражение |
|-----------|---------------|
| `object` | `l.meta->>'object'` |
| `object.id` | `l.meta->'object'->>'id'` |
| `object.domain` | `l.meta->'object'->>'domain'` |
| `object.name` | `l.meta->'object'->>'name'` |
| `object.account.contact` | `l.meta->'object'->'account'->>'contact'` |
| `object.account.domain` | `l.meta->'object'->'account'->>'domain'` |
| `object.account.name` | `l.meta->'object'->'account'->>'name'` |
| `object.group` | `l.meta->'object'->>'group'` |
| `object.type` | `l.meta->'object'->>'type'` |
| `object.state` | `l.meta->'object'->>'state'` |
| `object.property` | `l.meta->'object'->>'property'` |
| `object.path` | `l.meta->'object'->>'path'` |
| `object.fullpath` | `l.meta->'object'->>'fullpath'` |
| `object.application.name` | `l.meta->'object'->'application'->>'name'` |
| `object.process.name` | `l.meta->'object'->'process'->>'name'` |
| `object.process.fullpath` | `l.meta->'object'->'process'->>'fullpath'` |
| `object.process.cmdline` | `l.meta->'object'->'process'->>'cmdline'` |
| `object.process.parent.fullpath` | `l.meta->'object'->'process'->'parent'->>'fullpath'` |
| `object.hash` | `l.meta->'object'->>'hash'` |
| `object.hash.md5` | `l.meta->'object'->'hash'->>'md5'` |
| `object.hash.sha1` | `l.meta->'object'->'hash'->>'sha1'` |
| `object.hash.sha256` | `l.meta->'object'->'hash'->>'sha256'` |
| `object.process.hash` | `l.meta->'object'->'process'->>'hash'` |
| `object.process.hash.md5` | `l.meta->'object'->'process'->'hash'->>'md5'` |
| `object.process.hash.sha1` | `l.meta->'object'->'process'->'hash'->>'sha1'` |
| `object.process.hash.sha256` | `l.meta->'object'->'process'->'hash'->>'sha256'` |
| `object.value` | `l.meta->'object'->>'value'` |
| `object.new_value` | `l.meta->'object'->>'new_value'` |
| `object.storage.name` | `l.meta->'object'->'storage'->>'name'` |
| `object.storage.path` | `l.meta->'object'->'storage'->>'path'` |
| `object.storage.fullpath` | `l.meta->'object'->'storage'->>'fullpath'` |
| `object.vendor` | `l.meta->'object'->>'vendor'` |
| `object.version` | `l.meta->'object'->>'version'` |

**Счётчики (count):**

| PDQL поле | SQL выражение |
|-----------|---------------|
| `count` | `(l.meta->>'count')::int` |
| `count.bytes` | `(l.meta->'count'->>'bytes')::bigint` |
| `count.bytes_in` | `(l.meta->'count'->>'bytes_in')::bigint` |
| `count.bytes_out` | `(l.meta->'count'->>'bytes_out')::bigint` |

**Произвольные поля (datafield):**

| PDQL поле | SQL выражение |
|-----------|---------------|
| `datafield1`..`datafield9` | `l.meta->>'datafield1'`..`l.meta->>'datafield9'` |

**Источник события (event_src):**

| PDQL поле | SQL выражение |
|-----------|---------------|
| `event_src.host` | `l.host` (прямая колонка) |
| `event_src.ip` | `l.meta->>'event_src_ip'` |
| `event_src.category` | `l.meta->>'event_src_category'` |
| `event_src.vendor` | `l.meta->>'event_src_vendor'` |
| `event_src.title` | `l.meta->>'event_src_title'` |
| `event_src.subsys` | `l.meta->>'event_src_subsys'` |

**Категории:**

| PDQL поле | SQL выражение |
|-----------|---------------|
| `category.generic` | `l.meta->'category'->>'generic'` |
| `category.high` | `l.meta->'category'->>'high'` |
| `category.low` | `l.meta->'category'->>'low'` |

**Реализация динамического маппинга:**

Транслятор PDQL->SQL будет автоматически строить SQL-выражение для любого поля с точечной нотацией. Алгоритм:
1. Если поле в `DIRECT_FIELDS` (time, message, level, agent_id, source, event_src.host) -> прямая колонка
2. Если поле числовое (port, count, duration, bytes) -> `(l.meta->'path'->>'leaf')::int/numeric/bigint`
3. Иначе -> разбить по `.`, промежуточные уровни через `->`, последний через `->>`

```python
def field_to_sql(self, field: str) -> str:
    if field in self.DIRECT_FIELDS:
        return self.DIRECT_FIELDS[field]
    parts = field.split(".")
    if len(parts) == 1:
        return f"l.meta->>'{parts[0]}'"
    path = "l.meta"
    for p in parts[:-1]:
        path += f"->'{p}'"
    path += f"->>'{parts[-1]}'"
    if field in self.NUMERIC_FIELDS:
        return f"({path})::{self.NUMERIC_FIELDS[field]}"
    return path
```

**Архитектура парсера:**

```python
class PDQLParser:
    """Парсит PDQL-запрос в структуру для генерации SQL."""

    def parse(self, query: str) -> PDQLQuery:
        """
        Вход: 'filter(level = "ERROR") | select(time, host) | sort(time desc) | limit(100)'
        Выход: PDQLQuery(filter=FilterNode, select=[...], sort=[...], limit=100)
        """

    def _tokenize(self, text: str) -> list[Token]:
        """Лексический анализ: разбивает на токены."""

    def _parse_filter(self, tokens: list[Token]) -> FilterNode:
        """Парсит выражение фильтра в AST."""

    def _parse_predicate(self, tokens: list[Token]) -> Predicate:
        """Парсит предикат: field operator value."""


class PDQLToSQL:
    """Транслирует PDQLQuery в SQL-запрос для PostgreSQL."""

    FIELD_MAP = {
        "time": "l.timestamp",
        "event_src.host": "l.host",
        "text": "l.message",
        "message": "l.message",
        "level": "l.level",
        "src.ip": "l.meta->>'source_ips'",
        # ...
    }

    def translate(self, query: PDQLQuery) -> tuple[str, list]:
        """Возвращает (sql_string, params)."""
```

### 2.2 API эндпоинт для PDQL
**Файл:** `Хак/Test1111/server/src/routers/search.py`

Добавить новый эндпоинт:

```python
@router.get("/search/pdql")
async def pdql_search(
    request: Request,
    query: str = Query("", description="PDQL query string"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    user: dict = Depends(verify_token),
):
    db = request.app.state.db_service
    allowed = get_allowed_agents(user, db)
    parser = PDQLParser()
    translator = PDQLToSQL()

    parsed = parser.parse(query)
    sql, params = translator.translate(parsed, allowed_agents=allowed)
    return db.execute_pdql(sql, params, page, size)
```

### 2.3 Метод execute_pdql в PGService
**Файл:** `Хак/Test1111/server/src/services/postgres.py`

```python
def execute_pdql(self, sql: str, params: list, page: int, size: int) -> dict:
    """Выполняет транслированный PDQL-запрос с пагинацией."""
```

### 2.4 UI: Поле PDQL-фильтра
**Файл:** `Хак/Test1111/ui/src/pages/Search.tsx`

Переработать страницу поиска:
- Добавить переключатель режимов: "Простой фильтр" / "PDQL"
- В режиме PDQL: текстовое поле с подсветкой синтаксиса и автодополнением
- Примеры запросов под полем ввода
- Сохранить обратную совместимость с простым поиском

**Новый компонент:** `Хак/Test1111/ui/src/components/PDQLInput.tsx`
- Текстовое поле с моноширинным шрифтом
- Подсветка ключевых слов (filter, select, sort, limit, and, or, not)
- Выпадающий список автодополнения полей при вводе
- Выпадающий список примеров запросов
- Валидация синтаксиса (подчёркивание ошибок)

### 2.5 API клиент
**Файл:** `Хак/Test1111/ui/src/api/client.ts`

```typescript
pdqlSearch(query: string, page?: number, size?: number): Promise<SearchResult>
```

---

## Фаза 3: Корреляционный движок

### 3.1 Новые таблицы
**Файл:** `Хак/Test1111/server/init.sql`

```sql
CREATE TABLE IF NOT EXISTS correlation_rules (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(20) DEFAULT 'MEDIUM',
    enabled BOOLEAN DEFAULT TRUE,
    conditions JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    hit_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS correlation_alerts (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    rule_id VARCHAR(64),
    rule_name VARCHAR(255),
    severity VARCHAR(20),
    status VARCHAR(20) DEFAULT 'OPEN',
    source_ip VARCHAR(45),
    description TEXT,
    event_ids JSONB,
    notes TEXT
);
```

### 3.2 Методы в PGService
**Файл:** `Хак/Test1111/server/src/services/postgres.py`

Добавить:
- `get_correlation_rules(enabled_only=False)`
- `upsert_correlation_rule(rule)`
- `delete_correlation_rule(rule_id)`
- `insert_correlation_alert(...)`
- `get_correlation_alerts(limit, offset, status, severity)`
- `update_correlation_alert_status(alert_id, status, notes)`
- `increment_correlation_rule_hits(rule_id)`
- `get_recent_logs_for_correlation(since_seconds, limit)`
- `seed_default_correlation_rules()` — 8 предустановленных правил

### 3.3 Движок корреляции
**Новый файл:** `Хак/Test1111/server/src/services/correlator.py`

Портировать из `core/correlator.py`:
- 4 типа правил: `threshold` (с group_by), `pattern`, `keyword`, `port_scan`
- Cooldown (5 мин между одинаковыми алертами)
- Функция `correlation_loop(db, interval=10.0)` по аналогии с `alert_loop`

### 3.4 REST API
**Новый файл:** `Хак/Test1111/server/src/routers/correlation.py`

- `GET /correlation/rules` — список правил
- `POST /correlation/rules` — создание (admin)
- `PUT /correlation/rules/{id}` — обновление (admin)
- `DELETE /correlation/rules/{id}` — удаление (admin)
- `GET /correlation/alerts` — список алертов
- `PATCH /correlation/alerts/{id}` — обновить статус

### 3.5 Регистрация в main.py
**Файл:** `Хак/Test1111/server/src/main.py`

- `app.include_router(correlation.router)`
- В `lifespan`: `db_service.seed_default_correlation_rules()`
- Запуск потока: `threading.Thread(target=correlation_loop, args=(db_service,), daemon=True)`

---

## Фаза 4: UI для корреляции

### 4.1 API клиент
**Файл:** `Хак/Test1111/ui/src/api/client.ts`

Интерфейсы `CorrelationRule`, `CorrelationAlert` + методы.

### 4.2 Страницы
- **Новый:** `Хак/Test1111/ui/src/pages/CorrelationRules.tsx` — таблица правил, CRUD
- **Новый:** `Хак/Test1111/ui/src/pages/CorrelationAlerts.tsx` — таблица алертов, управление статусом

### 4.3 Роутинг
**Файл:** `Хак/Test1111/ui/src/App.tsx`

Маршруты `/correlation/rules`, `/correlation/alerts` + навигация.

---

## Фаза 5: Агрегация событий

### 5.1 Backend: агрегация в PDQL
**Файл:** `Хак/Test1111/server/src/services/pdql.py`

Расширить PDQL-парсер поддержкой `group()` + агрегатных функций:

```
filter(level = "ERROR") | group(event_src.host) | aggregate(count(), min(time), max(time)) | sort(count desc) | limit(20)
```

**Поддерживаемые функции агрегации:**
- `count()` — количество событий
- `count_distinct(field)` — количество уникальных значений
- `sum(field)` — сумма (для числовых полей: count.bytes, duration и т.д.)
- `avg(field)` — среднее
- `min(field)` / `max(field)` — минимум/максимум
- `first(field)` / `last(field)` — первое/последнее значение

**Трансляция в SQL:**
```sql
-- group(src.ip) | aggregate(count(), count_distinct(dst.port))
SELECT l.meta->>'src_ip' AS "src.ip",
       COUNT(*) AS "count",
       COUNT(DISTINCT (l.meta->>'dst_port')::int) AS "count_distinct_dst_port"
FROM logs l LEFT JOIN services s ON l.service_id = s.id
WHERE ...
GROUP BY l.meta->>'src_ip'
```

### 5.2 API эндпоинт
**Файл:** `Хак/Test1111/server/src/routers/search.py`

Эндпоинт `/search/pdql` уже поддерживает агрегацию через PDQL. Формат ответа меняется при наличии group:
```json
{
  "total": 15,
  "columns": ["src.ip", "count", "count_distinct_dst_port"],
  "rows": [
    {"src.ip": "10.0.0.1", "count": 142, "count_distinct_dst_port": 23},
    ...
  ]
}
```

### 5.3 UI: таблица агрегации
**Файл:** `Хак/Test1111/ui/src/pages/Search.tsx`

При наличии `group()` в PDQL-запросе — отображать результат в виде агрегированной таблицы с сортировкой по колонкам вместо обычного списка логов.

---

## Фаза 6: Фундамент ML (заглушки)

### 6.1 ML-сервис
**Новый файл:** `Хак/Test1111/server/src/services/ml_engine.py`

```python
"""
ML Engine - фундамент для подключения машинного обучения.
Все методы - заглушки с TODO для будущей реализации.
"""
import logging
from typing import Any

logger = logging.getLogger("server.ml")


class MLEngine:
    """Интерфейс для ML-моделей анализа событий."""

    def __init__(self):
        self._models: dict[str, Any] = {}
        self._enabled = False
        logger.info("ML Engine initialized (stub mode)")

    # --- Детекция аномалий ---
    def detect_anomaly(self, event: dict) -> dict:
        """
        TODO: Подключить модель детекции аномалий.
        Варианты: Isolation Forest, Autoencoder, LSTM.
        Вход: обогащённое событие (после парсера).
        Выход: {"is_anomaly": bool, "score": float 0-1, "reason": str}
        """
        return {"is_anomaly": False, "score": 0.0, "reason": "ML not configured"}

    def detect_anomaly_batch(self, events: list[dict]) -> list[dict]:
        """Пакетная детекция аномалий."""
        return [self.detect_anomaly(e) for e in events]

    # --- Кластеризация событий ---
    def cluster_events(self, events: list[dict], n_clusters: int = 5) -> list[dict]:
        """
        TODO: Кластеризация событий (K-Means / DBSCAN).
        Группирует похожие события для выявления паттернов.
        Выход: [{"cluster_id": int, "event_ids": [...], "label": str}]
        """
        return []

    # --- Прогнозирование ---
    def predict_next_events(self, history: list[dict], horizon: int = 10) -> list[dict]:
        """
        TODO: Прогнозирование будущих событий (ARIMA / Prophet / LSTM).
        Выход: [{"timestamp": ..., "predicted_level": ..., "confidence": float}]
        """
        return []

    # --- Классификация ---
    def classify_event(self, event: dict) -> dict:
        """
        TODO: Автоматическая классификация событий (Random Forest / BERT).
        Выход: {"category": str, "confidence": float}
        """
        return {"category": "unknown", "confidence": 0.0}

    # --- Поведенческий анализ (UEBA) ---
    def analyze_user_behavior(self, user: str, events: list[dict]) -> dict:
        """
        TODO: User & Entity Behavior Analytics.
        Строит профиль поведения пользователя и выявляет отклонения.
        Выход: {"risk_score": float, "deviations": [...], "baseline": {...}}
        """
        return {"risk_score": 0.0, "deviations": [], "baseline": {}}

    def analyze_host_behavior(self, host: str, events: list[dict]) -> dict:
        """
        TODO: Анализ поведения хоста.
        Выход: {"risk_score": float, "deviations": [...]}
        """
        return {"risk_score": 0.0, "deviations": []}

    # --- Управление моделями ---
    def load_model(self, name: str, path: str) -> bool:
        """TODO: Загрузить обученную модель из файла (pickle/ONNX/joblib)."""
        logger.info("Model '%s' loading not implemented (stub)", name)
        return False

    def train_model(self, name: str, data: list[dict], params: dict | None = None) -> dict:
        """TODO: Обучить/дообучить модель на данных."""
        return {"status": "not_implemented", "message": "ML training not available"}

    def get_model_status(self) -> dict:
        """Статус ML-подсистемы."""
        return {
            "enabled": self._enabled,
            "models_loaded": list(self._models.keys()),
            "status": "stub",
            "message": "ML engine is in stub mode. Configure models to enable."
        }
```

### 6.2 ML API
**Новый файл:** `Хак/Test1111/server/src/routers/ml.py`

```python
# Эндпоинты (все возвращают заглушки):
GET /ml/status          — статус ML-подсистемы
POST /ml/anomaly        — детекция аномалий (тело: {events: [...]})
POST /ml/classify       — классификация события
GET /ml/ueba/{user}     — профиль пользователя
GET /ml/ueba/host/{host} — профиль хоста
```

### 6.3 Интеграция в pipeline (опционально)
**Файл:** `Хак/Test1111/server/src/services/pipeline.py`

В `enrich()`: если ML включён, вызвать `ml_engine.detect_anomaly(doc)` и сохранить результат в `doc["meta"]["ml"]`.

### 6.4 Регистрация
**Файл:** `Хак/Test1111/server/src/main.py`

- `app.state.ml_engine = MLEngine()`
- `app.include_router(ml.router)`

---

## Фаза 7: Табличные списки (Assets)

### 7.1 Таблицы БД
**Файл:** `Хак/Test1111/server/init.sql`

```sql
-- Список хостов (активы)
CREATE TABLE IF NOT EXISTS assets (
    id SERIAL PRIMARY KEY,
    hostname VARCHAR(255) UNIQUE NOT NULL,
    ip VARCHAR(45),
    os VARCHAR(128),
    department VARCHAR(128),
    owner VARCHAR(128),
    criticality VARCHAR(20) DEFAULT 'MEDIUM',  -- LOW, MEDIUM, HIGH, CRITICAL
    tags JSONB DEFAULT '[]',
    notes TEXT,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'active',  -- active, inactive, decommissioned
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Список пользователей (учётные записи из событий)
CREATE TABLE IF NOT EXISTS known_accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    domain VARCHAR(255) DEFAULT '',
    display_name VARCHAR(255),
    email VARCHAR(255),
    department VARCHAR(128),
    role VARCHAR(128),
    risk_level VARCHAR(20) DEFAULT 'NORMAL',  -- NORMAL, ELEVATED, HIGH, CRITICAL
    is_service_account BOOLEAN DEFAULT FALSE,
    is_privileged BOOLEAN DEFAULT FALSE,
    notes TEXT,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, domain)
);

-- Список исключений (suppress/whitelist)
CREATE TABLE IF NOT EXISTS exclusions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    exclusion_type VARCHAR(32) NOT NULL,  -- 'event', 'host', 'user', 'ip', 'rule'
    conditions JSONB NOT NULL,  -- {"field": "src.ip", "operator": "=", "value": "10.0.0.1"}
    enabled BOOLEAN DEFAULT TRUE,
    scope VARCHAR(32) DEFAULT 'all',  -- 'all', 'correlation', 'alerts'
    created_by VARCHAR(64),
    expires_at TIMESTAMPTZ,  -- NULL = бессрочно
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.2 Методы PGService
**Файл:** `Хак/Test1111/server/src/services/postgres.py`

**Assets:**
- `list_assets(page, size, search, status, criticality)` -> пагинация + фильтры
- `get_asset(id)` / `get_asset_by_hostname(hostname)`
- `create_asset(data)` / `update_asset(id, data)` / `delete_asset(id)`
- `auto_discover_assets()` -> `SELECT DISTINCT host FROM logs` + вставка новых

**Known Accounts:**
- `list_accounts(page, size, search, domain, risk_level)`
- `get_account(id)`
- `create_account(data)` / `update_account(id, data)` / `delete_account(id)`
- `auto_discover_accounts()` -> извлечение subject.name из meta

**Exclusions:**
- `list_exclusions(page, size, type, enabled)`
- `get_exclusion(id)`
- `create_exclusion(data)` / `update_exclusion(id, data)` / `delete_exclusion(id)`
- `check_exclusion(event: dict) -> bool` — проверка, подпадает ли событие под исклю��ение

### 7.3 Применение исключений в корреляции
**Файл:** `Хак/Test1111/server/src/services/correlator.py`

Перед firing alert: проверить `check_exclusion()`. Если событие исключено — не создавать алерт.

### 7.4 REST API
**Новый файл:** `Хак/Test1111/server/src/routers/assets.py`

```
GET    /assets                    — список хостов (пагинация, фильтры)
POST   /assets                    — создать хост (admin)
GET    /assets/{id}               — детали хоста
PUT    /assets/{id}               — обновить (admin)
DELETE /assets/{id}               — удалить (admin)
POST   /assets/discover           — авто-обнаружение из логов (admin)

GET    /accounts                  — список учётных записей
POST   /accounts                  — создать запись (admin)
GET    /accounts/{id}             — детали
PUT    /accounts/{id}             — обновить (admin)
DELETE /accounts/{id}             — удалить (admin)
POST   /accounts/discover         — авто-обнаружение из логов (admin)

GET    /exclusions                — список исключений
POST   /exclusions                — создать (admin)
GET    /exclusions/{id}           — детали
PUT    /exclusions/{id}           — обновить (admin)
DELETE /exclusions/{id}           — удалить (admin)
```

### 7.5 UI: страницы табличных списков
**Новые файлы:**
- `Хак/Test1111/ui/src/pages/Assets.tsx` — таблица активов (хосты), поиск, фильтры по статусу/критичности, CRUD
- `Хак/Test1111/ui/src/pages/Accounts.tsx` — таблица учётных записей, фильтры по домену/risk_level, CRUD
- `Хак/Test1111/ui/src/pages/Exclusions.tsx` — таблица исключений, toggle enable, CRUD, форма с условиями (field + operator + value)

---

## Фаза 8: Фундамент Active Directory

### 8.1 AD-коннектор (заглушка)
**Новый файл:** `Хак/Test1111/server/src/integrations/active_directory.py`

```python
"""
Active Directory Integration - фундамент для подключения к AD.
Использует ldap3 (опциональная зависимость).
"""
import logging
from typing import Any

logger = logging.getLogger("server.ad")


class ADConnector:
    """Интерфейс для работы с Active Directory."""

    def __init__(self):
        self._connected = False
        self._config: dict[str, Any] = {}
        logger.info("AD Connector initialized (not configured)")

    def configure(self, server: str, domain: str, username: str, password: str,
                  base_dn: str, use_ssl: bool = True, port: int = 636) -> None:
        """Сохранить конфигурацию подключения."""
        self._config = {
            "server": server, "domain": domain, "username": username,
            "password": password, "base_dn": base_dn, "use_ssl": use_ssl, "port": port,
        }
        logger.info("AD configured: %s (domain=%s)", server, domain)

    def connect(self) -> bool:
        """
        TODO: Подключиться к AD через ldap3.
        pip install ldap3
        """
        logger.warning("AD connect: not implemented (install ldap3)")
        return False

    def disconnect(self) -> None:
        self._connected = False

    # --- Синхронизация ---
    def sync_users(self) -> list[dict]:
        """
        TODO: Получить список пользователей из AD.
        Выход: [{"username": ..., "display_name": ..., "email": ..., "groups": [...], "enabled": bool}]
        """
        return []

    def sync_groups(self) -> list[dict]:
        """TODO: Получить список групп из AD."""
        return []

    def sync_computers(self) -> list[dict]:
        """TODO: Получить список компьютеров из AD (для заполнения assets)."""
        return []

    # --- Аутентификация через AD ---
    def authenticate(self, username: str, password: str) -> dict | None:
        """
        TODO: Аутентификация пользователя через AD (LDAP bind).
        Выход: {"username": ..., "groups": [...], "dn": ...} или None
        """
        return None

    # --- Запросы ---
    def search_users(self, query: str, limit: int = 50) -> list[dict]:
        """TODO: Поиск пользователей в AD."""
        return []

    def get_user_groups(self, username: str) -> list[str]:
        """TODO: Получить группы пользователя."""
        return []

    def get_status(self) -> dict:
        return {
            "configured": bool(self._config),
            "connected": self._connected,
            "server": self._config.get("server", ""),
            "domain": self._config.get("domain", ""),
        }
```

### 8.2 Конфигурация
**Файл:** `Хак/Test1111/server/src/config.py`

```python
# Active Directory (optional)
AD_SERVER: str = os.getenv("AD_SERVER", "")
AD_DOMAIN: str = os.getenv("AD_DOMAIN", "")
AD_USERNAME: str = os.getenv("AD_USERNAME", "")
AD_PASSWORD: str = os.getenv("AD_PASSWORD", "")
AD_BASE_DN: str = os.getenv("AD_BASE_DN", "")
AD_USE_SSL: bool = os.getenv("AD_USE_SSL", "true").lower() == "true"
```

### 8.3 API
**Новый файл:** `Хак/Test1111/server/src/routers/integrations.py`

```
GET  /integrations/ad/status    — статус подключения к AD
POST /integrations/ad/configure — настройка (admin)
POST /integrations/ad/test      — тест подключения (admin)
POST /integrations/ad/sync      — синхронизация пользователей/компьютеров (admin)
```

### 8.4 .env.example
```
# Active Directory (optional)
AD_SERVER=
AD_DOMAIN=
AD_USERNAME=
AD_PASSWORD=
AD_BASE_DN=
```

---

## Фаза 9: Фундамент интеграций с EDR/ИБ-продуктами

### 9.1 Универсальный интерфейс интеграций
**Новый файл:** `Хак/Test1111/server/src/integrations/__init__.py`

```python
from .base import BaseIntegration, IntegrationRegistry
```

**Новый файл:** `Хак/Test1111/server/src/integrations/base.py`

```python
"""
Базовый интерфейс для интеграций с ИБ-продуктами.
Все вендорские интеграции наследуют BaseIntegration.
"""
from abc import ABC, abstractmethod
from typing import Any
import logging

logger = logging.getLogger("server.integrations")


class BaseIntegration(ABC):
    """Базовый класс для всех интеграций."""

    name: str = "unknown"
    vendor: str = "unknown"
    category: str = "unknown"  # edr, siem, firewall, av, dlp, soar, etc.

    def __init__(self):
        self._configured = False
        self._connected = False
        self._config: dict[str, Any] = {}

    @abstractmethod
    def configure(self, **kwargs) -> None:
        """Настроить интеграцию."""

    @abstractmethod
    def connect(self) -> bool:
        """Подключиться к продукту."""

    @abstractmethod
    def disconnect(self) -> None:
        """Отключиться."""

    @abstractmethod
    def health_check(self) -> dict:
        """Проверить доступность."""

    def get_status(self) -> dict:
        return {
            "name": self.name,
            "vendor": self.vendor,
            "category": self.category,
            "configured": self._configured,
            "connected": self._connected,
        }

    # --- Типовые операции (переопределяются) ---
    def pull_events(self, since: str = "", limit: int = 1000) -> list[dict]:
        """Получить события из продукта."""
        return []

    def push_event(self, event: dict) -> bool:
        """Отправить событие в продукт."""
        return False

    def pull_ioc(self) -> list[dict]:
        """Получить индикаторы компрометации."""
        return []

    def create_incident(self, data: dict) -> dict | None:
        """Создать инцидент в продукте (SOAR)."""
        return None

    def quarantine_host(self, host: str) -> bool:
        """Изолировать хост (EDR)."""
        return False

    def block_ip(self, ip: str) -> bool:
        """Заблокировать IP (Firewall)."""
        return False


class IntegrationRegistry:
    """Реестр всех подключённых интеграций."""

    def __init__(self):
        self._integrations: dict[str, BaseIntegration] = {}

    def register(self, integration: BaseIntegration) -> None:
        self._integrations[integration.name] = integration
        logger.info("Integration registered: %s (%s)", integration.name, integration.vendor)

    def get(self, name: str) -> BaseIntegration | None:
        return self._integrations.get(name)

    def list_all(self) -> list[dict]:
        return [i.get_status() for i in self._integrations.values()]

    def list_by_category(self, category: str) -> list[dict]:
        return [i.get_status() for i in self._integrations.values() if i.category == category]
```

### 9.2 Заглушки вендоров
**Новые файлы (заглушки):**

`Хак/Test1111/server/src/integrations/kaspersky_edr.py`:
```python
class KasperskyEDR(BaseIntegration):
    name = "kaspersky-edr"
    vendor = "Kaspersky"
    category = "edr"
    # TODO: API Kaspersky EDR Expert / KATA
```

`Хак/Test1111/server/src/integrations/positive_technologies.py`:
```python
class PTSandbox(BaseIntegration):
    name = "pt-sandbox"
    vendor = "Positive Technologies"
    category = "sandbox"

class PTNAD(BaseIntegration):
    name = "pt-nad"
    vendor = "Positive Technologies"
    category = "nta"
```

`Хак/Test1111/server/src/integrations/generic_syslog.py`:
```python
class SyslogReceiver(BaseIntegration):
    name = "syslog-receiver"
    vendor = "Generic"
    category = "syslog"
    # TODO: UDP/TCP syslog listener
```

`Хак/Test1111/server/src/integrations/generic_cef.py`:
```python
class CEFReceiver(BaseIntegration):
    name = "cef-receiver"
    vendor = "Generic"
    category = "cef"
    # TODO: CEF-формат (ArcSight, etc.)
```

### 9.3 API интеграций
**Файл:** `Хак/Test1111/server/src/routers/integrations.py` (расширить)

```
GET    /integrations               — список всех интеграций и их статус
GET    /integrations/{name}/status — статус конкретной интеграции
POST   /integrations/{name}/configure — настроить (admin)
POST   /integrations/{name}/test   — тест подключения (admin)
POST   /integrations/{name}/sync   — синхронизация данных (admin)
```

### 9.4 UI
**Новый файл:** `Хак/Test1111/ui/src/pages/Integrations.tsx`

Карточки интеграций: название, вендор, категория, статус (настроена/подключена), кнопки "Настроить", "Тест", "Синхронизация".

---

## Фаза 10: System Health

### 10.1 Мониторинг здоровья системы
**Новый файл:** `Хак/Test1111/server/src/services/system_health.py`

```python
"""Мониторинг состояния компонентов URSUS SIEM."""
import time
import threading
import logging
from typing import Any

logger = logging.getLogger("server.health")


class SystemHealth:
    """Собирает и хранит метрики здоровья системы."""

    def __init__(self, db):
        self.db = db
        self._metrics: dict[str, Any] = {}
        self._last_check = 0

    def collect(self) -> dict[str, Any]:
        """Собрать все метрики."""
        return {
            "timestamp": time.time(),
            "components": {
                "database": self._check_database(),
                "correlation_engine": self._check_correlation(),
                "alert_engine": self._check_alerting(),
                "ml_engine": self._check_ml(),
                "integrations": self._check_integrations(),
            },
            "statistics": self._get_statistics(),
            "agents": self._check_agents(),
        }

    def _check_database(self) -> dict:
        """Проверить PostgreSQL."""
        try:
            conn = self.db._conn()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.execute("SELECT count(*) FROM logs")
                total_logs = cur.fetchone()[0]
                cur.execute("SELECT pg_database_size(current_database())")
                db_size = cur.fetchone()[0]
            self.db._put(conn)
            return {
                "status": "healthy",
                "total_logs": total_logs,
                "db_size_bytes": db_size,
                "db_size_human": f"{db_size / 1024 / 1024:.1f} MB",
            }
        except Exception as e:
            return {"status": "unhealthy", "error": str(e)}

    def _check_correlation(self) -> dict:
        """Статус корреляционного движка."""
        return {
            "status": "running",
            "rules_count": 0,  # TODO: из БД
            "alerts_today": 0,  # TODO: из БД
        }

    def _check_alerting(self) -> dict:
        return {"status": "running"}

    def _check_ml(self) -> dict:
        return {"status": "stub", "message": "ML not configured"}

    def _check_integrations(self) -> dict:
        return {"status": "ok", "connected": 0, "total": 0}

    def _get_statistics(self) -> dict:
        """Статистика за последние 24ч."""
        try:
            conn = self.db._conn()
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        count(*) AS total_24h,
                        count(*) FILTER (WHERE level = 'ERROR') AS errors_24h,
                        count(*) FILTER (WHERE level = 'CRITICAL') AS critical_24h,
                        count(DISTINCT agent_id) AS active_agents,
                        count(DISTINCT host) AS unique_hosts
                    FROM logs
                    WHERE timestamp > NOW() - INTERVAL '24 hours'
                """)
                row = cur.fetchone()
            self.db._put(conn)
            return {
                "events_24h": row[0],
                "errors_24h": row[1],
                "critical_24h": row[2],
                "active_agents": row[3],
                "unique_hosts": row[4],
                "eps": 0,  # TODO: events per second
            }
        except Exception as e:
            return {"error": str(e)}

    def _check_agents(self) -> dict:
        """Статус агентов."""
        try:
            conn = self.db._conn()
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT agent_id, max(timestamp) AS last_seen,
                           max(timestamp) > NOW() - INTERVAL '5 minutes' AS active
                    FROM logs GROUP BY agent_id
                """)
                agents = cur.fetchall()
            self.db._put(conn)
            active = sum(1 for a in agents if a[2])
            return {
                "total": len(agents),
                "active": active,
                "inactive": len(agents) - active,
            }
        except Exception as e:
            return {"error": str(e)}


def health_loop(health: SystemHealth, interval: float = 60.0):
    """Фоновый поток сбора метрик здоровья."""
    logger.info("System Health monitor started (interval=%.0fs)", interval)
    while True:
        try:
            health._metrics = health.collect()
            health._last_check = time.time()
        except Exception:
            logger.exception("Health check failed")
        time.sleep(interval)
```

### 10.2 API
**Модифицировать:** `Хак/Test1111/server/src/main.py` — добавить `/health/detailed`

```python
@app.get("/health/detailed")
async def health_detailed(request: Request, user: dict = Depends(verify_token)):
    return request.app.state.system_health._metrics
```

Расширить существующий `/health`:
```python
@app.get("/health")
async def health(request: Request):
    return {
        "status": "ok",
        "version": "1.0.0",
        "uptime_seconds": time.time() - app.state.start_time,
    }
```

### 10.3 UI: Dashboard System Health
**Новый файл:** `Хак/Test1111/ui/src/pages/SystemHealth.tsx`

Дашборд здоровья системы:
- **Компоненты:** карточки с индикаторами (зелёный/жёлтый/красный) для каждого компонента (БД, корреляция, алерты, ML, интеграции)
- **Статистика:** EPS (events per second), события за 24ч, ошибки, критические
- **Агенты:** количество активных/неактивных
- **БД:** размер базы, общее количество событий
- **Авто-обновление:** каждые 30 секунд

### 10.4 Регистрация
**Файл:** `Хак/Test1111/server/src/main.py`

```python
from server.src.services.system_health import SystemHealth, health_loop

# В lifespan:
app.state.system_health = SystemHealth(db_service)
app.state.start_time = time.time()
threading.Thread(target=health_loop, args=(app.state.system_health,), daemon=True).start()
```

---

## Фаза 11: Удаление корневых папок

Удалить из репозитория:
- `agent/`, `api/`, `core/`, `web/`, `deploy/`, `data/`
- `Main.py`, `config.py`, `requirements.txt`, `.md`

Оставить: `Хак/` (единственный проект), `.gitignore` (обновить).

---

## Фаза 6: README и финализация

### README.md (`Хак/Test1111/README.md`)
- Название: **URSUS SIEM**
- Архитектура: FastAPI + PostgreSQL + React + Docker
- Фичи: PDQL-фильтрация, расширенный парсер, трёхуровневая категоризация, корреляция (4 типа правил), 8 предустановленных правил обнаружения
- Примеры PDQL-запросов
- Инструкции по запуску
- API эндпоинты
- Секция про agent_v (OpenSearch)

---

## Порядок выполнения

1. **Фаза 0** — ветка + домен + секреты
2. **Фаза 1** — парсер + категоризация (1 новый файл, 2 изменения)
3. **Фаза 2** — PDQL (1 новый файл сервер, 1 новый компонент UI, изменения в search.py, postgres.py, client.ts, Search.tsx)
4. **Фаза 3** — корреляция (2 новых файла, 3 изменения)
5. **Фаза 4** — UI корреляции (2 новых файла, 2 изменения)
6. **Фаза 5** — удаление корневых папок
7. **Фаза 6** — README

## Ключевые файлы

**Источники для портирования:**
- `core/parser.py` — парсер логов
- `core/correlator.py` — корреляционный движок

**Основные файлы для изменения:**
- `Хак/Test1111/server/src/services/pipeline.py` — интеграция парсера
- `Хак/Test1111/server/src/services/postgres.py` — новые методы БД + execute_pdql
- `Хак/Test1111/server/src/routers/search.py` — эндпоинт PDQL
- `Хак/Test1111/server/src/main.py` — регистрация роутеров и потоков
- `Хак/Test1111/server/init.sql` — новые таблицы + индексы
- `Хак/Test1111/ui/src/pages/Search.tsx` — переработка UI поиска
- `Хак/Test1111/ui/src/api/client.ts` — новые методы API
- `Хак/Test1111/ui/src/App.tsx` — маршруты

**Новые файлы:**
- `Хак/Test1111/server/src/services/parser.py` — парсер + категоризация
- `Хак/Test1111/server/src/services/pdql.py` — PDQL-транслятор
- `Хак/Test1111/server/src/services/correlator.py` — движок корреляции
- `Хак/Test1111/server/src/routers/correlation.py` — API корреляции
- `Хак/Test1111/ui/src/components/PDQLInput.tsx` — компонент PDQL
- `Хак/Test1111/ui/src/pages/CorrelationRules.tsx` — страница правил
- `Хак/Test1111/ui/src/pages/CorrelationAlerts.tsx` — страница алертов

## Верификация

1. `grep -r "kronos" Хак/` — домен убран
2. Проверить `.env` — секреты очищены
3. `python -m py_compile` для всех новых .py файлов
4. TypeScript компиляция в ui/
5. init.sql содержит новые таблицы
6. Корневые папки удалены
7. `docker-compose up` — запуск стека
8. Тест PDQL: `curl "/search/pdql?query=filter(level='ERROR')"` возвращает результаты
