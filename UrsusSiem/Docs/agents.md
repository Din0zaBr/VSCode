# Установка и настройка агентов

Агент URSUS SIEM — это лёгкая программа, которая читает системные журналы и отправляет события на сервер SIEM по REST API. Агент поддерживает Linux с systemd.

---

## Требования к хосту агента

- Linux с systemd (Ubuntu 18.04+, Debian 10+, CentOS 7+, RHEL 8+, Fedora 35+)
- Python 3.8+ (стандартно присутствует в большинстве дистрибутивов)
- Доступ к серверу SIEM по HTTP (порт 8000)
- API-ключ (получить у администратора)

---

## Получение API-ключа

1. Войдите в SIEM как администратор
2. Перейдите в **Администрирование → API ключи**
3. Нажмите **+ Создать ключ**, введите имя (например: `prod-server-01`)
4. Скопируйте ключ — он показывается **только один раз**

Формат ключа: `ursus-<40 символов>`

---

## Метод 1: Скрипт нативного агента (рекомендуется)

### Загрузка и установка

```bash
# Загрузить скрипт установки с сервера SIEM
curl -o agent-linux.sh http://<SIEM_HOST>:8000/agent/install-native
chmod +x agent-linux.sh

# Установить агент
sudo ./agent-linux.sh \
  --server http://<SIEM_HOST>:8000 \
  --key ursus-ваш_ключ \
  --agent-id имя-этого-хоста
```

### Что делает скрипт

1. Создаёт виртуальное окружение Python в `/opt/ursus-agent/`
2. Устанавливает зависимости (`requests`)
3. Создаёт конфигурационный файл `/opt/ursus-agent/config.env`
4. Регистрирует systemd-сервис `ursus-agent`
5. Включает автозапуск и стартует сервис

### Проверка работы

```bash
# Статус сервиса
sudo systemctl status ursus-agent

# Просмотр логов агента
sudo journalctl -u ursus-agent -f

# Проверка подключения
sudo journalctl -u ursus-agent --since "5 minutes ago" | grep "Sent batch"
```

### Удаление агента

```bash
sudo ./agent-linux.sh --uninstall
```

---

## Метод 2: Docker-агент

```bash
# Загрузить конфигурацию
curl -o docker-compose.agent.yml http://<SIEM_HOST>:8000/agent/compose

# Запустить
SIEM_URL=http://<SIEM_HOST>:8000 \
SIEM_API_KEY=ursus-ваш_ключ \
AGENT_ID=имя-хоста \
docker compose -f docker-compose.agent.yml up -d
```

---

## Ручная установка агента

Если автоматическая установка недоступна, создайте агент вручную.

### Шаг 1. Создание директории и окружения

```bash
sudo mkdir -p /opt/ursus-agent
cd /opt/ursus-agent
python3 -m venv venv
./venv/bin/pip install requests
```

### Шаг 2. Конфигурационный файл

`/opt/ursus-agent/config.env`:

```bash
SIEM_URL=http://<SIEM_HOST>:8000
SIEM_API_KEY=ursus-ваш_ключ
AGENT_ID=имя-хоста
BATCH_SIZE=100
BATCH_INTERVAL=5
```

### Шаг 3. Скрипт агента

`/opt/ursus-agent/agent.py`:

