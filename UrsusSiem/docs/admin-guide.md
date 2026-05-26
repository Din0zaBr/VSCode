# Руководство администратора URSUS SIEM

## Первоначальная настройка после установки

### 1. Смена пароля по умолчанию

```bash
# Через API
curl -X PUT http://localhost:8000/users/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password": "новый_надёжный_пароль"}'
```

Или через интерфейс: **Система → Пользователи → admin → Редактировать**.

### 2. Настройка переменных окружения (.env)

Убедитесь, что заполнены все критичные переменные:

```dotenv
JWT_SECRET=<случайная строка 64+ символа>
PG_PASSWORD=<надёжный пароль>
API_KEYS=                          # Можно оставить пустым, ключи создавать через UI
ALERT_WEBHOOK_URL=https://...      # Endpoint для вебхук-уведомлений
ALERT_TELEGRAM_BOT_TOKEN=...
ALERT_TELEGRAM_CHAT_ID=...
```

### 3. Генерация JWT-секрета

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## Управление пользователями

**Интерфейс: Система → Пользователи**

### Роли

| Роль | Доступ |
|------|--------|
| `admin` | Полный доступ: настройки, все агенты, все пользователи |
| `operator` | Только события от назначенных агентов; нет доступа к настройкам |

### Создание пользователя

1. Нажмите **+ Создать пользователя**
2. Введите логин, пароль, выберите роль
3. Нажмите **Создать**

### Назначение агентов оператору

1. Откройте карточку оператора
2. В разделе **Доступные агенты** выберите нужные agent_id
3. Нажмите **Сохранить**

После этого оператор видит только события от назначенных агентов.

### API

```bash
# Список пользователей
curl http://localhost:8000/users -H "Authorization: Bearer $TOKEN"

# Создать пользователя
curl -X POST http://localhost:8000/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"operator1","password":"pass123","role":"operator"}'

# Назначить агентов оператору
curl -X PUT http://localhost:8000/users/2/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agents": ["agent-linux-01", "agent-linux-02"]}'

# Удалить пользователя
curl -X DELETE http://localhost:8000/users/2 -H "Authorization: Bearer $TOKEN"
```

---

## Управление API-ключами

**Интерфейс: Система → Администрирование → API ключи**

### Создание ключа

1. Нажмите **+ Создать ключ**
2. Введите имя (например: `prod-server-01`)
3. Скопируйте ключ — он показывается **только один раз**
4. Передайте ключ администратору сервера для настройки агента

### Формат ключа

`ursus-<40 случайных символов>`

### Управление ключами

| Действие | Описание |
|----------|---------|
| **Включить/выключить** | Временно заблокировать ключ без удаления |
| **Удалить** | Необратимое удаление; агент с этим ключом не сможет подключиться |

### Ротация ключей

1. Создайте новый ключ
2. Обновите `/opt/ursus-agent/config.env` на агенте
3. Перезапустите агент: `sudo systemctl restart ursus-agent`
4. Удалите старый ключ

### Статические ключи (.env)

В файле `.env` можно задать список постоянных ключей через запятую:
```dotenv
API_KEYS=ursus-key1,ursus-key2
```
Эти ключи действуют в обход БД и не отображаются в интерфейсе.

---

## Настройка интеграций

**Интерфейс: Интеграции**

### Active Directory / LDAP

```bash
# Настроить подключение
curl -X POST http://localhost:8000/integrations/ad/configure \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "server": "ldap://dc.example.com",
    "domain": "example.com",
    "username": "svc-siem",
    "password": "пароль",
    "base_dn": "DC=example,DC=com",
    "use_ssl": false
  }'

# Запустить синхронизацию
curl -X POST http://localhost:8000/integrations/ad/sync \
  -H "Authorization: Bearer $TOKEN"

# Статус
curl http://localhost:8000/integrations/ad/status -H "Authorization: Bearer $TOKEN"
```

