# API reference

URSUS REST API + WebSocket для live-streams. Все запросы кроме `/health`,
`/metrics` и `/api/auth/login` требуют JWT-токен в заголовке
`Authorization: Bearer <token>`.

Base URL: `https://siem.example.com` (или `http://localhost:8080` локально).

## Authentication

### Login

```http
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "secret" }
```

Ответ:
```json
{ "token": "<jwt>", "role": "admin", "agents": [...] }
```

Используйте `token` в дальнейших запросах:
```http
Authorization: Bearer <token>
```

## Ingest

| Endpoint | Auth | Описание |
|---|---|---|
| `POST /api/ingest`        | X-Api-Key | Старый формат `{agent_id, logs:[...]}` |
| `POST /api/ingest/vector` | X-Api-Key | Vector NDJSON (один JSON-объект на строку) |
| Syslog `:514` UDP/TCP     | none      | RFC 5424 + RFC 3164 |

## Search

| Endpoint | Описание |
|---|---|
| `GET /api/search?q=...&size=50` | Полнотекст + фильтры |
| `GET /api/search/pdql?q=<PDQL>` | DSL-запрос → SQL → результаты |
| `GET /api/stats?interval=1h`    | Время-серии для дашборда |

Параметры `/api/search`: `q`, `level`, `host`, `agent_id`, `service`, `from`, `to`, `page`, `size`.

## Alerts and rules

| Endpoint | Описание |
|---|---|
| `GET    /api/correlation/alerts` | список инцидентов от корреляции |
| `PATCH  /api/correlation/alerts/:id` | смена статуса |
| `DELETE /api/alerts/:id` | удалить инцидент |
| `GET    /api/correlation/rules` | список правил |
| `POST   /api/correlation/rules` | создать правило |
| `PUT    /api/correlation/rules/:id` | обновить |
| `DELETE /api/correlation/rules/:id` | удалить |

## SIGMA rules

| Endpoint | Описание |
|---|---|
| `GET /api/sigma-rules` | список с фильтрами `category`, `severity`, `status` |
| `GET /api/sigma-rules/stats` | агрегаты для UI |
| `POST /api/sigma-rules/import` | import YAML — `{"rule_yaml":"..."}` |
| `POST /api/sigma-rules/:id/toggle` | enable/disable |

## Scenarios (bundle)

20 готовых сценариев из `configs/scenarios/bundle.yaml`:

| Endpoint | Описание |
|---|---|
| `GET   /api/scenarios/bundled` | список сценариев |
| `GET   /api/scenarios/bundled/:id` | детали |
| `PATCH /api/scenarios/bundled/:id/toggle` | включить/выключить |

## Anomaly (ML)

| Endpoint | Описание |
|---|---|
| `GET  /api/anomaly/alerts` | список anomaly-алертов |
| `PATCH /api/anomaly/alerts/:id` | смена статуса |
| `GET  /api/anomaly/baseline` | дамп baseline |
| `POST /api/anomaly/baseline/rebuild` | пересчёт |
| `POST /api/anomaly/detect-now?minutes=60` | детекция «здесь и сейчас» |
| `POST /api/anomaly/check-domain` | DGA-scoring доменов |

## Assets / Accounts / Exclusions

| Endpoint | Описание |
|---|---|
| `GET/POST/PUT/DELETE /api/assets[/:id]` | хосты |
| `POST /api/assets/discover` | auto-create из logs |
| `GET/POST/PUT/DELETE /api/accounts[/:id]` | учётные записи |
| `GET/POST/PUT/DELETE /api/exclusions[/:id]` | правила исключений |

## Reports

| Endpoint | Описание |
|---|---|
| `GET /api/reports/html/{alerts\|events}` | HTML отчёт |
| `GET /api/reports/csv/{alerts\|events}` | CSV экспорт |

## Compliance (Sprint 9)

| Endpoint | Описание |
|---|---|
| `GET /api/compliance/profiles` | список профилей (fstec-21, ...) |
| `GET /api/compliance/:name/preview` | JSON evidence dump |
| `GET /api/compliance/:name/pdf` | PDF отчёт |

## Audit + MITRE

| Endpoint | Описание |
|---|---|
| `GET /api/audit?actor=&action=` | audit-log |
| `GET /api/mitre/coverage` | MITRE ATT&CK heatmap |
| `POST /api/mitre/coverage/refresh` | пересчитать покрытие |

## Threat Intelligence

| Endpoint | Описание |
|---|---|
| `GET /api/integrations/sync/log` | история подкачки IOC |
| `GET /api/integrations/sync/stats` | агрегаты |

## Users + API keys

| Endpoint | Описание |
|---|---|
| `GET/POST/DELETE /api/users[/:id]` | управление пользователями |
| `PATCH /api/users/:id/role` | сменить роль |
| `GET/POST/PATCH/DELETE /api/admin/api-keys` | API-ключи для агентов |

## v2.1 preview endpoints

(Доступны, но не часть v2.0 MVP.)

- `GET/POST/DELETE /api/canaries[/:id]` — honeypot tokens
- `POST /api/canaries/hits` — отчёт о срабатывании
- `GET /api/llm/health`, `POST /api/llm/{nl-to-pdql,explain,narrative,parse-format}` — LLM proxy

## WebSocket

```
GET /api/logs/live?token=<jwt>
```

Стримит каждое новое событие в JSON. Сообщения в формате `storage.LogEvent`.

## Health & metrics

| Endpoint | Auth | Описание |
|---|---|---|
| `GET /health` | none | `{"status":"ok","engine":true}` |
| `GET /metrics` | none | Prometheus exposition |
| `GET /api/health/detailed` | JWT | Полная самодиагностика |

## Codes

- `200 OK` — успех
- `400 Bad Request` — невалидный payload
- `401 Unauthorized` — нет / невалидный JWT / API-key
- `403 Forbidden` — недостаточно прав (role)
- `404 Not Found` — объект не существует
- `429 Too Many Requests` — rate limit (Sprint 6, опционально)
- `503 Service Unavailable` — engine/LLM/CH недоступен
