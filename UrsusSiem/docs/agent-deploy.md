# Установка агентов сбора логов

URSUS не имеет жёсткой привязки к одному агенту. **Используйте Vector** для
большинства случаев — это стандарт индустрии, у него больше входных форматов,
он быстрее. Свой `logvault-agent` оставляем для EDR-функций (v2.2).

## Vector — рекомендуемый путь

### Linux

```bash
# 1. Установка Vector
curl -1sLf https://repositories.timber.io/public/vector/setup.deb.sh | sudo -E bash
sudo apt-get install -y vector

# 2. Профиль URSUS
sudo curl -fsSL \
  https://raw.githubusercontent.com/Din0zaBr/VSCode/main/UrsusSiem/integrations/vector/linux-server.yaml \
  -o /etc/vector/vector.yaml

# 3. Конфиг подключения
sudo tee /etc/default/vector >/dev/null <<EOF
URSUS_SERVER=https://siem.example.com
URSUS_API_KEY=<API_KEY_FROM_URSUS_UI>
EOF

# 4. Запуск
sudo systemctl restart vector
sudo journalctl -u vector -f
```

### Windows

```powershell
# 1. Скачать Vector
Invoke-WebRequest https://packages.timber.io/vector/0.40.0/vector-0.40.0-x86_64-pc-windows-msvc.zip -OutFile vector.zip
Expand-Archive vector.zip -DestinationPath 'C:\Program Files\Vector'

# 2. Конфиг
Copy-Item windows-server.yaml 'C:\Program Files\Vector\config\vector.yaml'

# 3. Переменные окружения
[Environment]::SetEnvironmentVariable('URSUS_SERVER', 'https://siem.example.com', 'Machine')
[Environment]::SetEnvironmentVariable('URSUS_API_KEY', '<API_KEY>', 'Machine')

# 4. Регистрация службы
New-Service -Name Vector -BinaryPathName '"C:\Program Files\Vector\bin\vector.exe" --config "C:\Program Files\Vector\config\vector.yaml"'
Start-Service Vector
```

### Сетевые устройства (Cisco/MikroTik/pfSense)

Сетевые устройства редко поддерживают HTTP — они шлют syslog UDP/TCP 514.
URSUS принимает syslog **напрямую** — см. [syslog.md](syslog.md).

Если нужен DMZ-relay (TLS, агрегация) — поднимите Vector с профилем
[`network-syslog.yaml`](https://github.com/Din0zaBr/VSCode/blob/main/UrsusSiem/integrations/vector/network-syslog.yaml).

## Свой `logvault-agent`

Используется только если:
- Нужен EDR-функционал (процессы, USB, FIM) — Pro-tier фича из v2.2
- Vector нельзя установить (нет admin-прав, минималистичный embedded-Linux)

Установка одной командой (агент скачается с URSUS-сервера):

```bash
curl -fsSL http://<URSUS>:8080/agent/install | sudo bash -s -- --key <API_KEY>
```

Подробности по EDR-функциям: [edr.md](edr.md) (после v2.2 релиза).

## Проверка после установки

1. UI URSUS → раздел **«Агенты»** — новый агент появится в течение минуты
2. UI → **«Live Logs»** — должны течь события от хоста
3. Если ничего не происходит:
   - `sudo journalctl -u vector -f` — смотреть Vector-ошибки
   - `curl -fsSL http://<URSUS>:8080/health` — API живой?
   - `iptables -L INPUT -n | grep 514` — открыт ли syslog-порт?