```python
#!/usr/bin/env python3
"""URSUS SIEM Agent — minimal log forwarder."""
import os, time, json, socket, datetime, requests

SIEM_URL    = os.environ["SIEM_URL"]
API_KEY     = os.environ["SIEM_API_KEY"]
AGENT_ID    = os.environ.get("AGENT_ID", socket.gethostname())
BATCH_SIZE  = int(os.environ.get("BATCH_SIZE", "100"))
INTERVAL    = int(os.environ.get("BATCH_INTERVAL", "5"))

LOG_FILES = [
    "/var/log/syslog",
    "/var/log/auth.log",
    "/var/log/messages",
    "/var/log/secure",
]

def tail_file(path, positions):
    try:
        with open(path) as f:
            f.seek(positions.get(path, 0))
            lines = f.readlines()
            positions[path] = f.tell()
        return lines
    except (FileNotFoundError, PermissionError):
        return []

def send_batch(logs):
    try:
        r = requests.post(
            f"{SIEM_URL}/ingest",
            headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"},
            data=json.dumps({"logs": logs}),
            timeout=10
        )
        return r.status_code == 200
    except Exception as e:
        print(f"Send error: {e}")
        return False

positions = {}
while True:
    batch = []
    for log_file in LOG_FILES:
        for line in tail_file(log_file, positions):
            line = line.strip()
            if not line:
                continue
            batch.append({
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "host": socket.gethostname(),
                "agent_id": AGENT_ID,
                "message": line,
                "source": os.path.basename(log_file),
            })
            if len(batch) >= BATCH_SIZE:
                send_batch(batch)
                batch = []
    if batch:
        send_batch(batch)
    time.sleep(INTERVAL)
```

### Шаг 4. Systemd Unit

`/etc/systemd/system/ursus-agent.service`:

```ini
[Unit]
Description=URSUS SIEM Agent
After=network.target

[Service]
Type=simple
EnvironmentFile=/opt/ursus-agent/config.env
ExecStart=/opt/ursus-agent/venv/bin/python /opt/ursus-agent/agent.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
User=root

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ursus-agent
```

---

## Мониторинг агентов в SIEM

После подключения агент появляется в:

- **Активы → Агенты** — список агентов, статус online/offline, метрики CPU/RAM
- **Dashboard** — счётчик активных агентов
- **Events** — фильтр по `agent_id`

**Статус агента**:
- 🟢 **Online** — событие получено менее 5 минут назад
- 🔴 **Offline** — нет событий более 5 минут

---

## Настройка отслеживаемых файлов

Добавьте пути к журналам в переменную `LOG_FILES` в скрипте агента или в его конфигурацию:

| Дистрибутив | Основные журналы |
|-------------|-----------------|
| Ubuntu/Debian | `/var/log/syslog`, `/var/log/auth.log` |
| RHEL/CentOS | `/var/log/messages`, `/var/log/secure` |
| Fedora | `/var/log/messages`, `/run/log/journal` |
| Nginx | `/var/log/nginx/access.log`, `/var/log/nginx/error.log` |
| Apache | `/var/log/apache2/access.log`, `/var/log/apache2/error.log` |
| PostgreSQL | `/var/log/postgresql/*.log` |

---

## Отправка метрик системы

Для отправки метрик CPU/RAM добавьте к телу запроса:

```python
import psutil

meta = {
    "cpu_percent": psutil.cpu_percent(interval=1),
    "mem_percent": psutil.virtual_memory().percent,
    "disk_percent": psutil.disk_usage("/").percent,
}
```

---

## Множественные агенты и операторы

Администратор может привязать агентов к операторам:

1. **Администрирование → Пользователи**
2. Выберите оператора → **Назначить агентов**
3. Отметьте нужные agent_id

Оператор будет видеть только события своих агентов.

---

## Устранение неполадок

| Проблема | Причина | Решение |
|----------|---------|---------|
| `401 Unauthorized` | Неверный API-ключ | Проверить ключ в `/opt/ursus-agent/config.env` |
| `Connection refused` | Неверный URL сервера | Проверить `SIEM_URL`, доступность порта 8000 |
| Агент не появляется в SIEM | Нет событий | `journalctl -u ursus-agent -f` — смотреть ошибки |
| Агент offline сразу после запуска | Журналы не читаются | Запустить агент от `root` или настроить права на файлы |
| Много дублирующихся событий | Позиция сброшена | Агент хранит позиции в памяти; при перезапуске читает с начала (нормально) |

---

## Безопасность

- API-ключи хранятся в БД в открытом виде — защитите доступ к PostgreSQL
- Используйте HTTPS (Caddy с TLS) для шифрования трафика агент → SIEM
- Минимальные права агента: read-only доступ к файлам журналов
- Ротируйте ключи раз в 90 дней: удалите старый → создайте новый → обновите `config.env`
