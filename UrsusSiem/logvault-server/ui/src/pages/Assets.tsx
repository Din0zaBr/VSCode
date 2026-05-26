import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAdmin } from "../api/client";
import type { Asset, AgentInfo } from "../api/client";

const CRITICALITY_COLORS: Record<string, string> = {
  CRITICAL: "text-red-400",
  HIGH: "text-orange-400",
  MEDIUM: "text-yellow-400",
  LOW: "text-blue-400",
};

// ── Agents sub-tab ──────────────────────────────────────────────────────────

function AgentsTab() {
  const { data: agents, isLoading, refetch } = useQuery({
    queryKey: ["agents-list"],
    queryFn: api.listAgents,
    refetchInterval: 30_000,
  });
  const { data: metrics } = useQuery({
    queryKey: ["agent-metrics"],
    queryFn: api.latestAgentMetrics,
    refetchInterval: 30_000,
  });

  const serverBase = `${window.location.protocol}//${window.location.host}`;

  const metricsMap: Record<string, AgentInfo> = {};
  (metrics ?? []).forEach((m: AgentInfo) => { metricsMap[m.agent_id] = m; });

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold siem-fg">Агенты ({(agents ?? []).length})</h3>
          <p className="text-xs siem-fg-soft mt-0.5">Подключённые агенты сбора событий</p>
        </div>
        <button onClick={() => refetch()} className="siem-btn-ghost text-xs px-3 py-1.5">⟳ Обновить</button>
      </div>

      {/* Connection info */}
      <div className="siem-card p-4 space-y-1.5">
        <div className="text-xs font-semibold siem-fg-soft uppercase tracking-wider mb-2">Адрес для подключения агентов</div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs siem-fg-soft">Сервер:</span>
          <code className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: "var(--surface-inset)", color: "var(--accent)", border: "1px solid var(--border-strong)" }}>{serverBase}</code>
        </div>
        <div className="mt-2 text-xs siem-fg-soft">
          Установка агента:{" "}
          <code className="siem-fg-muted font-mono">
            curl -fsSL {serverBase}/api/agent/install | sudo bash -s -- --key &lt;API_KEY&gt;
          </code>
        </div>
        <div className="text-xs siem-fg-soft">
          Скачать скрипт (без Docker):{" "}
          <code className="siem-fg-muted font-mono">
            curl -fsSL {serverBase}/api/agent/install-native -o agent-linux.sh && sudo bash agent-linux.sh --server {serverBase} --key &lt;API_KEY&gt;
          </code>
        </div>
      </div>

      {/* Agents table */}
      {isLoading ? (
        <div className="text-center siem-fg-soft py-8">Загрузка...</div>
      ) : (agents ?? []).length === 0 ? (
        <div className="text-center siem-fg-soft py-12">
          <div className="text-4xl mb-3" style={{ color: "var(--border-strong)" }}>◎</div>
          <div className="text-sm siem-fg">Нет подключённых агентов</div>
          <div className="text-xs siem-fg-muted mt-1">Используйте команду выше для подключения первого агента</div>
        </div>
      ) : (
        <div className="space-y-2">
          {(agents ?? []).map((a: AgentInfo) => {
            const m = metricsMap[a.agent_id];
            const cpuPct = (m?.cpu as any)?.percent ?? null;
            const memPct = (m?.memory as any)?.percent ?? null;
            const lastSeen = new Date(a.timestamp);
            const isOnline = Date.now() - lastSeen.getTime() < 120_000;
            return (
              <div key={a.agent_id} className="siem-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5 ${isOnline ? "bg-green-500" : "bg-gray-600"}`} />
                    <div>
                      <div className="text-sm font-semibold siem-fg">{a.agent_id}</div>
                      <div className="text-xs siem-fg-soft">{a.host || "—"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs siem-fg-soft">
                    {cpuPct !== null && (
                      <span>CPU: <span className={cpuPct > 80 ? "text-red-500 dark:text-red-400" : "siem-fg-muted"}>{cpuPct.toFixed(1)}%</span></span>
                    )}
                    {memPct !== null && (
                      <span>RAM: <span className={memPct > 85 ? "text-red-500 dark:text-red-400" : "siem-fg-muted"}>{memPct.toFixed(1)}%</span></span>
                    )}
                    <span>Посл. сигнал: <span className={isOnline ? "text-violet-700 dark:text-purple-300" : "text-amber-600 dark:text-yellow-500"}>{lastSeen.toLocaleString("ru-RU")}</span></span>
                    <span className={isOnline ? "badge-resolved" : "badge-fp"}>{isOnline ? "Online" : "Offline"}</span>
                  </div>
                </div>
                {m && (
                  <div className="mt-2 ml-5.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] siem-fg-soft">
                    {(m.distro as any)?.name && <span>OS: {(m.distro as any).name} {(m.distro as any).version}</span>}
                    {(m.uptime as any)?.human && <span>Uptime: {(m.uptime as any).human}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Assets list ──────────────────────────────────────────────────────────────

function AssetsListTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [critFilter, setCritFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [form, setForm] = useState({ hostname: "", ip: "", os: "", department: "", owner: "", criticality: "MEDIUM", notes: "", status: "active" });
  const size = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["assets", page, search, statusFilter, critFilter],
    queryFn: () => api.listAssets({ page, size, search, status: statusFilter, criticality: critFilter }),
  });

  const saveMutation = useMutation({
    mutationFn: (d: typeof form) => editAsset ? api.updateAsset(editAsset.id, d) : api.createAsset(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assets"] }); setShowForm(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });

  const discoverMutation = useMutation({
    mutationFn: api.discoverAssets,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });

  const openCreate = () => { setEditAsset(null); setForm({ hostname: "", ip: "", os: "", department: "", owner: "", criticality: "MEDIUM", notes: "", status: "active" }); setShowForm(true); };
  const openEdit = (a: Asset) => { setEditAsset(a); setForm({ hostname: a.hostname, ip: a.ip ?? "", os: a.os ?? "", department: a.department ?? "", owner: a.owner ?? "", criticality: a.criticality, notes: a.notes ?? "", status: a.status }); setShowForm(true); };

  const totalPages = data ? Math.ceil(data.total / size) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="siem-page-title">Активы (хосты)</h2>
        {isAdmin() && (
          <div className="flex gap-2">
            <button type="button" onClick={() => discoverMutation.mutate()} disabled={discoverMutation.isPending} className="siem-btn-ghost text-sm px-4 py-2 disabled:opacity-50">
              {discoverMutation.isPending ? "Обнаружение..." : "Авто-обнаружение"}
            </button>
            <button onClick={openCreate} className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors">+ Добавить</button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Поиск по hostname/IP..." className="siem-input text-sm w-64" />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="siem-input text-sm min-w-[140px]">
          <option value="">Все статусы</option>
          {["active", "inactive", "decommissioned"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={critFilter} onChange={(e) => { setCritFilter(e.target.value); setPage(1); }} className="siem-input text-sm min-w-[160px]">
          <option value="">Все критичности</option>
          {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="siem-card rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold siem-fg">{editAsset ? "Редактировать" : "Новый актив"}</h3>
          <div className="grid grid-cols-2 gap-4">
            {(["hostname", "ip", "os", "department", "owner"] as const).map((f) => (
              <div key={f}>
                <label className="text-xs siem-fg-soft mb-1 block capitalize">{f}</label>
                <input value={form[f]} onChange={(e) => setForm((d) => ({ ...d, [f]: e.target.value }))} className="siem-input w-full text-sm" />
              </div>
            ))}
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Criticality</label>
              <select value={form.criticality} onChange={(e) => setForm((d) => ({ ...d, criticality: e.target.value }))} className="siem-input w-full text-sm">
                {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Status</label>
              <select value={form.status} onChange={(e) => setForm((d) => ({ ...d, status: e.target.value }))} className="siem-input w-full text-sm">
                {["active", "inactive", "decommissioned"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs siem-fg-soft mb-1 block">Заметки</label>
            <textarea value={form.notes} onChange={(e) => setForm((d) => ({ ...d, notes: e.target.value }))} rows={2} className="siem-input w-full text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="siem-btn text-sm disabled:opacity-50">Сохранить</button>
            <button type="button" onClick={() => setShowForm(false)} className="siem-btn-ghost text-sm">Отмена</button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center siem-fg-soft py-12">Загрузка...</div>}

      <div className="overflow-auto rounded-lg siem-card p-0">
        <table className="w-full text-sm siem-table">
          <thead>
            <tr>
              {["Hostname", "IP", "OS", "Отдел", "Критичность", "Статус", "Последний раз", ""].map((h) => (
                <th key={h} className="px-4 py-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.assets ?? []).map((a: Asset) => (
              <tr key={a.id}>
                <td className="px-4 py-2 siem-fg font-mono text-xs">{a.hostname}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.ip}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.os}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.department}</td>
                <td className={`px-4 py-2 text-xs font-medium ${CRITICALITY_COLORS[a.criticality] ?? "siem-fg-soft"}`}>{a.criticality}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.status}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.last_seen ? new Date(a.last_seen).toLocaleString("ru") : "—"}</td>
                <td className="px-4 py-2">
                  {isAdmin() && (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openEdit(a)} className="siem-btn-ghost text-xs px-2 py-1">✏️</button>
                      <button type="button" onClick={() => deleteMutation.mutate(a.id)} className="px-2 py-1 text-xs rounded border border-red-500/35 text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/15 transition-colors">🗑</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !data?.assets?.length && (
              <tr><td colSpan={8} className="text-center siem-fg-soft py-8">Нет активов</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="siem-btn-ghost text-sm px-3 py-1.5 disabled:opacity-40">Prev</button>
          <span className="text-sm siem-fg-soft">Стр. {page} / {totalPages}</span>
          <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="siem-btn-ghost text-sm px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

// ── Main Assets page with tabs ───────────────────────────────────────────────

export default function Assets() {
  const [tab, setTab] = useState<"assets" | "agents">("assets");

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      <div className="flex border-b flex-shrink-0" style={{ borderColor: "var(--border)", background: "var(--surface-panel)" }}>
        {(["assets", "agents"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-5 py-2.5 text-xs font-medium whitespace-nowrap transition-colors"
            style={{
              color: tab === t ? "var(--accent)" : "var(--text-soft)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
            }}>
            {t === "assets" ? "Активы (хосты)" : "Агенты"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === "assets"  && <AssetsListTab />}
        {tab === "agents"  && <AgentsTab />}
      </div>
    </div>
  );
}
