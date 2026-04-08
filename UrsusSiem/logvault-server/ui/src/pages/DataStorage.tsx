import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAdmin } from "../api/client";
import type { Exclusion, CorrelationRule } from "../api/client";

// ── Sub-tab definitions ───────────────────────────────────────────────────────

const SUB_TABS = [
  { id: "correlation-rules", label: "Правила корреляции" },
  { id: "enrichment-rules",  label: "Правила обогащения" },
  { id: "exclusions",        label: "Исключения" },
  { id: "accounts",          label: "Учётные записи" },
  { id: "references",        label: "Справочники" },
  { id: "table-lists",       label: "Табличные списки" },
  { id: "profiles",          label: "Профили" },
  { id: "infrastructure",    label: "Инфраструктура" },
  { id: "source-monitoring", label: "Мониторинг источников" },
  { id: "tasks",             label: "Задачи" },
] as const;
type SubTab = typeof SUB_TABS[number]["id"];

// ── Correlation Rules (Sigma) ─────────────────────────────────────────────────

const EXAMPLE_SIGMA = `title: Brute Force Login Attempt
id: rule-brute-force-001
status: experimental
description: Detects multiple failed login attempts from a single source
author: URSUS Insight
date: 2025/01/01
tags:
  - attack.credential_access
  - attack.t1110

logsource:
  category: authentication
  product: windows

detection:
  selection:
    action: failure
    reason: invalid_credentials
  condition: selection | count(src.ip) > 5 | timeframe 5m

falsepositives:
  - Legitimate password resets
  - Administrative actions

level: high`;

const SEV_COLORS: Record<string, string> = {
  CRITICAL: "badge-critical", HIGH: "badge-high", MEDIUM: "badge-medium", LOW: "badge-low",
};

