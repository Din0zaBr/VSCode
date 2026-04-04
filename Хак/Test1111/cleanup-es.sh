#!/usr/bin/env bash
# Скрипт для полной очистки Elasticsearch после миграции на PostgreSQL.
# Запускать на сервере, где ранее работал docker compose со старым стеком.

set -euo pipefail

echo "=== Очистка Elasticsearch ==="

# Остановить старые контейнеры (если ещё работают)
echo "[1/4] Остановка старых контейнеров..."
docker stop logvault-es 2>/dev/null && echo "  logvault-es остановлен" || echo "  logvault-es уже остановлен"

# Удалить контейнер
echo "[2/4] Удаление контейнера..."
docker rm logvault-es 2>/dev/null && echo "  logvault-es удалён" || echo "  logvault-es уже удалён"

# Удалить docker volume с данными ES
echo "[3/4] Удаление volume es_data..."
VOLUME_PREFIX=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
for vol in "${VOLUME_PREFIX}_es_data" "es_data"; do
    docker volume rm "$vol" 2>/dev/null && echo "  Volume $vol удалён" || true
done

# Удалить образ ES (освобождает ~1.2 ГБ)
echo "[4/4] Удаление образа Elasticsearch..."
docker rmi docker.elastic.co/elasticsearch/elasticsearch:8.12.0 2>/dev/null \
    && echo "  Образ ES удалён" \
    || echo "  Образ ES уже удалён или не найден"

echo ""
echo "=== Готово ==="
echo "Elasticsearch полностью удалён."
echo "Запустите новый стек: docker compose up -d --build"
