# Локальный запуск URSUS SIEM

Эта инструкция покажет как **за 5–10 минут** на твоей машине поднять:

1. **Сервер** — `gateway` (Go) + `engine` (Rust) + Postgres + UI + Caddy
2. **Агент** — Python-агент, который собирает логи с твоего же хоста
3. Проверить **end-to-end**: лог появился на хосте → улетел в сервер →
   виден в UI с правильной интерпретацией (severity, source, parsed fields).

Всё проверяемо локально. Никаких облаков, VPS, продакшен-сертификатов.

---

## 0. Что должно быть установлено

### Linux (Ubuntu 22.04+ / Debian 12+)

```bash
# Docker + Docker Compose (нужно для сервера)
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER    # затем выйди-зайди

# Python 3.10+ (для агента)
sudo apt-get install -y python3 python3-pip python3-venv

# Утилиты
sudo apt-get install -y git curl jq netcat-openbsd
```

### Windows 10/11

1. **Docker Desktop** — <https://www.docker.com/products/docker-desktop>
   После установки → запусти, дождись «Engine running» в трее.
2. **Git for Windows** — <https://git-scm.com/download/win>
   При установке включи «Git from the command line» (PATH).
3. **Python 3.10+** — <https://www.python.org/downloads/windows/>
   При установке поставь галочку «Add Python to PATH».
4. **PowerShell 5.1** уже есть в Windows — пользуемся им.

### Проверка

```bash
docker --version           # >= 24.0
docker compose version     # >= 2.20
python3 --version          # >= 3.10 (на Windows: python --version)
git --version              # >= 2.40
```

Минимум железа: **2 CPU / 4 GB RAM / 10 GB диска**. На Windows Docker
Desktop откусит ~2 GB сам по себе.

---

## 1. Клон репо

```bash
# Любая папка где есть права записи
cd ~          # Linux
# или
cd $env:USERPROFILE     # Windows PowerShell

git clone https://github.com/Din0zaBr/VSCode.git ursus
cd ursus/UrsusSiem
```

Дальше все команды **из папки `UrsusSiem`**. Если у тебя путь другой —
адаптируй `cd`.

---

## 2. Запуск сервера (один command)

```bash
cd deploy
cp .env.example .env
docker compose up -d
```

Что произойдёт:
1. Скачаются образы (~700 MB суммарно: Postgres, Caddy, Node, базы).
2. Соберутся локально: `engine` (Rust, ~3 мин в первый раз), `gateway`
   (Go, ~1 мин), `ui` (Vite build, ~30 сек).
3. Запустятся 5 контейнеров: `postgres`, `engine`, `gateway`, `ui`, `caddy`.

Прогресс смотри так:
```bash
docker compose ps
docker compose logs -f gateway     # Ctrl+C чтобы выйти из tail
```

### Когда сервер готов

```bash
curl http://localhost:8080/health
# должен вернуть: {"status":"ok","engine":true}

curl http://localhost:8080/metrics | head -5
# # HELP ursus_uptime_seconds Process uptime in seconds.
```

Если ответ есть — **сервер работает**.

### Точки входа

| URL | Что |
|---|---|
| <http://localhost/> | Web UI (через Caddy на 80) |
| <http://localhost:8080/api> | REST API (напрямую без Caddy) |
| <http://localhost:8080/health> | Health-check |
| <http://localhost:8080/metrics> | Prometheus метрики |
| `localhost:514/udp` и `localhost:514/tcp` | Syslog listener |
| `localhost:5432` | Postgres (если хочешь подключиться руками) |

---

## 3. Вход в UI

Открой <http://localhost/> в браузере.

### Где взять пароль

`.env.example` (который ты скопировал в `deploy/.env`) ставит **дефолтный
admin-пароль `ChangeMe!2026`** через bcrypt-хеш, но он там как
placeholder. Чтобы получить рабочий пароль — два варианта:

**Вариант A: используй встроенный fallback admin.** В `deploy/.env`
по умолчанию админ создаётся из переменных:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2a$12$placeholder...    # ← это в .env.example
```

Это плацхолдер. Чтобы войти, замени хеш на реальный.

**Вариант B: сгенерируй пароль.** В терминале (на ходящей машине с Go):

```bash
cd ../tools
go run gen-password-hash.go MyTestPass123
# выведет: $2a$12$rEoX...... (это bcrypt-хеш)
```

Если **Go нет** — сгенерируй через Python:

```bash
python3 -c "import bcrypt; print(bcrypt.hashpw(b'MyTestPass123', bcrypt.gensalt(rounds=12)).decode())"
# если bcrypt нет: pip install bcrypt
```

Скопируй вывод и положи в `deploy/.env`:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2a$12$rEoXxxxxxxxx....
```

Перезапусти gateway:
```bash
cd deploy
docker compose restart gateway
```

Теперь в UI:
- **Username:** `admin`
- **Password:** `MyTestPass123` (тот что ты хешировал)

### Если совсем не получается войти

Создай пользователя через SQL напрямую:

