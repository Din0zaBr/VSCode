# Быстрый старт

Цель этого раздела — за **5 минут** запустить URSUS SIEM на чистом VPS и
увидеть первый алерт.

## Требования

- Ubuntu 22.04+ / Debian 12+ / RHEL 9+ (или производные)
- 2 vCPU, 4 GB RAM, 20 GB SSD
- Открытые порты: 80, 443 (HTTPS), 514 (syslog), 8080 (API)

## Установка одной командой

```bash
curl -fsSL https://get.ursus-siem.ru/install.sh | sudo bash
```

Скрипт сделает:
1. Установит Docker, если его нет.
2. Скачает `docker-compose.yml` и миграции БД.
3. Сгенерирует случайный `JWT_SECRET` и пароль для admin.
4. Запустит весь стек (PostgreSQL + Rust engine + Go gateway + UI + Caddy).
5. Выведет логин и URL UI.

## Первые шаги в UI

1. Откройте `http://<IP>` в браузере.
2. Войдите как `admin` с паролем из вывода install.sh.
3. Onboarding wizard:
   - **Шаг 1:** Смените admin-пароль.
   - **Шаг 2:** Установите агент на хост — кнопка скопирует команду:
     ```bash
     curl -fsSL http://<IP>:8080/agent/install | sudo bash -s -- --key <API_KEY>
     ```
     Или используйте Vector-профиль из
     [`integrations/vector/linux-server.yaml`](../integrations/vector/linux-server.yaml).
   - **Шаг 3:** Включите готовые сценарии (рекомендуется все critical/high).
   - **Шаг 4:** Подключите Telegram-бот (опционально).
4. Через минуту первое событие появится в **Live Logs**.

## Что дальше

- [Установка агентов](agent-deploy.md) — несколько способов
- [Настройка scenarios](scenarios.md) — тонкая настройка готовых детектов
- [Уведомления Telegram](notifications/telegram.md) — подробная инструкция
- [Compliance отчёты](compliance/fstec-21.md) — для проверок
