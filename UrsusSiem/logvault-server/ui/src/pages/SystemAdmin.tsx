import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAdmin } from "../api/client";
import type { UserInfo, ApiKey } from "../api/client";
import Reports from "./Reports";
import CustomFieldsAdmin from "./CustomFieldsAdmin";
import SigmaRulesAdmin from "./SigmaRulesAdmin";

const SUB_TABS = [
  { id: "access",    label: "Права доступа" },
  { id: "api-keys",  label: "API ключи" },
  { id: "reports",   label: "Отчёты" },
  { id: "custom-fields", label: "Пользовательские поля" },
  { id: "sigma-rules", label: "SIGMA Правила" },
  { id: "notifications", label: "Уведомления" },
  { id: "policies",  label: "Политики" },
  { id: "management",label: "Управление системой" },
] as const;
type SubTab = typeof SUB_TABS[number]["id"];

// ── Access Control (Users) ───────────────────────────────────────────────────

function AccessTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "operator" });
  const [editUser, setEditUser] = useState<UserInfo | null>(null);

  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });

  const createMutation = useMutation({
    mutationFn: () => api.createUser(form.username, form.password, form.role),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setShowForm(false); setForm({ username: "", password: "", role: "operator" }); },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => api.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const rolesMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => api.updateUserRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const ROLE_BADGE: Record<string, string> = { admin: "badge-critical", operator: "badge-medium", viewer: "badge-low" };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold siem-fg">Управление пользователями</h3>
          <p className="text-xs siem-fg-soft mt-0.5">Создание, изменение и удаление учётных записей SIEM</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="siem-btn text-xs py-1.5 px-4">+ Создать</button>
      </div>

      {showForm && (
        <div className="siem-card p-4 space-y-3">
          <div className="text-sm font-semibold siem-fg mb-1">Новый пользователь</div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] siem-fg-soft uppercase tracking-wider mb-1 block">Логин</label>
              <input className="siem-input w-full text-sm" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} /></div>
            <div><label className="text-[10px] siem-fg-soft uppercase tracking-wider mb-1 block">Пароль</label>
              <input type="password" className="siem-input w-full text-sm" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} /></div>
            <div><label className="text-[10px] siem-fg-soft uppercase tracking-wider mb-1 block">Роль</label>
              <select className="siem-input w-full text-sm" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="operator">Оператор</option>
                <option value="viewer">Наблюдатель</option>
                <option value="admin">Администратор</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!form.username || !form.password || createMutation.isPending} className="siem-btn text-xs px-4 py-1.5 disabled:opacity-50">
              {createMutation.isPending ? "Создание..." : "Создать"}
            </button>
            <button onClick={() => setShowForm(false)} className="siem-btn-ghost text-xs px-4 py-1.5">Отмена</button>
          </div>
        </div>
      )}

      {isLoading ? <div className="text-center siem-fg-soft py-8">Загрузка...</div> : (
        <table className="w-full siem-table">
          <thead><tr><th>ID</th><th>Логин</th><th>Роль</th><th>Зарегистрирован</th><th>Агенты</th><th></th></tr></thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td className="font-mono siem-fg-soft text-xs">#{u.id}</td>
                <td className="font-medium siem-fg">{u.username}</td>
                <td>
                  <select
                    className="text-xs rounded px-1.5 py-0.5 border"
                    style={{ background: "var(--surface-panel)", borderColor: "var(--border-strong)", color: "var(--accent)" }}
                    value={u.role}
                    onChange={(e) => rolesMutation.mutate({ id: u.id, role: e.target.value })}
                  >
                    <option value="operator">Оператор</option>
                    <option value="viewer">Наблюдатель</option>
                    <option value="admin">Администратор</option>
                  </select>
                </td>
                <td className="siem-fg-soft text-xs">{new Date(u.created_at).toLocaleString("ru-RU")}</td>
                <td className="siem-fg-soft text-xs">{u.agents?.length > 0 ? u.agents.join(", ") : "Все"}</td>
                <td>
                  <button onClick={() => delMutation.mutate(u.id)} className="text-xs text-red-500/40 hover:text-red-400 px-2 py-1">Удалить</button>
                </td>
              </tr>
            ))}
            {!users?.length && <tr><td colSpan={6} className="text-center siem-fg-soft py-8">Нет пользователей</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Notifications Tab ─────────────────────────────────────────────────────────

function NotificationsTab() {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useQuery({ queryKey: ["alert-rules"], queryFn: api.alertRules });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", level: "ERROR", condition_type: "threshold" as "threshold" | "regex",
    threshold: 5, window_minutes: 5, regex_pattern: "",
    channel_type: "webhook" as "webhook" | "telegram",
    webhook_url: "", telegram_token: "", telegram_chat_id: "",
  });

  const createMutation = useMutation({
    mutationFn: () => api.createAlert({
      name: form.name, enabled: true, level: form.level,
      condition_type: form.condition_type, threshold: form.threshold,
      window_minutes: form.window_minutes, regex_pattern: form.regex_pattern,
      channels: [form.channel_type === "webhook"
        ? { type: "webhook", webhook_url: form.webhook_url }
        : { type: "telegram", telegram_token: form.telegram_token, telegram_chat_id: form.telegram_chat_id }],
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["alert-rules"] }); setShowForm(false); },
  });

  const delMutation = useMutation({
    mutationFn: (id: string) => api.deleteAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold siem-fg">Уведомления</h3>
          <p className="text-xs siem-fg-soft mt-0.5">Webhook и Telegram каналы для алертов</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="siem-btn text-xs py-1.5 px-4">+ Добавить</button>
      </div>

      {showForm && (
        <div className="siem-card p-4 space-y-3">
          <div className="text-sm font-semibold siem-fg">Новый канал уведомлений</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] siem-fg-soft mb-1 block">Название</label><input className="siem-input w-full text-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="text-[10px] siem-fg-soft mb-1 block">Уровень</label>
              <select className="siem-input w-full text-sm" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}>
                {["DEBUG","INFO","WARNING","ERROR","CRITICAL"].map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div><label className="text-[10px] siem-fg-soft mb-1 block">Канал</label>
              <select className="siem-input w-full text-sm" value={form.channel_type} onChange={(e) => setForm((f) => ({ ...f, channel_type: e.target.value as any }))}>
                <option value="webhook">Webhook</option>
                <option value="telegram">Telegram</option>
              </select>
            </div>
            {form.channel_type === "webhook" ? (
              <div><label className="text-[10px] siem-fg-soft mb-1 block">Webhook URL</label><input className="siem-input w-full text-sm" value={form.webhook_url} onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))} /></div>
            ) : (
              <>
                <div><label className="text-[10px] siem-fg-soft mb-1 block">Token</label><input className="siem-input w-full text-sm" value={form.telegram_token} onChange={(e) => setForm((f) => ({ ...f, telegram_token: e.target.value }))} /></div>
                <div><label className="text-[10px] siem-fg-soft mb-1 block">Chat ID</label><input className="siem-input w-full text-sm" value={form.telegram_chat_id} onChange={(e) => setForm((f) => ({ ...f, telegram_chat_id: e.target.value }))} /></div>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!form.name || createMutation.isPending} className="siem-btn text-xs px-4 py-1.5 disabled:opacity-50">Сохранить</button>
            <button onClick={() => setShowForm(false)} className="siem-btn-ghost text-xs px-4 py-1.5">Отмена</button>
          </div>
        </div>
      )}

      {isLoading ? <div className="text-center siem-fg-soft py-8">Загрузка...</div> : (
        <div className="space-y-2">
          {(rules ?? []).map((r) => (
            <div key={r.id} className="siem-card px-4 py-3 flex items-center gap-4">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.enabled ? "bg-green-500" : "bg-gray-600"}`} />
              <div className="flex-1">
                <div className="text-sm font-medium siem-fg">{r.name}</div>
                <div className="text-[10px] siem-fg-soft">
                  {r.condition_type === "threshold" ? `Порог: ${r.threshold} за ${r.window_minutes} мин` : `Regex: ${r.regex_pattern}`}
                  {" · "}Уровень: {r.level}
                </div>
              </div>
              <div className="flex gap-1">
                {r.channels?.map((ch, i) => (
                  <span key={i} className="badge-info">{ch.type}</span>
                ))}
              </div>
              <button onClick={() => delMutation.mutate(r.id)} className="text-xs text-red-500/40 hover:text-red-400 px-2">✕</button>
            </div>
          ))}
          {!rules?.length && <div className="text-center siem-fg-soft py-8">Нет каналов уведомлений</div>}
        </div>
      )}
    </div>
  );
}

// ── System Management Tab ─────────────────────────────────────────────────────

function ManagementTab() {
  const qc = useQueryClient();
  const { data: health } = useQuery({ queryKey: ["sys-health"], queryFn: api.systemHealth, refetchInterval: 15_000 });
  const [reparseMsg, setReparseMsg] = useState("");
  const [reparseOffset, setReparseOffset] = useState(0);

  const reparseMutation = useMutation({
    mutationFn: (offset: number) => api.reparseMeta(5000, offset),
    onSuccess: (res, offset) => {
      qc.invalidateQueries({ queryKey: ["events-channel"] });
      if (res.has_more) {
        setReparseOffset(offset + res.limit);
        setReparseMsg(
          `Пакет offset ${offset}: просмотрено ${res.scanned}, обновлено записей: ${res.updated}. Нажмите снова для следующего пакета.`,
        );
      } else {
        setReparseOffset(0);
        setReparseMsg(`Готово. Просмотрено ${res.scanned}, обновлено: ${res.updated}.`);
      }
    },
    onError: (e: Error) => setReparseMsg(`Ошибка: ${e.message}`),
  });

  const metrics = health as any;

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div>
        <h3 className="text-base font-semibold siem-fg">Управление системой</h3>
        <p className="text-xs siem-fg-soft mt-0.5">Состояние компонентов URSUS Insight</p>
      </div>

      {isAdmin() && (
        <div className="siem-card p-4 space-y-2">
          <div className="text-sm font-medium siem-fg">Обогащение событий в БД</div>
          <p className="text-[11px] siem-fg-soft leading-relaxed">
            Повторно применяет парсер к уже сохранённым сообщениям: категории (category.*), тип события (event_type), IP, уровень и др.
            Обрабатывает по 5000 строк за вызов; при большой базе нажимайте кнопку несколько раз.
          </p>
          <button
            type="button"
            className="siem-btn text-xs px-4 py-1.5"
            disabled={reparseMutation.isPending}
            onClick={() => reparseMutation.mutate(reparseOffset)}
          >
            {reparseMutation.isPending ? "Обработка…" : "Заполнить поля для накопленных событий"}
          </button>
          {reparseMsg && <div className="text-[11px] siem-fg-muted font-mono">{reparseMsg}</div>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "База данных",       ok: metrics?.db?.ok ?? null,          info: metrics?.db?.version },
          { label: "OpenSearch / ES",   ok: metrics?.opensearch?.ok ?? null,   info: metrics?.opensearch?.version },
          { label: "Сервер API",        ok: true,                              info: "FastAPI" },
          { label: "Агент связь",       ok: metrics?.agents_connected > 0,     info: `${metrics?.agents_connected ?? 0} агентов` },
        ].map((c) => (
          <div key={c.label} className="siem-card p-4 flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${c.ok === null ? "bg-gray-600 animate-pulse" : c.ok ? "bg-green-500" : "bg-red-500"}`}
              style={{ boxShadow: c.ok ? "0 0 8px rgba(74,222,128,0.6)" : c.ok === false ? "0 0 8px rgba(239,68,68,0.6)" : undefined }} />
            <div>
              <div className="text-sm font-medium siem-fg">{c.label}</div>
              {c.info && <div className="text-[10px] siem-fg-soft">{c.info}</div>}
            </div>
            <span className={`ml-auto text-xs ${c.ok === null ? "siem-fg-soft" : c.ok ? "text-emerald-700 dark:text-purple-300" : "text-red-500 dark:text-red-400"}`}>
              {c.ok === null ? "Проверка..." : c.ok ? "OK" : "ОШИБКА"}
            </span>
          </div>
        ))}
      </div>

      {metrics && (
        <div className="siem-card p-4">
          <div className="text-xs font-semibold siem-fg-muted mb-3 uppercase tracking-wider">Детали системы</div>
          <pre className="text-[11px] font-mono siem-fg-muted whitespace-pre-wrap overflow-auto max-h-64"
            style={{ background: "var(--surface-inset)", borderRadius: "6px", padding: "10px", border: "1px solid var(--border-strong)" }}>
            {JSON.stringify(metrics, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Reports Tab ───────────────────────────────────────────────────────────────

function ReportsTab() {
  return <Reports />;
}

// ── Policies Tab ──────────────────────────────────────────────────────────────

function PoliciesTab() {
  const POLICIES = [
    { name: "Блокировка IP после 10 неудачных попыток", enabled: true, type: "Автоматическое действие" },
    { name: "Алерт при входе в нерабочее время (22:00–06:00)", enabled: true, type: "Уведомление" },
    { name: "Карантин устройства при обнаружении вредоносного ПО", enabled: false, type: "Автоматическое действие" },
    { name: "Эскалация инцидента при отсутствии реакции >2ч", enabled: true, type: "Эскалация" },
  ];

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div>
        <h3 className="text-base font-semibold siem-fg">Политики безопасности</h3>
        <p className="text-xs siem-fg-soft mt-0.5">Автоматические действия и правила реагирования</p>
      </div>
      <div className="space-y-2">
        {POLICIES.map((p, i) => (
          <div key={i} className="siem-card p-4 flex items-center gap-4">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${p.enabled ? "bg-green-500" : "bg-gray-600"}`} />
            <div className="flex-1">
              <div className="text-sm siem-fg">{p.name}</div>
              <div className="text-[10px] siem-fg-soft mt-0.5">{p.type}</div>
            </div>
            <span className={p.enabled ? "badge-resolved" : "badge-fp"}>{p.enabled ? "Активна" : "Отключена"}</span>
            <button type="button" className="text-xs px-2 py-1 rounded siem-fg-soft hover:text-[color:var(--text)]" style={{ border: "1px solid var(--border-strong)" }}>✎</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── API Keys Tab ─────────────────────────────────────────────────────────────

function ApiKeysTab() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [freshKey, setFreshKey] = useState<ApiKey | null>(null);

  const { data: keys, isLoading } = useQuery({ queryKey: ["api-keys"], queryFn: api.listApiKeys });

  const createMutation = useMutation({
    mutationFn: () => api.createApiKey(newName.trim()),
    onSuccess: (k) => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setFreshKey(k);
      setNewName("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => api.toggleApiKey(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const serverBase = `${window.location.protocol}//${window.location.host}`;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h3 className="text-base font-semibold siem-fg">Управление API-ключами агентов</h3>
        <p className="text-xs siem-fg-soft mt-0.5">Ключи используются агентами для отправки событий в SIEM</p>
      </div>

      {/* Server connection info */}
      <div className="siem-card p-4 space-y-2">
        <div className="text-xs font-semibold siem-fg-muted uppercase tracking-wider mb-2">Адрес для подключения агентов</div>
        <div className="flex items-center gap-2">
          <span className="text-xs siem-fg-soft w-20">Сервер:</span>
          <code className="text-xs font-mono px-2 py-1 rounded" style={{ background: "var(--surface-inset)", color: "var(--accent)", border: "1px solid var(--border-strong)" }}>
            {serverBase}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs siem-fg-soft w-20">API:</span>
          <code className="text-xs font-mono px-2 py-1 rounded" style={{ background: "var(--surface-inset)", color: "var(--code-accent-2)", border: "1px solid var(--border-strong)" }}>
            {serverBase}/api
          </code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs siem-fg-soft w-20">Ingest:</span>
          <code className="text-xs font-mono px-2 py-1 rounded" style={{ background: "var(--surface-inset)", color: "#3d6565", border: "1px solid var(--border-strong)" }}>
            POST {serverBase}/api/ingest   (X-Api-Key: &lt;ключ&gt;)
          </code>
        </div>
      </div>

      {/* Create new key */}
      {isAdmin() && (
        <div className="siem-card p-4 space-y-3">
          <div className="text-sm font-semibold siem-fg">Создать новый ключ</div>
          <div className="flex gap-2">
            <input
              className="siem-input flex-1 text-sm"
              placeholder="Название (например: linux-server-01)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newName.trim() && createMutation.mutate()}
            />
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
              className="siem-btn text-xs px-4 py-1.5 disabled:opacity-50"
            >
              {createMutation.isPending ? "Генерация..." : "Создать"}
            </button>
          </div>
        </div>
      )}

      {/* Newly created key — shown once */}
      {freshKey?.key_value && (
        <div className="siem-card p-4 space-y-2" style={{ borderColor: "#00c853" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: "#00c853" }}>Новый ключ создан — скопируйте сейчас, он больше не будет показан!</span>
            <button onClick={() => setFreshKey(null)} className="siem-fg-soft hover:text-[color:var(--text)] text-sm">✕</button>
          </div>
          <code className="block text-xs font-mono px-3 py-2 rounded select-all" style={{ background: "var(--surface-inset)", color: "#00c853", border: "1px solid #00c853", wordBreak: "break-all" }}>
            {freshKey.key_value}
          </code>
          <div className="text-xs siem-fg-soft">
            Команда установки агента: <code className="siem-fg-muted">curl -fsSL {serverBase}/api/agent/install | sudo bash -s -- --key {freshKey.key_value}</code>
          </div>
        </div>
      )}

      {/* Keys list */}
      {isLoading ? (
        <div className="text-center siem-fg-soft py-8">Загрузка...</div>
      ) : (
        <table className="w-full siem-table text-xs">
          <thead>
            <tr>
              <th className="text-left">Название</th>
              <th className="text-left">Ключ (обрезан)</th>
              <th className="text-left">Создан</th>
              <th className="text-left">Последнее использование</th>
              <th className="text-left">Статус</th>
              {isAdmin() && <th></th>}
            </tr>
          </thead>
          <tbody>
            {(keys ?? []).map((k: ApiKey) => (
              <tr key={k.id}>
                <td className="font-medium siem-fg">{k.name}</td>
                <td><code className="font-mono siem-fg-muted">{k.key_preview}</code></td>
                <td className="siem-fg-soft">{k.created_by} · {new Date(k.created_at).toLocaleDateString("ru-RU")}</td>
                <td className="siem-fg-soft">{k.last_used ? new Date(k.last_used).toLocaleString("ru-RU") : "—"}</td>
                <td>
                  <button
                    onClick={() => toggleMutation.mutate({ id: k.id, enabled: !k.enabled })}
                    className={`text-xs px-2 py-0.5 rounded-full ${k.enabled ? "badge-resolved" : "badge-fp"}`}
                  >
                    {k.enabled ? "Активен" : "Отключён"}
                  </button>
                </td>
                {isAdmin() && (
                  <td>
                    <button
                      onClick={() => { if (confirm(`Удалить ключ "${k.name}"?`)) deleteMutation.mutate(k.id); }}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
                    >
                      Удалить
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {(keys ?? []).length === 0 && (
              <tr><td colSpan={6} className="text-center siem-fg-soft py-6">Нет ключей. Создайте первый выше.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemAdmin() {
  const [activeTab, setActiveTab] = useState<SubTab>("access");

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      <div className="flex border-b flex-shrink-0" style={{ borderColor: "var(--border)", background: "var(--surface-panel)" }}>
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="px-5 py-2.5 text-xs font-medium whitespace-nowrap transition-colors"
            style={{
              color: activeTab === t.id ? "var(--accent)" : "var(--text-soft)",
              borderBottom: activeTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === "access"        && <AccessTab />}
        {activeTab === "api-keys"      && <ApiKeysTab />}
        {activeTab === "notifications" && <NotificationsTab />}
        {activeTab === "management"    && <ManagementTab />}
        {activeTab === "reports"       && <ReportsTab />}
        {activeTab === "custom-fields" && <CustomFieldsAdmin />}
        {activeTab === "sigma-rules"   && <SigmaRulesAdmin />}
        {activeTab === "policies"      && <PoliciesTab />}
      </div>
    </div>
  );
}
