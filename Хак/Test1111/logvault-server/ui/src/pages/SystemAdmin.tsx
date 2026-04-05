import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAdmin } from "../api/client";
import type { UserInfo } from "../api/client";

const SUB_TABS = [
  { id: "access",    label: "Права доступа" },
  { id: "reports",   label: "Отчёты" },
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
          <h3 className="text-base font-semibold text-gray-200">Управление пользователями</h3>
          <p className="text-xs text-gray-600 mt-0.5">Создание, изменение и удаление учётных записей SIEM</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="siem-btn text-xs py-1.5 px-4">+ Создать</button>
      </div>

      {showForm && (
        <div className="siem-card p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-200 mb-1">Новый пользователь</div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] text-gray-600 uppercase tracking-wider mb-1 block">Логин</label>
              <input className="siem-input w-full text-sm" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} /></div>
            <div><label className="text-[10px] text-gray-600 uppercase tracking-wider mb-1 block">Пароль</label>
              <input type="password" className="siem-input w-full text-sm" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} /></div>
            <div><label className="text-[10px] text-gray-600 uppercase tracking-wider mb-1 block">Роль</label>
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

      {isLoading ? <div className="text-center text-gray-600 py-8">Загрузка...</div> : (
        <table className="w-full siem-table">
          <thead><tr><th>ID</th><th>Логин</th><th>Роль</th><th>Зарегистрирован</th><th>Агенты</th><th></th></tr></thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td className="font-mono text-gray-600 text-xs">#{u.id}</td>
                <td className="font-medium text-gray-200">{u.username}</td>
                <td>
                  <select
                    className="text-xs rounded px-1.5 py-0.5 border"
                    style={{ background: "#111520", borderColor: "#2d1860", color: "#BF40BF" }}
                    value={u.role}
                    onChange={(e) => rolesMutation.mutate({ id: u.id, role: e.target.value })}
                  >
                    <option value="operator">Оператор</option>
                    <option value="viewer">Наблюдатель</option>
                    <option value="admin">Администратор</option>
                  </select>
                </td>
                <td className="text-gray-600 text-xs">{new Date(u.created_at).toLocaleString("ru-RU")}</td>
                <td className="text-gray-500 text-xs">{u.agents?.length > 0 ? u.agents.join(", ") : "Все"}</td>
                <td>
                  <button onClick={() => delMutation.mutate(u.id)} className="text-xs text-red-500/40 hover:text-red-400 px-2 py-1">Удалить</button>
                </td>
              </tr>
            ))}
            {!users?.length && <tr><td colSpan={6} className="text-center text-gray-600 py-8">Нет пользователей</td></tr>}
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
          <h3 className="text-base font-semibold text-gray-200">Уведомления</h3>
          <p className="text-xs text-gray-600 mt-0.5">Webhook и Telegram каналы для алертов</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="siem-btn text-xs py-1.5 px-4">+ Добавить</button>
      </div>

      {showForm && (
        <div className="siem-card p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-200">Новый канал уведомлений</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] text-gray-600 mb-1 block">Название</label><input className="siem-input w-full text-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="text-[10px] text-gray-600 mb-1 block">Уровень</label>
              <select className="siem-input w-full text-sm" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}>
                {["DEBUG","INFO","WARNING","ERROR","CRITICAL"].map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div><label className="text-[10px] text-gray-600 mb-1 block">Канал</label>
              <select className="siem-input w-full text-sm" value={form.channel_type} onChange={(e) => setForm((f) => ({ ...f, channel_type: e.target.value as any }))}>
                <option value="webhook">Webhook</option>
                <option value="telegram">Telegram</option>
              </select>
            </div>
            {form.channel_type === "webhook" ? (
              <div><label className="text-[10px] text-gray-600 mb-1 block">Webhook URL</label><input className="siem-input w-full text-sm" value={form.webhook_url} onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))} /></div>
            ) : (
              <>
                <div><label className="text-[10px] text-gray-600 mb-1 block">Token</label><input className="siem-input w-full text-sm" value={form.telegram_token} onChange={(e) => setForm((f) => ({ ...f, telegram_token: e.target.value }))} /></div>
                <div><label className="text-[10px] text-gray-600 mb-1 block">Chat ID</label><input className="siem-input w-full text-sm" value={form.telegram_chat_id} onChange={(e) => setForm((f) => ({ ...f, telegram_chat_id: e.target.value }))} /></div>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={!form.name || createMutation.isPending} className="siem-btn text-xs px-4 py-1.5 disabled:opacity-50">Сохранить</button>
            <button onClick={() => setShowForm(false)} className="siem-btn-ghost text-xs px-4 py-1.5">Отмена</button>
          </div>
        </div>
      )}

      {isLoading ? <div className="text-center text-gray-600 py-8">Загрузка...</div> : (
        <div className="space-y-2">
          {(rules ?? []).map((r) => (
            <div key={r.id} className="siem-card px-4 py-3 flex items-center gap-4">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.enabled ? "bg-green-500" : "bg-gray-600"}`} />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-200">{r.name}</div>
                <div className="text-[10px] text-gray-600">
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
          {!rules?.length && <div className="text-center text-gray-600 py-8">Нет каналов уведомлений</div>}
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
        <h3 className="text-base font-semibold text-gray-200">Управление системой</h3>
        <p className="text-xs text-gray-600 mt-0.5">Состояние компонентов URSUS Insight</p>
      </div>

      {isAdmin() && (
        <div className="siem-card p-4 space-y-2">
          <div className="text-sm font-medium text-gray-200">Обогащение событий в БД</div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
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
          {reparseMsg && <div className="text-[11px] text-gray-400 font-mono">{reparseMsg}</div>}
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
              <div className="text-sm font-medium text-gray-200">{c.label}</div>
              {c.info && <div className="text-[10px] text-gray-600">{c.info}</div>}
            </div>
            <span className={`ml-auto text-xs ${c.ok === null ? "text-gray-600" : c.ok ? "text-green-400" : "text-red-400"}`}>
              {c.ok === null ? "Проверка..." : c.ok ? "OK" : "ОШИБКА"}
            </span>
          </div>
        ))}
      </div>

      {metrics && (
        <div className="siem-card p-4">
          <div className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">Детали системы</div>
          <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap overflow-auto max-h-64"
            style={{ background: "#08090e", borderRadius: "6px", padding: "10px", border: "1px solid #1a0d2e" }}>
            {JSON.stringify(metrics, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Reports Tab ───────────────────────────────────────────────────────────────

function ReportsTab() {
  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div>
        <h3 className="text-base font-semibold text-gray-200">Отчёты</h3>
        <p className="text-xs text-gray-600 mt-0.5">Формирование и выгрузка отчётов</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[
          { title: "Ежедневный отчёт по инцидентам", desc: "Все инциденты за последние 24ч", icon: "📋" },
          { title: "Топ угроз за неделю", desc: "Распределение по критичности и статусу", icon: "📊" },
          { title: "Активность агентов", desc: "Состояние и статистика по агентам", icon: "📡" },
          { title: "Аудит доступа", desc: "Действия пользователей в системе", icon: "🔐" },
        ].map((r) => (
          <div key={r.title} className="siem-card p-4 flex items-start gap-3 hover:scale-[1.01] transition-transform cursor-pointer">
            <span className="text-2xl">{r.icon}</span>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-200">{r.title}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">{r.desc}</div>
            </div>
            <button className="siem-btn-ghost text-xs px-3 py-1.5 mt-0.5">Скачать</button>
          </div>
        ))}
      </div>
    </div>
  );
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
        <h3 className="text-base font-semibold text-gray-200">Политики безопасности</h3>
        <p className="text-xs text-gray-600 mt-0.5">Автоматические действия и правила реагирования</p>
      </div>
      <div className="space-y-2">
        {POLICIES.map((p, i) => (
          <div key={i} className="siem-card p-4 flex items-center gap-4">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${p.enabled ? "bg-green-500" : "bg-gray-600"}`} />
            <div className="flex-1">
              <div className="text-sm text-gray-200">{p.name}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">{p.type}</div>
            </div>
            <span className={p.enabled ? "badge-resolved" : "badge-fp"}>{p.enabled ? "Активна" : "Отключена"}</span>
            <button className="text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-300" style={{ border: "1px solid #1a0d2e" }}>✎</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemAdmin() {
  const [activeTab, setActiveTab] = useState<SubTab>("access");

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      <div className="flex border-b flex-shrink-0" style={{ borderColor: "#1a0d2e", background: "#0d0f18" }}>
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="px-5 py-2.5 text-xs font-medium whitespace-nowrap transition-colors"
            style={{
              color: activeTab === t.id ? "#BF40BF" : "#64748b",
              borderBottom: activeTab === t.id ? "2px solid #BF40BF" : "2px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === "access"        && <AccessTab />}
        {activeTab === "notifications" && <NotificationsTab />}
        {activeTab === "management"    && <ManagementTab />}
        {activeTab === "reports"       && <ReportsTab />}
        {activeTab === "policies"      && <PoliciesTab />}
      </div>
    </div>
  );
}
