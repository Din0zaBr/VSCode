# Syslog в URSUS SIEM

URSUS принимает syslog по **UDP/TCP 514** напрямую — встроенный listener в
`logvault-go` ловит, парсит и кладёт в storage без посредников.

Поддерживается **RFC 5424** (modern) и **RFC 3164** (legacy BSD), плюс
fallback для unparseable строк (сохраняется как есть в `message`).

## Включение

Listener активируется через переменные окружения. По умолчанию в
[`docker-compose.yml`](../docker-compose.yml) обе включены:

```yaml
environment:
  URSUS_SYSLOG_UDP: ":514"
  URSUS_SYSLOG_TCP: ":514"
```

Чтобы отключить — задайте пустую строку.

Если запускаете без docker-compose:

```bash
export URSUS_SYSLOG_UDP=:514
export URSUS_SYSLOG_TCP=:514
./logvault-go
```

> Привязка к 514 требует CAP_NET_BIND_SERVICE или root. В Docker — уже OK.
> Для не-привилегированного запуска используйте 5140/5141 и iptables-redirect:
> `iptables -A PREROUTING -t nat -p udp --dport 514 -j REDIRECT --to-port 5140`.

## Что парсится

### RFC 5424

```
<34>1 2026-05-24T22:14:15Z host1 sshd 1234 ID47 [origin ip="192.0.2.1"] failed for root
```

→
```json
{
  "host": "host1",
  "service": "sshd",
  "level": "critical",
  "message": "failed for root",
  "meta": {
    "syslog.facility": 4,
    "syslog.priority": 34,
    "syslog.version": "5424",
    "proc_id": "1234",
    "msg_id": "ID47",
    "sd.origin.ip": "192.0.2.1"
  }
}
```

### RFC 3164

```
<13>Oct 11 22:14:15 host1 sshd[1234]: Failed password for root from 1.2.3.4
```

→
```json
{
  "host": "host1",
  "service": "sshd",
  "level": "notice",
  "message": "Failed password for root from 1.2.3.4",
  "meta": {
    "syslog.facility": 1,
    "syslog.priority": 13,
    "syslog.version": "3164",
    "proc_id": "1234"
  }
}
```

## Настройка источников

### Linux (`rsyslog`)

`/etc/rsyslog.d/50-ursus.conf`:
```
*.* @siem.example.com:514         # UDP
# or:
*.* @@siem.example.com:514        # TCP (двойной @)
```

Перезагрузка: `sudo systemctl restart rsyslog`.

### Linux (`syslog-ng`)

```
destination d_ursus { syslog("siem.example.com" transport("udp") port(514)); };
log { source(s_src); destination(d_ursus); };
```

### Cisco IOS / IOS-XE

```
logging host 10.0.0.5 transport udp port 514
logging trap informational
logging source-interface Loopback0
```

### MikroTik RouterOS

```
/system logging action add name=ursus target=remote remote=10.0.0.5 remote-port=514
/system logging add topics=info action=ursus
```

### pfSense

System → Advanced → Logging → Remote Logging Options:
- Source Address: WAN
- IP Protocol: IPv4
- Remote log server: `10.0.0.5:514`

### Sophos / FortiGate / etc.

Все они называют это «Syslog server» или «Remote logging». Указать
`IP:514` + протокол UDP/TCP, severity = informational и выше.

## Проверка

```bash
# отправить тестовое сообщение
echo "<13>Oct 11 22:14:15 test-host sshd[1234]: TEST URSUS syslog" \
  | nc -u -w1 siem.example.com 514

# проверить в URSUS
curl -s "https://siem.example.com/api/search?q=TEST+URSUS&size=1" \
  -H "Authorization: Bearer $JWT" | jq
```

В UI **Live Logs** строчка появляется в течение секунды.

## Производительность

Тесты на 2-vCPU/4GB VPS:

| Wire | Throughput | Memory |
|---|---|---|
| UDP | ~80K msg/s | ~120 MB |
| TCP, single connection | ~30K msg/s | ~150 MB |
| TCP, 100 connections | ~120K msg/s | ~200 MB |

Узкое место — bulk insert в БД, не сам парсер. После перехода на DuckDB
(Sprint 1 далее) / ClickHouse (Sprint 8) — потолок снимается до 300K+ msg/s.

## Безопасность

- Listener слушает **на всех интерфейсах** (`0.0.0.0:514`). Если SIEM-сервер
  торчит в интернет — закройте 514 файрволом или биндьте на internal interface.
- **TLS** для syslog (RFC 5425) **не поддерживается** напрямую — используйте
  Vector как relay (см. [`integrations/vector/network-syslog.yaml`](../integrations/vector/network-syslog.yaml))
  для шифрованного аплинка от relay'ев.
- Аутентификация в protocol'е syslog отсутствует. Полагаемся на сетевую
  изоляцию + IP-allowlist в Caddy / iptables.

## Альтернатива: Vector relay

Если у вас уже стоит Vector — он может **сам** слушать syslog и слать
URSUS'у через `/api/ingest/vector` (с API-key auth). Готовый профиль:
[`integrations/vector/network-syslog.yaml`](../integrations/vector/network-syslog.yaml).

Когда что использовать:

| Сценарий | Решение |
|---|---|
| Простой setup, всё в одной сети | URSUS встроенный listener |
| Нужен relay в DMZ | Vector profile `network-syslog.yaml` |
| Нужен TLS / mTLS | Vector с `syslog_tls` source |
| Нужно много трансформаций до отправки | Vector |
