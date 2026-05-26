# URSUS SIEM

🐻 **URSUS Insight** — open-source SIEM для малого и среднего бизнеса.

## Ключевые возможности

- **Готов из коробки** — 20 преднастроенных сценариев под типовые угрозы МСБ
- **Compliance** — отчёты под Приказ ФСТЭК №21, №31, 152-ФЗ
- **OCSF-совместимость** — данные совместимы с Splunk/QRadar/Elastic
- **Threat Intelligence** — auto-pull IOC из AbuseCH/OTX
- **ML-детекция** — auto-baseline, DGA-scoring, beaconing, impossible-travel, UEBA
- **Русскоязычный UI** — Cyber Forest theme, шрифты Orbitron/Rajdhani

## Архитектура

[![URSUS v2](https://raw.githubusercontent.com/Din0zaBr/VSCode/main/UrsusSiem/docs/architecture.svg)](architecture.md)

Backend на **Rust + Go**: тяжёлая аналитика в Rust (парсинг, корреляция,
ML), API/UI в Go. Хранение — PostgreSQL → DuckDB (Micro tier) →
ClickHouse (S/M tier).

## Сравнение с альтернативами

| | URSUS | ELK | VictoriaLogs | Grafana Loki |
|---|---|---|---|---|
| SIEM из коробки | ✅ | ❌ (нужен X-Pack) | ❌ | ❌ |
| Корреляция / SIGMA | ✅ | 💰 платно | ❌ | ❌ |
| Compliance отчёты | ✅ (РФ) | ❌ | ❌ | ❌ |
| Min RAM | 2 GB | 8 GB | 1 GB | 2 GB |
| Русскоязычный UI | ✅ | ❌ | ❌ | ❌ |
| Open source | AGPL | ❌ | Apache | AGPL |

## Лицензирование

- **Community** (этот репо) — AGPL-3.0, бесплатно
- **Compliance** — платная, добавляет ФСТЭК-отчёты и premium TI
- **Pro** — платная, добавляет LLM + EDR-light + multi-tenant

Подробности в [LICENSE](https://github.com/Din0zaBr/VSCode/blob/main/UrsusSiem/LICENSE).