function CorrelationRulesTab() {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useQuery({ queryKey: ["corr-rules"], queryFn: api.correlationRules });
  const [showForm, setShowForm]   = useState(false);
  const [editRule, setEditRule]   = useState<CorrelationRule | null>(null);
  const [form, setForm] = useState({
    id: "", name: "", description: "", severity: "MEDIUM", enabled: true,
    sigma_rule: EXAMPLE_SIGMA,
  });

  const saveMutation = useMutation({
    mutationFn: (r: CorrelationRule) => editRule ? api.updateCorrelationRule(r.id, r) : api.createCorrelationRule(r),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["corr-rules"] }); setShowForm(false); setEditRule(null); },
  });
  const delMutation = useMutation({
    mutationFn: (id: string) => api.deleteCorrelationRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corr-rules"] }),
  });

  const openCreate = () => {
    setEditRule(null);
    setForm({ id: "", name: "", description: "", severity: "MEDIUM", enabled: true, sigma_rule: EXAMPLE_SIGMA });
    setShowForm(true);
  };
  const openEdit = (r: CorrelationRule) => {
    setEditRule(r);
    setForm({ id: r.id, name: r.name, description: r.description ?? "", severity: r.severity, enabled: r.enabled, sigma_rule: r.sigma_rule ?? EXAMPLE_SIGMA });
    setShowForm(true);
  };
  const handleSave = () => {
    saveMutation.mutate({
      id: form.id || `sigma-${Date.now()}`,
      name: form.name, description: form.description,
      severity: form.severity, enabled: form.enabled,
      sigma_rule: form.sigma_rule,
      conditions: { type: "sigma", sigma_rule: form.sigma_rule },
    });
  };

  return (
    <div className="flex gap-4 h-full overflow-hidden">
      {/* List */}
      <div className="w-72 flex flex-col border-r flex-shrink-0" style={{ borderColor: "#1a0d2e" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#1a0d2e" }}>
          <span className="text-xs font-bold" style={{ color: "#BF40BF" }}>Правила ({rules?.length ?? 0})</span>
          {isAdmin() && <button onClick={openCreate} className="siem-btn text-xs py-1 px-3">+ Новое</button>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && <div className="text-center text-gray-600 py-8 text-sm">Загрузка...</div>}
          {(rules ?? []).map((r) => (
            <div
              key={r.id}
              className="px-4 py-3 border-b cursor-pointer hover:bg-purple-900/10 transition-colors"
              style={{ borderColor: "#1a0d2e", background: editRule?.id === r.id ? "rgba(106,13,173,0.12)" : "transparent" }}
              onClick={() => openEdit(r)}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.enabled ? "bg-green-500" : "bg-gray-600"}`} />
                <span className="text-xs font-medium text-gray-200 truncate">{r.name}</span>
              </div>
              <div className="flex items-center gap-2 ml-3.5">
                <span className={SEV_COLORS[r.severity] ?? "badge-info"}>{r.severity}</span>
                <span className="text-[10px] text-gray-600">срабат.: {r.hit_count ?? 0}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {showForm ? (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "#1a0d2e" }}>
              <span className="text-sm font-semibold text-gray-200">{editRule ? "Редактировать правило" : "Новое правило Sigma"}</span>
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)} className="siem-btn-ghost text-xs px-3 py-1.5">Отмена</button>
                {editRule && isAdmin() && (
                  <button onClick={() => { delMutation.mutate(editRule.id); setShowForm(false); setEditRule(null); }}
                    className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}>
                    Удалить
                  </button>
                )}
                {isAdmin() && <button onClick={handleSave} disabled={saveMutation.isPending} className="siem-btn text-xs px-4 py-1.5 disabled:opacity-50">
                  {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
                </button>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-600 uppercase tracking-wider mb-1 block">Название</label>
                  <input className="siem-input w-full text-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-600 uppercase tracking-wider mb-1 block">Критичность</label>
                  <select className="siem-input w-full text-sm" value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
                    {["CRITICAL","HIGH","MEDIUM","LOW"].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="w-4 h-4 accent-violet-500" />
                    <span className="text-sm text-gray-300">Включено</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-600 uppercase tracking-wider mb-1 block">Описание</label>
                <input className="siem-input w-full text-sm" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Описание правила" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-gray-600 uppercase tracking-wider">Sigma Rule (YAML)</label>
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(47,79,79,0.3)", color: "#3d6565", border: "1px solid #2F4F4F" }}>Sigma v2</span>
                </div>
                <textarea
                  className="w-full p-3 rounded-xl text-xs font-mono resize-none focus:outline-none"
                  style={{ background: "#08090e", color: "#BF40BF", border: "1px solid #2d1860", minHeight: "380px", lineHeight: "1.6" }}
                  value={form.sigma_rule}
                  onChange={(e) => setForm((f) => ({ ...f, sigma_rule: e.target.value }))}
                  spellCheck={false}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col gap-3">
            <div className="text-5xl" style={{ color: "#1a0d2e" }}>⚡</div>
            <div className="text-gray-600 text-sm">Выберите правило или создайте новое</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Exclusions Tab ────────────────────────────────────────────────────────────

function ExclusionsTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editEx, setEditEx] = useState<Exclusion | null>(null);
  const [form, setForm] = useState({ name: "", description: "", exclusion_type: "ip", enabled: true, condRaw: '{"field":"src.ip","value":""}' });

  const { data, isLoading } = useQuery({
    queryKey: ["exclusions", page],
    queryFn: () => api.listExclusions({ page, size: 50 }),
  });

  const saveMutation = useMutation({
    mutationFn: (d: any) => editEx ? api.updateExclusion(editEx.id, d) : api.createExclusion(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exclusions"] }); setShowForm(false); },
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => api.deleteExclusion(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exclusions"] }),
  });

  const openCreate = () => { setEditEx(null); setForm({ name: "", description: "", exclusion_type: "ip", enabled: true, condRaw: '{"field":"src.ip","value":""}' }); setShowForm(true); };
  const openEdit = (ex: Exclusion) => { setEditEx(ex); setForm({ name: ex.name, description: ex.description ?? "", exclusion_type: ex.exclusion_type, enabled: ex.enabled, condRaw: JSON.stringify(ex.conditions, null, 2) }); setShowForm(true); };
  const handleSave = () => {
    try { saveMutation.mutate({ name: form.name, description: form.description, exclusion_type: form.exclusion_type, enabled: form.enabled, conditions: JSON.parse(form.condRaw) }); }
    catch { alert("Невалидный JSON"); }
  };

  const excl = data?.exclusions ?? [];
  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Всего: {data?.total ?? 0}</span>
        <button onClick={openCreate} className="siem-btn text-xs py-1.5 px-4">+ Создать</button>
      </div>

      {showForm && (
        <div className="siem-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-200">{editEx ? "Редактировать" : "Новое исключение"}</span>
            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)} className="siem-btn-ghost text-xs px-3 py-1">Отмена</button>
              <button onClick={handleSave} className="siem-btn text-xs px-3 py-1">Сохранить</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] text-gray-600 mb-1 block">Название</label><input className="siem-input w-full text-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="text-[10px] text-gray-600 mb-1 block">Тип</label>
              <select className="siem-input w-full text-sm" value={form.exclusion_type} onChange={(e) => setForm((f) => ({ ...f, exclusion_type: e.target.value }))}>
                {["ip","host","user","rule","field"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div><label className="text-[10px] text-gray-600 mb-1 block">Описание</label><input className="siem-input w-full text-sm" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <div><label className="text-[10px] text-gray-600 mb-1 block">Условия (JSON)</label>
            <textarea className="siem-input w-full font-mono text-xs min-h-[80px] resize-none" value={form.condRaw} onChange={(e) => setForm((f) => ({ ...f, condRaw: e.target.value }))} style={{ color: "#BF40BF" }} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="w-4 h-4 accent-violet-500" /><span className="text-sm text-gray-300">Включено</span></label>
        </div>
      )}

      {isLoading ? <div className="text-center text-gray-600 py-8">Загрузка...</div> : (
        <table className="w-full siem-table">
          <thead><tr><th>Название</th><th>Тип</th><th>Статус</th><th>Описание</th><th></th></tr></thead>
          <tbody>
            {excl.map((ex) => (
              <tr key={ex.id}>
                <td className="font-medium text-gray-200">{ex.name}</td>
                <td><span className="badge-info">{ex.exclusion_type}</span></td>
                <td><span className={ex.enabled ? "badge-resolved" : "badge-fp"}>{ex.enabled ? "Активно" : "Отключено"}</span></td>
                <td className="text-gray-500">{ex.description || "—"}</td>
                <td>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(ex)} className="text-xs px-2 py-1 rounded hover:bg-purple-900/20 text-gray-400">✎</button>
                    <button onClick={() => delMutation.mutate(ex.id)} className="text-xs px-2 py-1 rounded text-red-500/50 hover:text-red-400">✕</button>
                  </div>
                </td>
              </tr>
            ))}
            {excl.length === 0 && <tr><td colSpan={5} className="text-center text-gray-600 py-8">Нет исключений</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Accounts Tab ──────────────────────────────────────────────────────────────

function AccountsTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["accounts", page, search],
    queryFn: () => api.listAccounts({ page, size: 50, search }),
  });

  const delMutation = useMutation({
    mutationFn: (id: number) => api.deleteAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  const discoverMutation = useMutation({
    mutationFn: api.discoverAccounts,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  const accounts = data?.accounts ?? [];

  const RISK_CLS: Record<string, string> = { critical: "badge-critical", high: "badge-high", medium: "badge-medium", low: "badge-low" };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <input className="siem-input flex-1 text-sm" placeholder="Поиск..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <button onClick={() => discoverMutation.mutate()} disabled={discoverMutation.isPending} className="siem-btn-ghost text-xs py-2 px-3 disabled:opacity-50">
          {discoverMutation.isPending ? "⟳ Сканирование..." : "⟳ Обнаружение"}
        </button>
        <span className="text-xs text-gray-600">Всего: {data?.total ?? 0}</span>
      </div>

      {isLoading ? <div className="text-center text-gray-600 py-8">Загрузка...</div> : (
        <table className="w-full siem-table">
          <thead><tr><th>Пользователь</th><th>Домен</th><th>Email</th><th>Риск</th><th>Привилег.</th><th>Сервисная</th><th>Последний раз</th><th></th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td className="font-medium text-gray-200">{a.display_name || a.username}</td>
                <td className="text-gray-500">{a.domain || "—"}</td>
                <td className="text-gray-500">{a.email || "—"}</td>
                <td><span className={RISK_CLS[a.risk_level.toLowerCase()] ?? "badge-info"}>{a.risk_level}</span></td>
                <td><span className={a.is_privileged ? "badge-critical" : "badge-fp"}>{a.is_privileged ? "Да" : "Нет"}</span></td>
                <td><span className={a.is_service_account ? "badge-medium" : "badge-fp"}>{a.is_service_account ? "Да" : "Нет"}</span></td>
                <td className="text-gray-600 text-xs">{a.last_seen ? new Date(a.last_seen).toLocaleString("ru-RU") : "—"}</td>
                <td><button onClick={() => delMutation.mutate(a.id)} className="text-xs text-red-500/50 hover:text-red-400 px-1">✕</button></td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={8} className="text-center text-gray-600 py-8">Нет учётных записей</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Stub tabs ─────────────────────────────────────────────────────────────────

function StubTab({ label, icon = "📋" }: { label: string; icon?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-3 h-full">
      <div className="text-5xl">{icon}</div>
      <div className="text-gray-500 text-sm font-medium">{label}</div>
      <div className="text-gray-700 text-xs">Раздел в разработке</div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DataStorage() {
  const [activeTab, setActiveTab] = useState<SubTab>("correlation-rules");

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* Sub-nav */}
      <div className="flex border-b overflow-x-auto flex-shrink-0" style={{ borderColor: "#1a0d2e", background: "#0d0f18" }}>
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0"
            style={{
              color: activeTab === t.id ? "#BF40BF" : "#64748b",
              borderBottom: activeTab === t.id ? "2px solid #BF40BF" : "2px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "correlation-rules" && <CorrelationRulesTab />}
        {activeTab === "exclusions"        && <ExclusionsTab />}
        {activeTab === "accounts"          && <AccountsTab />}
        {activeTab === "enrichment-rules"  && <StubTab label="Правила обогащения" icon="🔀" />}
        {activeTab === "references"        && <StubTab label="Справочники" icon="📚" />}
        {activeTab === "table-lists"       && <StubTab label="Табличные списки" icon="📊" />}
        {activeTab === "profiles"          && <StubTab label="Профили" icon="👤" />}
        {activeTab === "infrastructure"    && <StubTab label="Инфраструктура" icon="🏗️" />}
        {activeTab === "source-monitoring" && <StubTab label="Мониторинг источников" icon="📡" />}
        {activeTab === "tasks"             && <StubTab label="Задачи хранилища" icon="✅" />}
      </div>
    </div>
  );
}