После синхронизации учётные записи и компьютеры из AD появятся в **Активы → Аккаунты**.

### Kaspersky EDR

```bash
curl -X POST http://localhost:8000/integrations/kaspersky/configure \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"api_url": "https://kas-server/api", "token": "kas-token"}'
```

### PT Sandbox / PT NAD

```bash
curl -X POST http://localhost:8000/integrations/pt/configure \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sandbox_url": "https://pts-server", "nad_url": "https://ptnad-server", "api_key": "pt-key"}'
```

### Syslog-приёмник

Сервер автоматически запускает Syslog UDP/TCP приёмник при наличии конфигурации. Настраивается в `server/src/integrations/generic_syslog.py`.

---

## Настройка алертов и уведомлений

### Webhook

```dotenv
ALERT_WEBHOOK_URL=https://your-endpoint.com/webhook
```

Тело запроса при срабатывании:
```json
{
  "alert_name": "SSH Brute Force",
  "severity": "HIGH",
  "triggered_at": "2025-01-15T12:34:56Z",
  "events_count": 15,
  "details": "..."
}
```

### Telegram

```dotenv
ALERT_TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
ALERT_TELEGRAM_CHAT_ID=-1001234567890
```

Получение chat_id: отправьте сообщение боту, затем:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

### Настройка из интерфейса

**Система → Алерты** — включить/выключить уведомления для каждого правила отдельно.

---

## Управление правилами корреляции

### Приоритеты

Правила обрабатываются по порядку создания. Для изменения порядка используйте API (поле `priority` в будущих версиях).

### Отключение правила без удаления

```bash
curl -X PUT http://localhost:8000/correlation/rules/5 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

### Массовое создание правил из файла

```bash
while IFS= read -r rule; do
  curl -X POST http://localhost:8000/correlation/rules \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$rule"
done < rules.jsonl
```

---

## Управление активами

### Инвентаризация хостов

```bash
# Импорт из CSV (через скрипт)
while IFS=, read -r hostname ip os dept; do
  curl -X POST http://localhost:8000/assets \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"hostname\":\"$hostname\",\"ip\":\"$ip\",\"os\":\"$os\",\"department\":\"$dept\"}"
done < assets.csv
```

### Синхронизация с AD

После настройки интеграции AD все компьютеры домена автоматически попадают в **Активы**.

---

## Резервное копирование и восстановление

### Автоматическое резервное копирование (cron)

Добавьте в `crontab -e` на сервере:

```bash
# Ежедневный дамп БД в 2:00
0 2 * * * docker compose -f /path/to/docker-compose.yml exec -T postgres \
  pg_dump -U postgres siem | gzip > /backups/siem_$(date +\%Y\%m\%d).sql.gz

# Удаление резервных копий старше 30 дней
0 3 * * * find /backups -name "siem_*.sql.gz" -mtime +30 -delete
```

### Восстановление

```bash
# Остановить сервер (не трогать postgres)
docker compose stop server

# Восстановить дамп
gunzip < /backups/siem_20250115.sql.gz | \
  docker compose exec -T postgres psql -U postgres siem

# Запустить сервер
docker compose start server
```

### Резервное копирование конфигурации

```bash
# Сохранить .env и конфигурацию
tar czf config_backup_$(date +%Y%m%d).tar.gz .env docker-compose.yml Caddyfile
```

---

## Мониторинг состояния системы

### Встроенный мониторинг

**Система → Состояние** — метрики в реальном времени:
- CPU / RAM / Диск сервера
- Число активных агентов
- Скорость приёма событий
- Размер базы данных

### Через API

```bash
# Быстрая проверка
curl http://localhost:8000/health

