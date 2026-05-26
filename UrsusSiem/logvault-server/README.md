# logvault-server — UI only

После Sprint 1 этой папки содержит только **React-фронтенд** (`ui/`).

Python FastAPI сервер удалён в Sprint 8 — его функции полностью перенесены
в [`../logvault-go/`](../logvault-go/) (Go-gateway + PostgreSQL-storage).
Содержимое `server/data/sigma_rules/` перенесено в
[`../configs/sigma_rules/`](../configs/sigma_rules/) и загружается напрямую
Rust-движком + Go-loader'ом.

> Если требуется legacy-инсталляция Python-стека для совместимости —
> смотри git-историю до коммита `0470497` (Sprint 3), там был последний
> commit с полным Python-кодом перед удалением.

## UI

Папка `ui/` — React + TypeScript + Vite приложение. Подробности в
[`ui/README.md`](ui/) (если есть) и в [`../DOCS/`](../DOCS/).

Сборка:
```bash
cd ui
npm install
npm run build
# dist/ embedded в Go-бинарь через //go:embed (logvault-go/internal/webui/)
```
