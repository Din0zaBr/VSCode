# Troubleshooting

Решения частых проблем. Если не нашли — Telegram: @ursus_siem_support.

## Установка

### `install.sh` падает на «Docker not found» после установки

После установки Docker нужно либо перелогиниться, либо запустить:
```bash
newgrp docker
```

### `docker compose up` падает — порт 514 занят

На сервере уже работает `rsyslog`. Отключите его или измените порт:
```bash
sudo systemctl stop rsyslog && sudo systemctl disable rsyslog
# или в docker-compose.yml поменяйте "514:514/udp" → "5140:514/udp"
```

### Не могу зайти в UI — «invalid credentials»

Пароль admin печатается **один раз** при `install.sh`. Если потеряли:
```bash
docker exec -it ursus-postgres psql -U logvault -d logvault \
  -c "UPDATE users SET password_hash = '\$2a\$12\$NEW_BCRYPT_HASH' WHERE username = 'admin';"
```
Bcrypt-хеш генерируется: `cd UrsusSiem/scripts && go run gen-password-hash.go MyNewPass`.

## Приём событий

### Vector не пересылает события

```bash
# 1. Vector сам видит конфиг?
sudo vector validate /etc/vector/vector.yaml

# 2. Vector жив?
sudo systemctl status vector
sudo journalctl -u vector -n 100

# 3. URSUS принимает API-ключ?
curl -X POST https://siem.example.com/api/ingest/vector \
  -H "X-Api-Key: <API_KEY>" \
  -H "Content-Type: application/x-ndjson" \
  --data '{"timestamp":"2026-05-24T12:00:00Z","host":"test","message":"hello"}'
# Должно вернуть 200 OK с {"indexed":1}
```

Если 401 — API-ключ не валиден. Сгенерируйте новый в UI → System → API Keys.

### Syslog приходит, но не показывается в UI

```bash
# Внутри контейнера URSUS:
docker exec -it ursus-logvault-go-1 sh
# Проверить /metrics:
curl http://localhost:8080/metrics | grep ursus_syslog
# Если ursus_syslog_received_total=0 — syslog порт не слушает.
# Если >0 но ursus_ingest_errors_total > 0 — проблема со storage.
```

## Производительность

### Высокая нагрузка CPU на logvault-rust

Скорее всего тяжёлые SIGMA-правила с regex'ами. Список самых «дорогих»:
```sql
SELECT rule_id, title FROM sigma_rules
WHERE rule_yaml LIKE '%.*.*.*%' OR rule_yaml LIKE '%CONTAINS%'
ORDER BY updated_at DESC;
```
Отключить временно: `UPDATE sigma_rules SET status='disabled' WHERE rule_id='...'`.

### PostgreSQL переполняет диск

Включите TTL:
```sql
ALTER TABLE logs SET (autovacuum_vacuum_scale_factor = 0.05);
DELETE FROM logs WHERE timestamp < NOW() - INTERVAL '90 days';
```
Или переключитесь на ClickHouse (v2.1 preview):
`docker compose -f docker-compose.yml -f docker-compose.medium.yml up -d`

## ML и Threat Intelligence

### `anomaly_alerts` пустая — anomaly не находится

Базовая модель строится **24 часа после первого события**. До этого
момента aномалий нет (не с чем сравнивать). Чтобы пересчитать:

```bash
curl -X POST https://siem.example.com/api/anomaly/baseline/rebuild \
  -H "Authorization: Bearer $JWT"
```

### Threat Intel feed не подтягивается

```sql
SELECT name, last_pull_at, last_count, last_error FROM ti_feeds;
```
Если `last_error` содержит URL — проблема с сетью или DNS. Если 403 — фид
требует API-ключ (например MalwareBazaar).

## Уведомления

### Telegram-сообщения не приходят

1. Бот добавлен в нужный чат? `chat_id` — это **числовой** ID, не имя.
   Узнать: `curl https://api.telegram.org/bot<TOKEN>/getUpdates`
2. URSUS видит конфиг?
   ```bash
   docker exec ursus-logvault-go-1 env | grep URSUS_TG
   ```
3. Тестовый алерт:
   ```bash
   curl -X POST https://siem.example.com/api/canaries/hits \
     -H "Authorization: Bearer $JWT" \
     -d '{"canary_id":1,"actor":"test","action":"open"}'
   ```

### Email падает с TLS handshake error

Проверьте порт: 587 = STARTTLS, 465 = implicit TLS. URSUS определяет
автоматически по порту в `URSUS_SMTP_HOST`.

## Отчёты ФСТЭК

### `typst: not found`

```bash
# Ubuntu/Debian
apt install typst-cli
# или
curl -L https://github.com/typst/typst/releases/latest/download/typst-x86_64-unknown-linux-musl.tar.xz | tar xJ
sudo mv typst-*/typst /usr/local/bin/
```

### PDF генерируется, но без кириллицы

В контейнере Go нужен шрифт DejaVu Sans:
```dockerfile
RUN apt-get install -y fonts-dejavu-core
```
Уже включено в `Dockerfile`, проверьте версию образа.

## Обновление

### С v2.0 → v2.1

```bash
cd /opt/ursus
docker compose pull
docker compose up -d
docker compose logs -f logvault-go
```

Миграции БД применяются автоматически (idempotent).

## Получить помощь

- GitHub Issues: <https://github.com/Din0zaBr/VSCode/issues>
- Telegram-чат: @ursus_siem_chat
- Email: hello@ursus-siem.ru