# Детальные метрики
curl http://localhost:8000/health/detailed -H "Authorization: Bearer $TOKEN"
```

### Внешний мониторинг (Prometheus / Zabbix)

Настройте внешний мониторинг endpoint `/health/detailed` и алертинг на:
- `db != "ok"` — проблема с базой данных
- `disk_percent > 85` — нехватка места
- `cpu_percent > 90` — перегрузка CPU

---

## Ротация журналов и хранение данных

### Настройка хранения

Рекомендуемая политика хранения для разных уровней:

| Уровень | Срок хранения |
|---------|--------------|
| DEBUG / INFO | 30 дней |
| WARNING | 90 дней |
| ERROR / CRITICAL | 365 дней |
| Алерты корреляции | 2 года |

### Автоматическая ротация (SQL)

Создайте в PostgreSQL функцию очистки:

```sql
CREATE OR REPLACE FUNCTION cleanup_old_logs(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM logs
  WHERE timestamp < NOW() - (days_to_keep || ' days')::INTERVAL
    AND level NOT IN ('ERROR', 'CRITICAL');
  GET DIAGNOSTICS deleted = ROW_COUNT;
  VACUUM ANALYZE logs;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;

-- Вызов (например, через cron или pg_cron):
SELECT cleanup_old_logs(90);
```

### Партиционирование (для больших объёмов)

При объёме > 100 млн событий рассмотрите партиционирование таблицы `logs` по месяцам:

```sql
-- Конвертировать таблицу в партиционированную (PostgreSQL 13+)
-- Требует планирования и downtime
```

---

## Обновление URSUS SIEM

### Обновление через Git + Docker

```bash
cd logvault-server

# Получить изменения
git fetch origin main

# Просмотреть изменения
git log HEAD..origin/main --oneline

# Применить обновление (с пересборкой образов)
git pull origin main
docker compose pull
docker compose up --build -d

# Проверить состояние
docker compose ps
curl http://localhost:8000/health
```

### Применение миграций базы данных

Если в обновлении есть изменения схемы БД:

```bash
docker compose exec postgres psql -U postgres -d siem -f /docker-entrypoint-initdb.d/init.sql
```

Скрипт `init.sql` использует `IF NOT EXISTS` и идемпотентен.

---

## Безопасность системы

### Контрольный список безопасности

- [ ] Сменить пароль admin по умолчанию
- [ ] Установить уникальный JWT_SECRET (64+ символа)
- [ ] Использовать HTTPS (настроить Caddy с доменом)
- [ ] Ограничить доступ к портам 8000/8080 файрволом
- [ ] Ротировать API-ключи каждые 90 дней
- [ ] Настроить автоматическое резервное копирование
- [ ] Включить уведомления об алертах (Webhook/Telegram)
- [ ] Завести отдельные аккаунты для каждого оператора
- [ ] Не использовать статические ключи в .env в production

### Аудит действий

Все административные действия (создание/удаление пользователей, изменение правил) логируются в стандартный вывод FastAPI:

```bash
docker compose logs server | grep "admin"
```

### Сессии и токены

JWT-токены истекают через `JWT_EXPIRE_MINUTES` (по умолчанию 480 минут = 8 часов). Для инвалидации токена без перезапуска сервера смените `JWT_SECRET` в `.env` и перезапустите сервер — все активные сессии завершатся.

---

## Часто задаваемые вопросы администратора

**Q: Как полностью очистить базу данных?**
```bash
docker compose exec postgres psql -U postgres -d siem -c "TRUNCATE logs CASCADE;"
```

**Q: Как изменить порт UI?**
В `.env`: `UI_PORT=9090`, затем `docker compose up -d`.

**Q: Агент отправляет данные, но я их не вижу — почему?**
Убедитесь, что API-ключ агента включён (Система → API ключи) и оператор (если не admin) привязан к этому agent_id.

**Q: Как экспортировать все правила корреляции?**
```bash
curl http://localhost:8000/correlation/rules \
  -H "Authorization: Bearer $TOKEN" > correlation_rules_backup.json
```

**Q: Как перезапустить только сервер без пересборки?**
```bash
docker compose restart server
```
