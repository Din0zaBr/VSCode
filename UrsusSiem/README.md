# 🐻 URSUS SIEM v2.0

> **SIEM для тех, у кого нет SOC.**
> 30 секунд установка. 5 минут до первого алерта. 0 строк YAML.
> Готовый отчёт по Приказу ФСТЭК России №21 в первую неделю.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-purple)](LICENSE)
[![Status: v2.0 MVP](https://img.shields.io/badge/status-v2.0_MVP-green)](PLAN_V2.md)
[![Made for](https://img.shields.io/badge/made_for-малый_и_средний_бизнес-blue)]()

---

## Быстрый старт

```bash
curl -fsSL https://get.ursus-siem.ru/install.sh | sudo bash
```

Через 30 секунд:
- UI на `http://<server>/`
- API на `http://<server>:8080/api`
- Syslog приёмник UDP/TCP `:514`

[→ Подробности](docs/getting-started.md)

---

## Чем URSUS отличается

| | URSUS | KUMA (Kaspersky) | Wazuh | UserGate SIEM |
|---|---|---|---|---|
| **Время до первой инсталляции** | **5 минут** | 1–3 дня | 1–2 часа | 1+ день |
| **Минимальные требования** | 2 vCPU / 4 ГБ | 8+ vCPU / 32 ГБ | 4 vCPU / 8 ГБ | ПАК / 4+ vCPU |
| **Single-binary** | ✅ Да | ❌ | ❌ | ❌ |
| **Стоимость первый год / 50 хостов** | **~200K ₽** | ~1.2–2.1M ₽ | ~900K–1.1M ₽ | ~600K–1.1M ₽ |
| **AGPL Core (открытый код)** | ✅ | ❌ | ✅ | ❌ |
| **Документация на русском** | ✅ | ✅ | ❌ (фрагменты) | ✅ |
| **Готовые отчёты Приказ №21** | ✅ из коробки | ✅ платно | ❌ | ⚠️ частично |
| **NL→PDQL на русском (LLM)** | ✅ (v2.2 preview) | ❌ | ❌ | ❌ |
| **Парсеры под 1С/Битрикс** | 🟡 в работе | ⚠️ частично | ❌ | ✅ |

[→ Полное сравнение в URSUS_STRATEGY.md](URSUS_STRATEGY.md#часть-2-сравнительная-таблица-конкурентов)

---

## Что есть в v2.0 MVP (production-ready)

| Sprint | Что | Документация |
|---|---|---|
| **1** | Syslog UDP/TCP + Vector compatibility + embedded UI | [syslog.md](docs/syslog.md) · [agent-deploy.md](docs/agent-deploy.md) |
| **2** | Telegram/Email/Webhook + **20 готовых сценариев** | [scenarios.md](docs/scenarios.md) · [notifications/telegram.md](docs/notifications/telegram.md) |
| **3** | OCSF normalization + audit-log | [api.md](docs/api.md) |
| **4** | Threat Intelligence (AbuseCH + OTX) + bloom-filter | — |
| **5** | Auto-installer + onboarding + AGPL/Compliance/Pro split | [LICENSE](LICENSE) |
| **6** | Prometheus `/metrics` + тесты + docs.ursus-siem.ru | [troubleshooting.md](docs/troubleshooting.md) |
| **9** | **Compliance**: ФСТЭК №21 PDF-отчёты | [compliance/fstec-21.md](docs/compliance/fstec-21.md) |

Плюс **60 готовых SIGMA-правил** в [configs/sigma_rules/](configs/sigma_rules/)
(bruteforce, lateral movement, credential dumping, persistence, recon, ...).

## Что есть в v2.1 / v2.2 preview (рабочий код, не часть MVP)

| Sprint | Фича | Status |
|---|---|---|
| 7 | UEBA — поведенческие профили + Welford online learning | 🟡 preview |
| 8 | ClickHouse backend (S/M tier) | 🟡 preview |
| 12 | Honeypot / canary tokens | 🟡 preview |
| 10 | LLM сервис (Vikhr 7B) — NL→PDQL, объяснения, narrative | 🔴 experimental |
| 11 | EDR-light агент (процессы / connections / FIM / USB) | 🔴 experimental |
| 13-14 | Cloud connectors: Yandex Cloud / AWS / Azure / M365 | 🔴 experimental |

[→ Подробности в PLAN_V2.md §Post-mortem](PLAN_V2.md)

---

## Архитектура

```
   ┌────────────────────────────────────────────────────────────────┐
   │ ИСТОЧНИКИ                                                       │
   │  Windows EventLog · Linux syslog · файлы · API · Cloud Trail   │
   └─────────────────────────────────┬──────────────────────────────┘
                                     │
                       ┌─────────────┴─────────────┐
                       │   Vector (или агент)      │   ← на хосте клиента
                       └─────────────┬─────────────┘
                                     │ Syslog 514 / HTTP NDJSON
       ╔═════════════════════════════▼═══════════════════════════════╗
       ║                URSUS SERVER (один VPS, ~200 MB RAM)         ║
       ║                                                             ║
       ║  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐   ║
       ║  │ logvault-go  │→│ logvault-   │→│ Postgres / DuckDB  │   ║
       ║  │ API + UI     │  │ rust engine │  │ + audit_log        │   ║
       ║  │ syslog :514  │  │ correlate + │  │                    │   ║
       ║  │ Telegram     │  │ ML + OCSF + │  │                    │   ║
       ║  │ /metrics     │  │ TI          │  │                    │   ║
       ║  └──────────────┘  └─────────────┘  └──────────────────┘   ║
       ╚═════════════════════════════════════════════════════════════╝
```

## Структура репозитория

```
UrsusSiem/
├── logvault-go/           # API gateway, /api, /metrics, embedded UI
├── logvault-rust/         # Парсер + корреляция + ML + OCSF + TI
├── logvault-agent/        # Python агент (опц., альтернатива Vector)
├── logvault-server/ui/    # React UI (Cyber Forest theme)
├── logvault-llm/          # 🔴 v2.2 — LLM сервис (Pro tier)
├── configs/
│   ├── scenarios/         # 20 готовых сценариев
│   ├── sigma_rules/       # 60 SIGMA-правил
│   └── compliance/        # Приказ ФСТЭК №21 templates + typst
├── integrations/vector/   # Vector profiles (linux/windows/syslog-relay)
├── migrations/            # SQL миграции (Postgres) + ClickHouse
├── scripts/               # install.sh, gen-password-hash, pg-to-ch
├── docs/                  # Документация (русский) — mkdocs
├── tests/                 # e2e скрипты
├── docker-compose.yml     # default (Micro tier)
├── docker-compose.medium.yml  # 🟡 v2.1 — + ClickHouse
├── docker-compose.pro.yml     # 🔴 v2.2 — + LLM
├── PLAN_V2.md             # архитектурный план
├── URSUS_STRATEGY.md      # стратегия, позиционирование, конкуренты
└── LICENSE                # AGPL-3.0 Community + commercial Pro
```

## Лицензирование

- **Community** (этот репо) — AGPL-3.0, бесплатно навсегда
- **Compliance** — платная, добавляет ФСТЭК-отчёты с экспертизой и premium TI
- **Pro** — платная, добавляет LLM + EDR + multi-tenant + поддержка

[→ LICENSE](LICENSE)

## Документация

- [Быстрый старт](docs/getting-started.md)
- [Установка агентов](docs/agent-deploy.md)
- [Syslog](docs/syslog.md)
- [Сценарии](docs/scenarios.md)
- [Telegram-уведомления](docs/notifications/telegram.md)
- [API reference](docs/api.md)
- [Соответствие Приказу ФСТЭК №21](docs/compliance/fstec-21.md)
- [Troubleshooting](docs/troubleshooting.md)

Полный сайт: [docs.ursus-siem.ru](https://docs.ursus-siem.ru)
(`mkdocs serve` из папки `docs/`).

## Roadmap

- ✅ v2.0 — production-ready Micro tier (готов)
- 🟡 v2.1 — ClickHouse + UEBA + canaries (Q3 2026)
- 🔴 v2.2 — LLM + EDR + cloud connectors (Q4 2026)
- 🟣 v2.3 — Multi-tenant + Helm chart + Compliance pack (Q1 2027)
- 🔵 v3.0 — Сертификация ФСТЭК (2027+)

[→ Полный roadmap в PLAN_V2.md](PLAN_V2.md)

## Контакты

- GitHub: <https://github.com/Din0zaBr/VSCode>
- Telegram: @ursus_siem_chat
- Email: hello@ursus-siem.ru
