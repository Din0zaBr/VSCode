# Язык запросов PDQL

**PDQL (Pipeline Data Query Language)** — язык структурированных запросов к каналу событий URSUS SIEM. Команды соединяются через `|` (pipe) или `,` и образуют конвейер обработки.

---

## Синтаксис

```
команда1(аргументы) | команда2(аргументы) | ...
```

Альтернативный синтаксис (запятая вместо pipe):
```
команда1(аргументы), команда2(аргументы)
```

Команды `where(...)` и `filter(...)` являются синонимами.

---

## Команды

### filter / where — Фильтрация

```
filter(предикат [AND|OR предикат ...])
where(предикат [AND|OR предикат ...])
```

**Примеры:**
```
filter(level = "ERROR")
filter(level != "INFO")
filter(host = "server01" AND level = "ERROR")
filter(src.ip = "192.168.1.100" OR src.ip = "10.0.0.1")
```

---

### select — Выбор полей

```
select(поле1, поле2, ...)
```

**Примеры:**
```
select(time, host, level, text)
select(time, event_src.host, src.ip, text)
select(time, subject.process.id, action, object.path)
```

> Поле `event_id` добавляется автоматически, если его нет в списке.

---

### sort — Сортировка

```
sort(поле [asc|desc])
```

**Примеры:**
```
sort(time desc)
sort(time asc)
sort(src.ip asc)
```

---

### limit — Ограничение результатов

```
limit(число)
```

**Примеры:**
```
limit(100)
limit(1000)
```

---

### group — Группировка

```
group(поле1 [, поле2, ...])
```

Группирует события по указанным полям. Обычно сопровождается `aggregate`.

```
group(host) | aggregate(count()) | sort(count desc)
group(level, agent_id) | aggregate(count())
group(src.ip) | aggregate(count()) | sort(count desc) | limit(20)
```

---

### aggregate — Агрегация

```
aggregate(функция())
```

Поддерживаемые функции:
- `count()` — количество событий в группе

**Пример — топ IP по числу ошибок:**
```
filter(level = "ERROR") | group(src.ip) | aggregate(count()) | sort(count desc) | limit(10)
```

---

## Операторы предикатов

| Оператор | Синтаксис | Описание |
|----------|-----------|---------|
| Равно | `поле = "значение"` | Точное совпадение |
| Не равно | `поле != "значение"` | Исключение |
| Содержит | `поле contains "подстрока"` | Поиск подстроки (регистронезависимо) |
| Соответствует regex | `поле match "паттерн"` | Регулярное выражение |
| В списке | `поле in ("a", "b", "c")` | Один из вариантов |
| В подсети | `поле in_subnet "192.168.0.0/24"` | IP в CIDR-подсети |
| Больше | `поле > значение` | Числовое/строковое сравнение |
| Меньше | `поле < значение` | Числовое/строковое сравнение |

---

## Доступные поля

### Основные поля события

| Поле | Описание | Пример значения |
|------|---------|----------------|
| `time` | Время события (ISO 8601) | `2025-01-15T12:00:00Z` |
| `host` | Имя хоста-источника | `server01` |
| `level` | Уровень важности | `ERROR` |
| `text` | Текст сообщения | `Failed password for root` |
| `source` | Сервис/программа | `sshd` |
| `agent_id` | Идентификатор агента | `agent-linux-01` |
| `event_id` | Уникальный ID события | `12345` |

### Поля источника события

| Поле | Описание |
|------|---------|
| `event_src.host` | Хост источника (enriched) |
| `event_src.ip` | IP источника |
| `event_src.vendor` | Производитель |
| `event_src.title` | Название продукта |
| `event_src.subsys` | Подсистема/программа |
| `event_src.category` | Категория источника |

### Поля сетевого взаимодействия

| Поле | Описание |
|------|---------|
| `src.ip` | IP-адрес источника |
| `src.host` | Хост источника |
| `src.port` | Порт источника |
| `src.geo.country` | Страна источника |
| `dst.ip` | IP-адрес назначения |
| `dst.host` | Хост назначения |
| `dst.port` | Порт назначения |
| `protocol` | Протокол (tcp/udp/…) |

### Поля субъекта (пользователь/процесс)

| Поле | Описание |
|------|---------|
| `subject.name` | Имя субъекта |
| `subject.domain` | Домен |
| `subject.account.name` | Имя учётной записи |
| `subject.account.domain` | Домен учётной записи |
| `subject.account.id` | UID пользователя |
| `subject.process.id` | PID процесса |
| `subject.process.parent.id` | PPID родительского процесса |
| `subject.process.fullpath` | Полный путь к процессу |
| `subject.process.cmdline` | Командная строка |

