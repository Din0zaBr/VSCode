# Развёртывание URSUS SIEM

## Требования

| Компонент | Минимум | Рекомендуется |
|-----------|---------|--------------|
| CPU | 2 ядра | 4 ядра |
| RAM | 4 ГБ | 8 ГБ |
| Диск | 20 ГБ | 100+ ГБ (для логов) |
| OS | Linux (Ubuntu 22.04+, Fedora 38+) | Ubuntu 22.04 LTS |
| Docker | 24+ | latest |
| Docker Compose | v2.20+ | latest |

---

## Метод 1: Docker Compose (рекомендуется)

### Шаг 1. Клонирование и настройка

```bash
git clone <url> logvault-server
cd logvault-server

# Создать .env из шаблона
cp .env.example .env
```

### Шаг 2. Конфигурация (.env)

Откройте `.env` и заполните все параметры:

```dotenv
# ── Безопасность ────────────────────────────────────────────────
JWT_SECRET=замените_на_длинную_случайную_строку_min_32_символа
JWT_EXPIRE_MINUTES=480

# ── База данных ──────────────────────────────────────────────────
PG_PASSWORD=надёжный_пароль_postgres

# ── API-ключи агентов ────────────────────────────────────────────
# Статические ключи (через запятую), можно оставить пустым
# и использовать динамические ключи из БД
API_KEYS=ursus-ключ1,ursus-ключ2

# ── Сеть ─────────────────────────────────────────────────────────
SERVER_PORT=8000
UI_PORT=8080
CORS_ORIGINS=http://localhost:8080,http://localhost:8000

# ── Алерты ───────────────────────────────────────────────────────
ALERT_WEBHOOK_URL=https://your-webhook.example.com/hook
ALERT_TELEGRAM_BOT_TOKEN=токен_бота
ALERT_TELEGRAM_CHAT_ID=id_чата

# ── Производительность ───────────────────────────────────────────
MAX_BATCH_SIZE=5000
LIVE_BUFFER_SIZE=1000

# ── Active Directory (необязательно) ────────────────────────────
AD_SERVER=ldap://dc.example.com
AD_DOMAIN=example.com
AD_USERNAME=svc-siem
AD_PASSWORD=пароль_сервисного_аккаунта
AD_BASE_DN=DC=example,DC=com
AD_USE_SSL=false
```

### Шаг 3. Запуск

```bash
# Автоматический запуск (проверяет зависимости, ждёт готовности)
bash start.sh

# Или вручную:
docker compose up --build -d

# Проверка состояния
docker compose ps
docker compose logs -f server
```

### Шаг 4. Первый вход

1. Откройте http://localhost:8080
2. Войдите: `admin` / `admin`
3. **Обязательно смените пароль** в разделе администрирования

---

## Метод 2: Нативный запуск (только сервер)

Используйте, если PostgreSQL уже развёрнут отдельно.

```bash
cd server

# Виртуальное окружение
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Переменные окружения
export DATABASE_URL="postgresql+asyncpg://postgres:password@localhost:5432/siem"
export JWT_SECRET="ваш_секрет"
export API_KEYS="ursus-mykey"

# Инициализация БД (один раз)
psql -U postgres -d siem -f init.sql

# Запуск сервера
uvicorn server.src.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## Архитектура Docker Compose

```yaml
services:
  caddy:       # Reverse proxy, порты 8000 (API) и 8080 (UI)
  postgres:    # PostgreSQL с auto-init из init.sql
  server:      # FastAPI сервер
  ui:          # React + nginx
```

**Сети**: все сервисы в изолированной сети `logvault` (172.20.0.0/24).

**Volumes**:
- `pg_data` — данные PostgreSQL (постоянное хранилище)
- `caddy_data`, `caddy_config` — TLS-сертификаты Caddy

---

## Обновление

```bash
git pull origin main

# Пересобрать только изменившиеся образы
docker compose up --build -d

# Применить миграции БД вручную при необходимости
docker compose exec postgres psql -U postgres -d siem -f /docker-entrypoint-initdb.d/init.sql
```

---

## Масштабирование

### Горизонтальное масштабирование (несколько серверов)

```bash
docker compose up --scale server=3 -d
```

Caddy автоматически балансирует нагрузку между репликами сервера.

### Вертикальное масштабирование (ресурсы PostgreSQL)

В `docker-compose.yml` добавьте к сервису `postgres`:

```yaml
environment:
  POSTGRES_SHARED_BUFFERS: 2GB
  POSTGRES_EFFECTIVE_CACHE_SIZE: 6GB
  POSTGRES_MAX_CONNECTIONS: 200
deploy:
  resources:
    limits:
      memory: 8G
```

---

## Управление данными

### Ротация логов

```sql
-- Удалить события старше 90 дней
DELETE FROM logs WHERE timestamp < NOW() - INTERVAL '90 days';

-- VACUUM для освобождения места
VACUUM ANALYZE logs;
```

### Резервное копирование PostgreSQL

```bash
# Дамп
docker compose exec postgres pg_dump -U postgres siem > backup_$(date +%Y%m%d).sql

# Восстановление
docker compose exec -T postgres psql -U postgres siem < backup_20250101.sql
```

### Мониторинг размера базы

```sql
SELECT
    pg_size_pretty(pg_database_size('siem')) AS db_size,
    pg_size_pretty(pg_table_size('logs'))    AS logs_size,
    count(*) AS total_events
FROM logs;
```

---

## Брандмауэр и сетевая безопасность

### Открытые порты

| Порт | Сервис | Описание |
|------|--------|---------|
| 8000 | Caddy → API | REST API и WebSocket |
| 8080 | Caddy → UI | Web-интерфейс |

### Рекомендуемые правила firewall (ufw)

```bash
# Только доступ с корпоративной подсети
ufw allow from 192.168.0.0/16 to any port 8000
ufw allow from 192.168.0.0/16 to any port 8080
ufw deny 8000
ufw deny 8080
```

### HTTPS (production)

В `Caddyfile` замените `http://` на ваш домен:

```caddyfile
siem.example.com {
    reverse_proxy /api/* server:8000
    reverse_proxy * ui:80
}
```

Caddy автоматически получит Let's Encrypt сертификат.

---

## Проверка работоспособности

```bash
# Статус всех сервисов
docker compose ps

# Health-check сервера
curl http://localhost:8000/health

# Детальный health-check
curl http://localhost:8000/health/detailed

# Проверка БД (должен вернуть список таблиц)
docker compose exec postgres psql -U postgres -d siem -c "\dt"

# Тест авторизации
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

---

## Устранение неполадок

| Проблема | Причина | Решение |
|----------|---------|---------|
| `connection refused` на порту 8000 | Сервер не запустился | `docker compose logs server` |
| `password authentication failed` | Неверный PG_PASSWORD в .env | Пересоздать контейнер: `docker compose down -v && docker compose up` |
| UI загружается, но API недоступен | Проблема с Caddy proxy | `docker compose logs caddy` |
| Агент не подключается | Неверный API-ключ | Проверить ключ в SystemAdmin → API ключи |
| `no space left on device` | Переполнен диск | Ротация логов или увеличение диска |
