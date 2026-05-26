# Сценарии безопасности

URSUS поставляется с **20 готовыми сценариями** под типовые угрозы МСБ.
Каждый сценарий — это:
- Описание (зачем нужен)
- Severity (critical / high / medium / low)
- Связанное SIGMA-правило или threshold-правило
- MITRE ATT&CK техники
- Рекомендация оператору (что делать в первые 10 минут)

## Где они живут

`configs/scenarios/bundle.yaml` — все 20 сценариев. Загружаются URSUS
при старте через `URSUS_SCENARIOS_DIR=/etc/ursus/scenarios`.

## Полный список

| ID | Категория | Severity | MITRE | Включён по умолчанию |
|---|---|---|---|---|
| `rdp-brute-force` | auth | critical | T1110 | ✅ |
| `ssh-brute-force` | auth | critical | T1110 | ✅ |
| `ad-password-spray` | auth | high | T1110.003 | ✅ |
| `suspicious-powershell` | execution | high | T1059.001 | ✅ |
| `mimikatz-indicators` | credentials | critical | T1003.001 | ✅ |
| `lateral-movement-smb` | lateral | high | T1021.002 | ✅ |
| `1c-anomaly` | application | medium | — | ❌ (FP-prone) |
| `bitrix-attack` | web | high | T1190 | ✅ |
| `web-scanning` | recon | medium | T1595 | ✅ |
| `ransomware-mass-rename` | impact | critical | T1486 | ✅ |
| `usb-anomaly` | impact | medium | T1052.001 | ❌ (требует EDR) |
| `priv-escalation` | privilege | critical | T1068 | ✅ |
| `log-clear` | evasion | critical | T1070 | ✅ |
| `cron-as-root` | persistence | high | T1053.003 | ✅ |
| `new-service-install` | persistence | high | T1543 | ✅ |
| `kerberoasting` | credentials | critical | T1558.003 | ✅ |
| `pass-the-hash` | credentials | critical | T1550.002 | ✅ |
| `dns-tunneling` | c2 | high | T1071.004 | ✅ |
| `data-exfiltration` | exfiltration | high | T1041 | ✅ |
| `account-enumeration` | discovery | medium | T1087 | ✅ |

## Как включить

В UI: **Сценарии** → toggle. Или через API:

```bash
curl -X PATCH https://siem.example.com/api/scenarios/bundled/rdp-brute-force/toggle \
  -H "Authorization: Bearer $JWT" \
  -d '{"enabled": true}'
```

## Тонкая настройка

Каждый сценарий имеет тогглируемые параметры:

```yaml
id: rdp-brute-force
threshold:
  events: 10           # сколько событий
  window_minutes: 5    # за какое окно
  group_by: [src.ip]   # группировать по
actions: [notify_telegram, create_incident]
```

Изменения через UI применяются мгновенно. Изменения в YAML — после
перезапуска `logvault-go`.

## Добавление своих сценариев

Положите YAML-файл в `/etc/ursus/scenarios/`. URSUS подхватит при
рестарте.

```yaml
# /etc/ursus/scenarios/my-custom.yaml
scenarios:
  - id: my-custom
    name: Мой кастомный сценарий
    category: auth
    severity: medium
    enabled: true
    description: ...
    threshold: { events: 5, window_minutes: 1 }
    actions: [notify_email]
```

## SIGMA-правила (углублённый контент)

URSUS также включает **60 готовых SIGMA-правил** в
`configs/sigma_rules/*.yaml`. Они автоматически импортируются в БД при
первом запуске.

Список категорий:
- bruteforce — RDP/SSH/SMTP/FTP/web
- C2 — beaconing, Cobalt Strike, DNS-tunneling, Tor
- collection — clipboard, screenshot
- credentials — Kerberoasting, mimikatz, NTDS dump, password spray
- discovery — account/network/share enum
- exfiltration — cloud storage, HTTP POST large
- evasion — log clear, AV disable, process injection
- execution — script blocks, reverse shells
- impact — disk wipe, ransomware indicators
- lateral movement — PsExec, RDP, SMB, WMI, Pass-the-Hash
- malware — webshells, cryptominers, document macros
- persistence — cron, registry, services, SSH keys, startup
- privilege — sudo, Windows escalation
- recon — ARP scan, DNS zone transfer, LDAP enum, Nmap
- web — SQLi, XSS, scanning
- DoS — SYN flood
- insider threat — bulk download
- supply chain — package installs

Полный список (с описаниями каждого): см. файлы в
[configs/sigma_rules/](../configs/sigma_rules/).
