# Готовые сценарии URSUS SIEM

20 преднастроенных сценариев под типовые угрозы для МСБ. Каждый — отдельный
YAML с тогглом, порогами и связанными SIGMA-правилами. URSUS загружает их
при старте; UI отображает на странице **«Сценарии»** с toggle-кнопками.

## Структура YAML

```yaml
id:           short-kebab-id            # уникальный
name:         Человекочитаемое имя
category:     auth | malware | recon | ...
severity:     critical | high | medium | low
enabled:      true
description:  что детектится и почему важно
mitre:        [T1110, T1078]            # ATT&CK techniques
sigma_rules:  [rule_id_1, rule_id_2]    # ссылки на yaml в data/sigma_rules/
threshold:                              # необязательно: для порогов
  events:        10
  window_minutes: 5
  group_by:      [src.ip, user]
actions:                                # что делать при срабатывании
  - notify:    telegram,email
  - severity:  critical
remediation:  |                         # совет оператору в UI
  Что сделать в первые 5 минут после срабатывания.
```

## Список сценариев

| ID | Сценарий | Severity | MITRE |
|---|---|---|---|
| rdp-brute-force | Bruteforce RDP-доступа | critical | T1110 |
| ssh-brute-force | Bruteforce SSH-доступа | critical | T1110 |
| ad-password-spray | Password spray по AD | high | T1110.003 |
| suspicious-powershell | Подозрительный PowerShell | high | T1059.001 |
| mimikatz-indicators | Mimikatz активность | critical | T1003.001 |
| lateral-movement-smb | Боковое перемещение через SMB | high | T1021.002 |
| 1c-anomaly | Аномалия активности 1С | medium | — |
| bitrix-attack | Атаки на Bitrix | high | T1190 |
| web-scanning | Сканирование web-приложений | medium | T1595 |
| ransomware-mass-rename | Признаки шифровальщика | critical | T1486 |
| usb-anomaly | Подозрительные USB-устройства | medium | T1052.001 |
| priv-escalation | Эскалация привилегий | critical | T1068 |
| log-clear | Очистка логов | critical | T1070 |
| cron-as-root | Новые root-задания cron | high | T1053.003 |
| new-service-install | Установка новых служб | high | T1543 |
| kerberoasting | Kerberoasting запросы | critical | T1558.003 |
| pass-the-hash | Pass-the-Hash | critical | T1550.002 |
| dns-tunneling | DNS-туннелирование | high | T1071.004 |
| data-exfiltration | Большой исходящий трафик | high | T1041 |
| account-enumeration | Перебор учётных записей | medium | T1087 |

## Как включить

В UI: страница **Сценарии** → toggle. Также:

```bash
curl -X PATCH http://localhost:8080/api/scenarios/rdp-brute-force/toggle \
  -H "Authorization: Bearer $JWT" \
  -d '{"enabled": true}'
```

## Тонкая настройка

Каждое поле в YAML можно переопределить per-tenant через UI или
`PATCH /api/scenarios/:id`. Файл — это **дефолт**, не жёсткая константа.
