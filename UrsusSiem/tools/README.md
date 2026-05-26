# tools/ — служебные утилиты

| Файл | Назначение |
|---|---|
| [`install.sh`](install.sh) | Auto-installer для Ubuntu/Debian/RHEL. Запуск: `curl …\| sudo bash` |
| [`pg-to-ch.py`](pg-to-ch.py) | Миграция логов Postgres → ClickHouse при переходе на S/M tier |
| [`gen-password-hash.go`](gen-password-hash.go) | Генератор bcrypt-хеша для `ADMIN_PASSWORD_HASH` в `.env` |

## install.sh

```bash
curl -fsSL https://get.ursus-siem.ru/install.sh | sudo bash
```

Что делает:
1. Ставит Docker если нет
2. Скачивает `deploy/docker-compose.yml` + миграции + базовые сценарии
3. Генерит случайные секреты в `deploy/.env`
4. Запускает стек `docker compose up -d`
5. Печатает URL + админ-пароль

## pg-to-ch.py

```bash
pip install psycopg2-binary clickhouse-driver
PG_DSN='postgres://logvault:secret@pg:5432/logvault' \
CH_DSN='clickhouse://default:@ch:9000/ursus' \
python pg-to-ch.py --since 2026-01-01 --batch 10000
```

## gen-password-hash.go

```bash
cd tools
go run gen-password-hash.go MyP@ssword123
# → выведет bcrypt-хеш для вставки в .env
```
