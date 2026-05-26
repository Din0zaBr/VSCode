# Правила корреляции

Движок корреляции URSUS SIEM проверяет правила каждые 30 секунд и создаёт алерты при совпадении условий.

---

## Типы правил

### 1. Пороговые правила (Threshold)

Срабатывают, когда за заданный промежуток времени накапливается определённое количество событий, соответствующих паттерну.

**Пример — обнаружение перебора паролей:**

```json
{
  "name": "SSH Brute Force",
  "severity": "HIGH",
  "enabled": true,
  "conditions": {
    "type": "threshold",
    "field": "message",
    "pattern": "Failed password",
    "threshold": 10,
    "window_seconds": 300,
    "group_by": "src.ip"
  }
}
```

Это правило сработает, если с одного IP-адреса придёт 10+ неудачных попыток SSH-входа за 5 минут.

**Параметры пороговых правил:**

| Параметр | Тип | Описание |
|----------|-----|---------|
| `type` | string | `"threshold"` |
| `field` | string | Поле для поиска (message, level, source…) |
| `pattern` | string | Подстрока для поиска в field |
| `threshold` | int | Количество совпадений для срабатывания |
| `window_seconds` | int | Временное окно проверки (секунды) |
| `group_by` | string | Поле группировки (например, `src.ip`, `host`) |

---

### 2. Pattern-правила

Срабатывают при нахождении любого события, соответствующего паттерну (без порога).

```json
{
  "name": "Создание нового пользователя",
  "severity": "MEDIUM",
  "conditions": {
    "type": "pattern",
    "field": "message",
    "pattern": "new user:"
  }
}
```

---

## Уровни критичности

| Severity | Описание |
|----------|---------|
| `LOW` | Информационное событие |
| `MEDIUM` | Требует внимания |
| `HIGH` | Потенциальная угроза |
| `CRITICAL` | Немедленное реагирование |

---

## SIGMA-правила

Каждое правило корреляции поддерживает SIGMA-формат. SIGMA хранится в поле `sigma_rule` (строка YAML) и отображается в редакторе.

### Структура SIGMA-правила

```yaml
title: SSH Brute Force Detection
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
status: stable
description: Обнаружение многочисленных неудачных попыток SSH-входа
references:
  - https://attack.mitre.org/techniques/T1110/001/
author: URSUS SIEM
date: 2025/01/15
tags:
  - attack.credential_access
  - attack.t1110.001
logsource:
  category: authentication
  product: linux
detection:
  keywords:
    - 'Failed password'
    - 'authentication failure'
  timeframe: 5m
  condition: keywords | count() > 10
fields:
  - src.ip
  - host
  - message
falsepositives:
  - Legitimate admin operations
  - Automated testing systems
level: high
```

### Примеры SIGMA-правил

#### Обнаружение ransomware

```yaml
title: Ransomware Activity
status: experimental
description: Подозрительное массовое шифрование файлов
logsource:
  category: file_event
  product: linux
detection:
  selection:
    object.path|contains:
      - '.encrypted'
      - '.locked'
      - '.crypt'
  condition: selection | count() > 100
timeframe: 1m
level: critical
```

#### Sudo-эскалация привилегий

```yaml
title: Privilege Escalation via Sudo
status: stable
logsource:
  category: process_creation
  product: linux
detection:
  selection:
    event_type: sudo_exec
    subject.account.name|not_contains: admin
  condition: selection
level: medium
```

#### Горизонтальное перемещение

```yaml
title: Lateral Movement - Multiple SSH Targets
status: stable
logsource:
  product: sshd
detection:
  selection:
    event_type: auth_success
    src.ip|startswith: '192.168.'
  condition: selection | count(dst.host) > 3
timeframe: 10m
level: high
```

---

## Создание правила в интерфейсе

1. Перейдите в **Корреляция → Правила**
2. Нажмите **+ Создать правило**
3. Заполните поля:
   - **Название** — понятное описание
   - **Критичность** — LOW / MEDIUM / HIGH / CRITICAL
   - **Условия** — JSON-блок с параметрами
   - **SIGMA** — YAML описание (необязательно)
4. Переключите статус на **Включено**
5. Нажмите **Сохранить**

---

## Работа с алертами корреляции

### Просмотр алертов

**Корреляция → Алерты** — список всех срабатываний с возможностью фильтрации по статусу (OPEN / CLOSED) и критичности.

### Обработка алерта

1. Откройте алерт из списка
2. Изучите детали: правило, первое событие, количество совпадений
3. Нажмите **Закрыть** (CLOSED) если угроза устранена или ложная тревога
4. Добавьте примечание с описанием действий

### Привязка к инциденту

В канале событий выберите событие → **+ В инцидент** → выберите существующий инцидент или создайте новый.

---

## Исключения (подавление алертов)

Чтобы избежать ложных срабатываний, создайте правило исключения:

1. **Активы → Исключения → + Добавить**
2. Задайте условия в JSON:

```json
{
  "host": "backup-server",
  "event_type": "auth_failure",
  "comment": "Backup job uses password auth"
}
```

```json
{
  "src.ip": "192.168.1.10",
  "comment": "Vulnerability scanner"
}
```

---

## Cooldown и дедупликация

- После срабатывания правила оно не сработает повторно в течение **cooldown-периода** (по умолчанию равен `window_seconds`)
- Алерты с одинаковым правилом и группой не дублируются

---

## Каталог готовых правил

### Аутентификация

| Правило | Порог | Окно |
|---------|-------|------|
| SSH Brute Force | 10 неудачных входов | 5 мин |
| RDP Brute Force | 5 неудачных входов | 2 мин |
| Успешный вход после перебора | 1 успех после 5 ошибок | 10 мин |

### Сеть

| Правило | Порог | Окно |
|---------|-------|------|
| Port Scan | 100 DROP от одного IP | 1 мин |
| DDoS Detection | 1000 запросов с одного IP | 1 мин |
| Outbound to TOR exit nodes | 1 совпадение | — |

### Система

| Правило | Триггер | Окно |
|---------|---------|------|
| Создание привилегированного пользователя | `useradd` + `usermod -aG sudo` | 1 мин |
| Изменение /etc/sudoers | `visudo` / запись в файл | — |
| Запуск криптомайнера | Паттерн процесса | — |

---

## API правил корреляции

```bash
# Получить список правил
curl http://localhost:8000/correlation/rules -H "Authorization: Bearer $TOKEN"

# Создать правило
curl -X POST http://localhost:8000/correlation/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Brute Force SSH",
    "severity": "HIGH",
    "enabled": true,
    "conditions": {
      "type": "threshold",
      "field": "message",
      "pattern": "Failed password",
      "threshold": 10,
      "window_seconds": 300,
      "group_by": "src.ip"
    }
  }'

# Открытые алерты
curl "http://localhost:8000/correlation/alerts?status=OPEN" -H "Authorization: Bearer $TOKEN"

# Закрыть алерт
curl -X PATCH http://localhost:8000/correlation/alerts/42 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "CLOSED", "notes": "False positive — backup job"}'
```
