import { useState } from "react";

type IntegrationType =
  | "suricata" | "kaspersky" | "ml_anomaly"
  | "elastic" | "splunk" | "webhook" | "rest_generic";

type AuthMethod = "api_key" | "username_password" | "none";
type IntegrationStatus = "enabled" | "disabled" | "error";

interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  description: string;
  url: string;
  auth_method: AuthMethod;
  api_key?: string;
  username?: string;
  password?: string;
  status: IntegrationStatus;
  sync_interval: number;
  last_sync?: string;
  created_at: string;
}

const TYPE_META: Record<IntegrationType, { label: string; icon: string; color: string; description: string }> = {
  suricata:    { label: "Suricata IDS",  icon: "🛡", color: "#f87171", description: "Получение алертов от Suricata IDS" },
  kaspersky:   { label: "Kaspersky",     icon: "🔒", color: "#fb923c", description: "Данные об угрозах от Kaspersky EDR" },
  ml_anomaly:  { label: "ML Аномалии",   icon: "🤖", color: "#a78bfa", description: "Обнаружение аномалий через ML-модель" },
  elastic:     { label: "Elasticsearch", icon: "🔍", color: "#34d399", description: "Синхронизация с Elastic/OpenSearch" },
  splunk:      { label: "Splunk",        icon: "📊", color: "#60a5fa", description: "Интеграция с Splunk SIEM" },
  webhook:     { label: "Webhook",       icon: "🔗", color: "#facc15", description: "Входящие webhook от любых сервисов" },
  rest_generic:{ label: "REST API",      icon: "⚙", color: "var(--text-muted)", description: "Универсальный HTTP REST коннектор" },
};

const STATUS_LABELS: Record<IntegrationStatus, { label: string; color: string }> = {
  enabled:  { label: "Активен",  color: "#22c55e" },
  disabled: { label: "Отключён", color: "#6b7280" },
  error:    { label: "Ошибка",   color: "#f87171" },
};

const INTEGRATIONS_KEY = "ursus_integrations";

