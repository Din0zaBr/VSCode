# agent/ — URSUS SIEM агент сбора логов

Лёгкий Python-агент. Альтернатива Vector для случаев когда:
- нужны **EDR-функции** (процессы, USB, FIM) — Vector это не умеет
- Vector нельзя установить (минималистичный embedded-Linux)

Для **обычного сбора логов** рекомендуем Vector — см.
[../integrations/vector/](../integrations/vector/).

## Структура

```
agent/
├── src/
│   ├── main.py            # точка входа
│   ├── buffer.py          # буферизация при потере связи
│   ├── config.py          # парсинг config.yaml
│   ├── models.py          # типы событий
│   ├── readers/           # источники событий
│   │   ├── file_reader.py        # файловые логи (tail -F)
│   │   ├── journald_reader.py    # systemd journal
│   │   └── winevent_reader.py    # Windows Event Log
│   ├── transport/         # отправка на сервер
│   │   └── http.py        # HTTP POST /api/ingest
│   └── edr/               # 🔴 v2.2 — EDR-расширения
│       ├── processes.py          # снимки процессов
│       ├── connections.py        # сетевые соединения
│       ├── file_integrity.py     # inotify / ReadDirectoryChangesW
│       └── usb.py                # USB-события
│
├── windows/
│   ├── scripts/           # PowerShell install/configure/test
│   └── examples/          # config-профили (compliance, forensics, audit)
│
├── Dockerfile, Dockerfile.build  # сборка Docker-образа
├── install.sh             # systemd installer для Linux
├── uninstall.sh
├── install-windows.ps1    # Windows service installer
├── docker-compose.yml     # запуск через Docker
├── config.yaml            # пример конфига
├── requirements.txt       # Python зависимости (Linux)
└── requirements-windows.txt
```

## Установка

### Linux (systemd)

```bash
curl -fsSL http://<URSUS>:8080/agent/install | sudo bash -s -- --key <API_KEY>
```

### Linux (Docker)

```bash
cd agent
cp config.yaml /etc/ursus-agent/config.yaml
docker compose up -d
```

### Windows

```powershell
# Скачать установщик с URSUS
Invoke-WebRequest "http://<URSUS>:8080/agent/install" -OutFile install-windows.ps1
.\install-windows.ps1 -ApiKey "<API_KEY>" -ServerUrl "http://<URSUS>:8080"
```

## Конфигурация

См. `config.yaml` (закомментированный пример) и
[`docs/agent-deploy.md`](../docs/agent-deploy.md).