```bash
docker compose exec postgres psql -U logvault -d logvault -c \
  "INSERT INTO users (username, password_hash, role) VALUES ('admin', '\$2a\$12\$rEoXxxxxxx', 'admin') ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;"
```

Замени `$2a$12$rEoX...` на свой реальный bcrypt-хеш.

---

## 4. Smoke-тест сервера (без агента)

Прямо в терминале отправь тестовый syslog → найди его в UI.

### Linux

```bash
# Отправь syslog UDP 514
echo "<13>$(date '+%b %d %H:%M:%S') test-host sshd[1234]: Failed password for root from 192.0.2.1" \
  | nc -u -w1 localhost 514
```

### Windows

```powershell
# Установи Test-NetConnection (там же где cmdkey)
$bytes = [Text.Encoding]::ASCII.GetBytes("<13>Oct 11 22:14:15 test-host sshd[1234]: Failed password for root from 192.0.2.1")
$udp = New-Object System.Net.Sockets.UdpClient
$udp.Send($bytes, $bytes.Length, "localhost", 514) | Out-Null
$udp.Close()
```

Открой UI → раздел **Live Logs** (или Events). В течение ~1 секунды
должно появиться:

```
host:    test-host
service: sshd
level:   notice    ← правильно: pri 13 = facility 1 (user) + severity 5 (notice)
message: Failed password for root from 192.0.2.1
meta.syslog.version: 3164
meta.proc_id: 1234
```

Если видишь — **парсер работает, severity маппится правильно**.

### Через REST API (без syslog)

Получи JWT-токен:
```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"MyTestPass123"}' | jq -r '.token')
echo $TOKEN     # должен быть длинный eyJ...
```

Поищи события:
```bash
curl -s "http://localhost:8080/api/search?q=Failed&size=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.hits[].message'
```

---

## 5. Запуск агента локально

Агент будет читать **свои собственные** логи и слать их в локальный сервер.

### Linux: запуск через Python (без Docker)

```bash
cd ~/ursus/UrsusSiem/agent

# Виртуальное окружение
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Получи API-ключ из .env сервера
grep API_KEYS ../deploy/.env
# например: API_KEYS=changeme-agent-key  (или random если запускал install.sh)

# Минимальный config
cat > /tmp/ursus-agent.yaml <<EOF
server_url: http://localhost:8080
api_key:    changeme-agent-key
agent_id:   $(hostname)

buffer:
  path: /tmp/ursus-agent-buffer.db
  flush_interval_seconds: 5
  max_batch: 100

readers:
  - type: file
    paths:
      - /var/log/auth.log
      - /var/log/syslog
  - type: journald
    units: [sshd, cron]
EOF

# Запуск (foreground, чтобы видеть что происходит)
python -m src.main --config /tmp/ursus-agent.yaml
```

Должно появиться:
```
INFO ursus-agent started agent_id=hostname
INFO file_reader tail /var/log/auth.log
INFO journald_reader subscribed sshd, cron
INFO transport sending batch size=15
INFO transport ok inserted=15
```

### Windows: запуск через Python

```powershell
cd $env:USERPROFILE\ursus\UrsusSiem\agent

# venv + deps
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-windows.txt

# Config
$config = @'
server_url: http://localhost:8080
api_key:    changeme-agent-key
agent_id:   {0}

buffer:
  path: C:\Temp\ursus-agent-buffer.db
  flush_interval_seconds: 5
  max_batch: 100

readers:
  - type: winevent
    channels:
      - System
      - Security
      - Application
'@ -f $env:COMPUTERNAME

mkdir -Force C:\Temp | Out-Null
$config | Out-File -Encoding utf8 C:\Temp\ursus-agent.yaml

# Запуск
python -m src.main --config C:\Temp\ursus-agent.yaml
```

### Альтернатива: агент через Docker (если Python проблематичен)

```bash
cd agent
docker build -t ursus-agent .
docker run --rm -it \
  --network=urssussiem_default \
  -v /var/log:/host/log:ro \
  -e SERVER_URL=http://gateway:8080 \
  -e API_KEY=changeme-agent-key \
  -e AGENT_ID=docker-host \
  ursus-agent
```

(Имя сети может отличаться — `docker network ls` покажет реальное.)

---

## 6. Проверка end-to-end

С работающим агентом — на той же машине вызови событие, которое агент
должен поймать:

### Linux: создать failed-login

```bash
# Прикинься что не знаешь пароля sudo
sudo -k && sudo -n true 2>/dev/null
# auth.log получит строку "authentication failure"
```

Или прямо в журналд:
```bash
logger -p auth.notice "TEST-URSUS-EVENT-$(date +%s)"
```

### Windows: создать событие в Event Log

```powershell
# Создаст запись в Application log
Write-EventLog -LogName Application -Source "URSUS-Test" -EventId 1001 `
  -EntryType Warning -Message "TEST-URSUS-EVENT $(Get-Date -Format 'yyyyMMdd-HHmmss')"