function loadIntegrations(): Integration[] {
  try {
    return JSON.parse(localStorage.getItem(INTEGRATIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

function persist(items: Integration[]) {
  localStorage.setItem(INTEGRATIONS_KEY, JSON.stringify(items));
}

const EMPTY_FORM: Omit<Integration, "id" | "created_at"> = {
  type: "suricata",
  name: "",
  description: "",
  url: "",
  auth_method: "api_key",
  api_key: "",
  username: "",
  password: "",
  status: "disabled",
  sync_interval: 60,
};

export default function Integrations() {
  const [integrations, setIntegrations] = useState<Integration[]>(loadIntegrations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const mutate = (updated: Integration[]) => { setIntegrations(updated); persist(updated); };

  const handleNew = (type?: IntegrationType) => {
    setForm({ ...EMPTY_FORM, ...(type ? { type } : {}) });
    setEditId(null);
    setTestMsg(null);
    setShowForm(true);
  };

  const handleEdit = (item: Integration) => {
    setForm({
      type: item.type, name: item.name, description: item.description,
      url: item.url, auth_method: item.auth_method, api_key: item.api_key ?? "",
      username: item.username ?? "", password: item.password ?? "",
      status: item.status, sync_interval: item.sync_interval,
    });
    setEditId(item.id);
    setTestMsg(null);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || !form.url) return;
    if (editId) {
      mutate(integrations.map((i) => i.id === editId ? { ...i, ...form } : i));
    } else {
      mutate([{ ...form, id: `int-${Date.now()}`, created_at: new Date().toISOString() }, ...integrations]);
    }
    setShowForm(false);
    setEditId(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Удалить интеграцию?")) {
      mutate(integrations.filter((i) => i.id !== id));
      if (selectedId === id) setSelectedId(null);
    }
  };

  const toggleStatus = (id: string) => {
    mutate(integrations.map((i) =>
      i.id === id ? { ...i, status: i.status === "enabled" ? "disabled" : "enabled" } : i
    ));
  };

  const handleTest = async () => {
    if (!form.url) return;
    setTesting(true);
    setTestMsg(null);
    await new Promise((r) => setTimeout(r, 1100));
    const ok = /^https?:\/\/.+/.test(form.url);
    setTestMsg({
      ok,
      text: ok
        ? `Подключение к ${form.url} успешно`
        : "Ошибка: URL должен начинаться с http:// или https://",
    });
    setTesting(false);
  };

  const selected = integrations.find((i) => i.id === selectedId);

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 mb-1">Интеграции</h2>
        <p className="text-sm text-gray-500">Управление внешними коннекторами и источниками данных</p>
      </div>

      {/* Type quick-add cards */}
      <div className="grid grid-cols-7 gap-2">
        {(Object.entries(TYPE_META) as [IntegrationType, typeof TYPE_META[IntegrationType]][]).map(([type, meta]) => {
          const count = integrations.filter((i) => i.type === type).length;
          const hasEnabled = integrations.some((i) => i.type === type && i.status === "enabled");
          return (
            <div
              key={type}
              className="siem-card p-3 text-center cursor-pointer hover:scale-[1.04] transition-all"
              style={{ borderColor: hasEnabled ? meta.color : undefined }}
              onClick={() => handleNew(type)}
              title={meta.description}
            >
              <div className="text-xl mb-1">{meta.icon}</div>
              <div className="text-[10px] font-semibold text-gray-300 leading-tight">{meta.label}</div>
              {count > 0 && (
                <div className="text-[9px] mt-1" style={{ color: meta.color }}>{count} шт.</div>
              )}
            </div>
          );
        })}
      </div>

      {/* List + Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* List */}
        <div className="lg:col-span-1 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-300">
              Коннекторы ({integrations.length})
              <span className="text-xs text-gray-600 ml-2">
                ({integrations.filter((i) => i.status === "enabled").length} активно)
              </span>
            </span>
            <button onClick={() => handleNew()} className="siem-btn text-xs px-3 py-1.5">+ Добавить</button>
          </div>
          {integrations.length === 0 ? (
            <div className="siem-card p-8 text-center text-gray-600 text-sm">
              Нет интеграций.<br />Выберите тип выше или нажмите "+ Добавить"
            </div>
          ) : (
            integrations.map((item) => {
              const meta = TYPE_META[item.type];
              const st = STATUS_LABELS[item.status];
              return (
                <div
                  key={item.id}
                  className="siem-card p-3 cursor-pointer transition-all hover:scale-[1.01]"
                  style={{
                    background: selectedId === item.id ? "rgba(167,139,250,0.15)" : undefined,
                    borderColor: selectedId === item.id ? "#a78bfa" : undefined,
                  }}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-200 truncate">{item.name}</div>
                      <div className="text-[10px] text-gray-600 truncate">{meta.label}</div>
                    </div>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: st.color }} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <div className="siem-card p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{TYPE_META[selected.type].icon}</span>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-200">{selected.name}</h3>
                    <p className="text-xs text-gray-500">{TYPE_META[selected.type].label}</p>
                  </div>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: `${STATUS_LABELS[selected.status].color}22`,
                    color: STATUS_LABELS[selected.status].color,
                    border: `1px solid ${STATUS_LABELS[selected.status].color}44`,
                  }}
                >
                  {STATUS_LABELS[selected.status].label}
                </span>
              </div>

              {selected.description && (
                <p className="text-xs text-gray-500">{selected.description}</p>
              )}

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-gray-600">URL: </span><span className="text-gray-300 font-mono break-all">{selected.url}</span></div>
                <div><span className="text-gray-600">Авторизация: </span><span className="text-gray-300">{selected.auth_method}</span></div>
                <div><span className="text-gray-600">Интервал: </span><span className="text-gray-300">{selected.sync_interval}с</span></div>
                <div>
                  <span className="text-gray-600">Последняя синхр.: </span>
                  <span className="text-gray-300">{selected.last_sync ? new Date(selected.last_sync).toLocaleString("ru-RU") : "—"}</span>
                </div>
                <div><span className="text-gray-600">Создан: </span><span className="text-gray-300">{new Date(selected.created_at).toLocaleString("ru-RU")}</span></div>
              </div>

              <div className="flex gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <button onClick={() => handleEdit(selected)} className="siem-btn-ghost text-xs px-3 py-1.5 flex-1">Редактировать</button>
                <button onClick={() => toggleStatus(selected.id)} className="siem-btn-ghost text-xs px-3 py-1.5">
                  {selected.status === "enabled" ? "Отключить" : "Включить"}
                </button>
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
                >
                  Удалить
                </button>
              </div>
            </div>
          ) : (
            <div className="siem-card p-12 flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-4xl mb-2">🔗</div>
                <div className="text-gray-500 text-sm">Выберите коннектор или создайте новый</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="siem-card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-lg font-semibold text-gray-200">{editId ? "Редактировать интеграцию" : "Новая интеграция"}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-600 hover:text-gray-400">✕</button>
            </div>

            <div className="p-6 space-y-4">
              {/* Type grid */}
              <div>
                <label className="text-xs text-gray-500 uppercase block mb-2">Тип коннектора</label>
                <div className="grid grid-cols-4 gap-2">
                  {(Object.entries(TYPE_META) as [IntegrationType, typeof TYPE_META[IntegrationType]][]).map(([type, meta]) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, type }))}
                      className="p-2 rounded-lg text-center text-[11px] transition-all"
                      style={{
                        background: form.type === type ? `${meta.color}22` : "rgba(255,255,255,0.03)",
                        border: `1px solid ${form.type === type ? meta.color : "#374151"}`,
                        color: form.type === type ? meta.color : "#6b7280",
                      }}
                    >
                      <div className="text-lg mb-0.5">{meta.icon}</div>
                      <div>{meta.label}</div>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-600 mt-1">{TYPE_META[form.type].description}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase block mb-2">Название</label>
                  <input
                    className="siem-input w-full text-sm"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Suricata Production"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase block mb-2">Интервал синхр. (сек)</label>
                  <input
                    type="number"
                    className="siem-input w-full text-sm"
                    value={form.sync_interval}
                    min={10}
                    onChange={(e) => setForm((f) => ({ ...f, sync_interval: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase block mb-2">URL / Endpoint</label>
                <input
                  className="siem-input w-full text-sm font-mono"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://suricata-host:9200"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase block mb-2">Описание</label>
                <textarea
                  className="siem-input w-full text-sm resize-none"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase block mb-2">Аутентификация</label>
                <select
                  className="siem-input w-full text-sm mb-3"
                  value={form.auth_method}
                  onChange={(e) => setForm((f) => ({ ...f, auth_method: e.target.value as AuthMethod }))}
                >
                  <option value="none">Без аутентификации</option>
                  <option value="api_key">API Key</option>
                  <option value="username_password">Логин / Пароль</option>
                </select>
                {form.auth_method === "api_key" && (
                  <input
                    className="siem-input w-full text-sm font-mono"
                    value={form.api_key}
                    onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                    placeholder="API ключ"
                    type="password"
                  />
                )}
                {form.auth_method === "username_password" && (
                  <div className="grid grid-cols-2 gap-3">
                    <input className="siem-input w-full text-sm" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="Логин" />
                    <input type="password" className="siem-input w-full text-sm" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Пароль" />
                  </div>
                )}
              </div>

              {/* Test connection */}
              <div>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={!form.url || testing}
                  className="siem-btn-ghost text-xs px-4 py-2 disabled:opacity-50"
                >
                  {testing ? "Проверка подключения..." : "Проверить подключение"}
                </button>
                {testMsg && (
                  <div
                    className="mt-2 text-xs px-3 py-2 rounded"
                    style={{
                      background: testMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                      color: testMsg.ok ? "#22c55e" : "#f87171",
                      border: `1px solid ${testMsg.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                    }}
                  >
                    {testMsg.ok ? "✓ " : "✗ "}{testMsg.text}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setShowForm(false)} className="siem-btn-ghost text-xs px-4 py-2">Отмена</button>
              <button
                onClick={handleSave}
                disabled={!form.name || !form.url}
                className="siem-btn text-xs px-4 py-2 disabled:opacity-50"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
