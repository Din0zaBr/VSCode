# Telegram-уведомления

## 1. Создать бота

1. Открыть [@BotFather](https://t.me/BotFather) в Telegram.
2. `/newbot` → задать имя (например `URSUS SIEM Bot`) и username (`my_ursus_bot`).
3. BotFather пришлёт **токен вида** `123456:ABC-DEF1234...`. Сохраните.

## 2. Узнать chat_id

Для **личного чата:**
1. Откройте чат с ботом, нажмите Start.
2. В браузере: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. В ответе ищите `"chat":{"id":123456789,...}` — это ваш `chat_id`.

Для **группового чата:**
1. Добавьте бота в группу. Дайте ему права на чтение и отправку сообщений.
2. Напишите в группе `/start@my_ursus_bot`.
3. `https://api.telegram.org/bot<TOKEN>/getUpdates` → `"chat":{"id":-1001234567890,...}`.
   Групповые ID начинаются с `-100` или `-`.

## 3. Прописать в URSUS

В `/opt/ursus/.env`:
```env
URSUS_TG_TOKEN=123456:ABC-DEF1234...
URSUS_TG_CHAT_ID=-1001234567890
```

Перезапустить:
```bash
cd /opt/ursus && docker compose restart logvault-go
```

## 4. Проверка

В UI → Сценарии → включить `rdp-brute-force` (для теста). Затем симулировать
атаку:

```bash
for i in {1..15}; do
  echo "<13>$(date '+%b %d %H:%M:%S') test-host sshd[1234]: Failed password for root from 192.0.2.1" | \
    nc -u -w1 <URSUS_IP> 514
  sleep 1
done
```

Через ~1 минуту должно прийти сообщение:

```
🔴 RDP brute force от 192.0.2.1
24.05.2026 14:23:01

Зарегистрировано 10 неудачных попыток RDP с одного IP за 5 минут...

🖥 Хост: test-host
🏷 #rdp #bruteforce
```

## Шаблон сообщения

Шаблоны живут в Go-коде ([notifications/notifier.go](https://github.com/Din0zaBr/VSCode/blob/main/UrsusSiem/logvault-go/internal/notifications/notifier.go)). 
Перевод/кастомизация — через переменные:
- `{{.Severity}}` — critical/high/medium/low
- `{{.Title}}` — заголовок инцидента
- `{{.Description}}` — описание
- `{{.Host}}`, `{{.User}}`, `{{.Source}}`
- `{{.DetectedAt.Format "02.01.2006 15:04:05"}}`

## Дополнительные сценарии

### Несколько чатов под разные severity

В v2.0 — один `URSUS_TG_CHAT_ID`. Для нескольких каналов используйте
**webhook** (см. [webhook.md](webhook.md)) с маршрутизацией через
n8n/Make/IFTTT.

### Подавление duplicate-алертов

Каждое срабатывание SIGMA-правила имеет 5-минутный cooldown. То есть
если правило сработало в 14:23, следующее срабатывание того же правила
с теми же параметрами не отправит Telegram до 14:28.

Cooldown настраивается в YAML-сценарии:
```yaml
threshold:
  cooldown_minutes: 30   # увеличить до получаса
```

## Безопасность

- **Никогда не публикуйте токен** — кто угодно с токеном может отправлять
  сообщения от имени бота.
- Если токен утёк — через BotFather: `/revoke` → создать новый.
- Хранить токен только в `.env` с правами `chmod 600`.