```

(Если `URSUS-Test` source ещё не зарегистрирован:
```powershell
New-EventLog -LogName Application -Source "URSUS-Test"
```
один раз от админа.)

### Найди событие в UI

В UI → Events → введи в поиск `TEST-URSUS-EVENT` → должны увидеть его в
течение 5–10 секунд (агент шлёт батчами).

**Что проверить взглядом:**
- `host` — имя твоей машины
- `agent_id` — то что в config.yaml
- `service` — `sshd` / `cron` / источник Windows-лога
- `level` — правильно определён (notice / warning / error)
- `meta.parsed_at` — недавнее время
- `meta.syslog.facility` — числовое значение

Если поля корректны — **парсер+enrichment работают**, события правильно
интерпретированы.

---

## 7. Включение готовых сценариев

В UI → Сценарии → включи `rdp-brute-force` или `ssh-brute-force`
(они сделаны под популярные атаки).

Затем сэмулируй атаку:
```bash
# 15 раз неудачно подключайся к SSH
for i in {1..15}; do
  sshpass -p wrongpass ssh -o StrictHostKeyChecking=no \
    -o ConnectTimeout=1 root@localhost true 2>/dev/null
  sleep 0.3
done
```

(Если SSH не запущен — лог-симуляция через logger:
```bash
for i in {1..15}; do
  logger -p auth.notice -t sshd "Failed password for root from 192.0.2.100 port 1234 ssh2"
  sleep 0.3
done
```)

В UI → **Incidents** → должен появиться `rdp-brute-force` или
`ssh-brute-force` инцидент через 1–2 минуты (cooldown).

Если в `.env` настроен Telegram — придёт уведомление.

---

## 8. Остановка / перезапуск / cleanup

```bash
cd deploy

# Остановить (данные сохраняются)
docker compose stop

# Перезапустить
docker compose restart

# Полностью удалить контейнеры (данные в volumes остаются)
docker compose down

# Удалить ВСЁ ВКЛЮЧАЯ ДАННЫЕ ПОЛЬЗОВАТЕЛЕЙ И ЛОГИ
docker compose down -v

# Логи конкретного сервиса
docker compose logs -f gateway
docker compose logs -f engine
docker compose logs -f postgres

# Внутрь контейнера
docker compose exec gateway sh
docker compose exec postgres psql -U logvault -d logvault
```

---

## 9. Частые проблемы

### «Port 514 is already in use»

На Linux часто rsyslog или systemd-journald держит 514. Останови:
```bash
sudo systemctl stop rsyslog || true
sudo systemctl stop systemd-journald-audit.socket || true
```
Или в `deploy/docker-compose.yml` поменяй `"514:514/udp"` на
`"5140:514/udp"` — будешь слать на 5140 а внутри гейтвея слушать 514.

### `engine unreachable` в логах gateway

Engine собирается долго (Rust release). Подожди 3–5 минут после
`docker compose up -d`. Состояние:
```bash
docker compose ps engine
# должно быть "(healthy)"
```

### UI говорит «Backend unreachable»

Проверь Caddy:
```bash
docker compose logs caddy
```
И что `gateway` отвечает:
```bash
curl http://localhost:8080/health
```

### Агент молчит, событий нет

```bash
# 1. Что говорит сам агент?
# (в той же сессии где запустил `python -m src.main`)

# 2. Server принимает?
curl -X POST http://localhost:8080/api/ingest \
  -H "X-Api-Key: changeme-agent-key" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"manual","logs":[{"timestamp":"2026-05-26T20:00:00Z","host":"localhost","message":"manual test","level":"info","service":"test"}]}'
# должен ответить {"ok":true,"indexed":1,"errors":0}
```

### «Failed to login: invalid credentials»

`ADMIN_PASSWORD_HASH` в `.env` неправильный. Сгенерируй заново
(см. раздел 3) и `docker compose restart gateway`.

---

## 10. Что должно работать после полного прогона

- [x] `docker compose up -d` поднимает все 5 контейнеров без ошибок
- [x] `curl localhost:8080/health` → `{"status":"ok"}`
- [x] Браузер открывает <http://localhost/> и показывает форму логина
- [x] Логин через admin + bcrypt-пароль работает
- [x] Syslog `nc -u localhost 514` приводит к событию в UI
- [x] Python-агент стартует и шлёт батчи
- [x] Реальные системные логи (`/var/log/auth.log`) отображаются с
      правильным `service`, `level`, `host`
- [x] Включённый сценарий `ssh-brute-force` создаёт инцидент после серии
      неудачных логинов
- [x] Если настроен Telegram — критический инцидент приходит в чат

Если по каждому пункту галка — **локальный стенд полностью рабочий**.

---

## Что дальше

- [Production deploy](../deploy/README.md) — на VPS через `install.sh`
- [API reference](api.md) — полный список endpoints
- [Compliance report ФСТЭК №21](compliance/fstec-21.md) — генерация PDF
- [Troubleshooting](troubleshooting.md) — типовые проблемы