### Поля объекта (целевой ресурс)

| Поле | Описание |
|------|---------|
| `object.name` | Имя объекта |
| `object.path` | Путь к файлу/ресурсу |
| `object.process.id` | PID дочернего процесса |
| `object.process.name` | Имя процесса |
| `object.process.cmdline` | Командная строка процесса |
| `object.process.parent.id` | PID родителя объекта |
| `object.hash.md5` | MD5 хэш файла |
| `object.hash.sha256` | SHA256 хэш файла |

### Поля категоризации

| Поле | Описание | Пример |
|------|---------|--------|
| `category.generic` | Общая категория | `Access`, `Network`, `System` |
| `category.high` | Уточнённая категория | `Authentication`, `Firewall` |
| `category.low` | Специфичная категория | `Remote`, `Drop` |
| `event_type` | Тип события | `auth_failure`, `fw_drop` |
| `detected_level` | Определённый уровень критичности | `CRITICAL` |

### Поля действий

| Поле | Описание |
|------|---------|
| `action` | HTTP-метод или действие |
| `status` | HTTP-код ответа |
| `reason` | Причина события |

---

## Примеры запросов

### Базовые запросы

```
# Все события за период (умолчание)
sort(time desc)

# Только ошибки
filter(level = "ERROR") | sort(time desc)

# Неудачные SSH-входы
filter(text contains "Failed password") | sort(time desc)

# Конкретный хост
filter(host = "server01") | sort(time desc)

# Несколько условий
filter(level = "ERROR" AND host = "server01") | sort(time desc)
```

### Выбор полей

```
# Только нужные поля
select(time, host, src.ip, text) | sort(time desc)

# Анализ аутентификации
select(time, event_src.host, subject.account.name, action) | filter(category.high = "Authentication") | sort(time desc)

# Сетевые события
select(time, src.ip, dst.ip, dst.port, action, status) | filter(category.generic = "Network") | sort(time desc)
```

### Аналитика и группировка

```
# Топ-10 IP с ошибками
filter(level = "ERROR") | group(src.ip) | aggregate(count()) | sort(count desc) | limit(10)

# Статистика по уровням
group(level) | aggregate(count()) | sort(count desc)

# Активность по агентам
group(agent_id) | aggregate(count()) | sort(count desc)

# Ошибки аутентификации по хосту
filter(event_type = "auth_failure") | group(event_src.host) | aggregate(count()) | sort(count desc) | limit(20)
```

### Безопасность

```
# Перебор паролей с конкретного IP
filter(event_type = "auth_failure" AND src.ip = "192.168.1.100") | sort(time desc)

# Повышение привилегий
filter(category.low = "Escalation") | select(time, host, subject.name, text) | sort(time desc)

# Блокировки файрволом
filter(event_type = "fw_drop") | group(src.ip) | aggregate(count()) | sort(count desc) | limit(20)

# Все события от подозрительной подсети
filter(src.ip in_subnet "10.10.0.0/16") | sort(time desc)

# HTTP 4xx/5xx ошибки
filter(status > "399") | select(time, src.ip, action, object.path, status) | sort(time desc)
```

### Процессы и файлы

```
# Процессы с конкретным PID
filter(subject.process.id = "1337") | sort(time desc)

# Sudo-команды
filter(event_type = "sudo_exec") | select(time, host, subject.account.name, text) | sort(time desc)

# Создание пользователей
filter(event_type = "user_created") | select(time, host, text) | sort(time desc)

# Конкретный файл в пути
filter(object.path contains "/etc/passwd") | sort(time desc)
```

---

## Работа с PDQL в интерфейсе

1. Откройте страницу **Канал событий**
2. Введите запрос в строке PDQL или нажмите ⚡ для полного редактора
3. Нажмите **Применить** или `Enter`

**Добавление фильтра кликом**: в детальной панели события нажмите на любое поле — оно автоматически добавится в фильтр `where(поле = "значение")`.

**Сортировка**: кликните по заголовку столбца — ↑ (asc) / ↓ (desc).

**Скрытие пустых столбцов**: кнопка **⊟ Скрыть пустые** убирает столбцы без данных.

---

## Типичные ошибки

| Ошибка | Причина | Решение |
|--------|---------|---------|
| Нет результатов | Поле с опечаткой | Проверьте имя поля в списке выше |
| Синтаксическая ошибка | Незакрытая скобка | Используйте редактор ⚡ |
| `cannot group without aggregate` | `group()` без `aggregate()` | Добавьте `\| aggregate(count())` |
| Медленный запрос | Большой диапазон времени | Уменьшите период или добавьте `limit()` |
