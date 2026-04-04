import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAdmin } from "../api/client";
import type { Asset } from "../api/client";

const CRITICALITY_COLORS: Record<string, string> = {
  CRITICAL: "text-red-400",
  HIGH: "text-orange-400",
  MEDIUM: "text-yellow-400",
  LOW: "text-blue-400",
};

export default function Assets() {
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
        <h2 className="text-2xl font-bold text-gray-100">Активы (хосты)</h2>
        {isAdmin() && (
          <div className="flex gap-2">
            <button onClick={() => discoverMutation.mutate()} disabled={discoverMutation.isPending} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {discoverMutation.isPending ? "Обнаружение..." : "Авто-обнаружение"}
            </button>
            <button onClick={openCreate} className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors">+ Добавить</button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Поиск по hostname/IP..." className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-vault-500 w-64" />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
          <option value="">Все статусы</option>
          {["active", "inactive", "decommissioned"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={critFilter} onChange={(e) => { setCritFilter(e.target.value); setPage(1); }} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
          <option value="">Все критичности</option>
          {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-100">{editAsset ? "Редактировать" : "Новый актив"}</h3>
          <div className="grid grid-cols-2 gap-4">
            {(["hostname", "ip", "os", "department", "owner"] as const).map((f) => (
              <div key={f}>
                <label className="text-xs text-gray-400 mb-1 block capitalize">{f}</label>
                <input value={form[f]} onChange={(e) => setForm((d) => ({ ...d, [f]: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500" />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Criticality</label>
              <select value={form.criticality} onChange={(e) => setForm((d) => ({ ...d, criticality: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
                {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Status</label>
              <select value={form.status} onChange={(e) => setForm((d) => ({ ...d, status: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
                {["active", "inactive", "decommissioned"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Заметки</label>
            <textarea value={form.notes} onChange={(e) => setForm((d) => ({ ...d, notes: e.target.value }))} rows={2} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">Сохранить</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors">Отмена</button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center text-gray-500 py-12">Загрузка...</div>}

      <div className="overflow-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800">
              {["Hostname", "IP", "OS", "Отдел", "Критичность", "Статус", "Последний раз", ""].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.assets ?? []).map((a: Asset) => (
              <tr key={a.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                <td className="px-4 py-2 text-gray-200 font-mono text-xs">{a.hostname}</td>
                <td className="px-4 py-2 text-gray-400 text-xs">{a.ip}</td>
                <td className="px-4 py-2 text-gray-400 text-xs">{a.os}</td>
                <td className="px-4 py-2 text-gray-400 text-xs">{a.department}</td>
                <td className={`px-4 py-2 text-xs font-medium ${CRITICALITY_COLORS[a.criticality] ?? "text-gray-400"}`}>{a.criticality}</td>
                <td className="px-4 py-2 text-gray-400 text-xs">{a.status}</td>
                <td className="px-4 py-2 text-gray-500 text-xs">{a.last_seen ? new Date(a.last_seen).toLocaleString("ru") : "—"}</td>
                <td className="px-4 py-2">
                  {isAdmin() && (
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(a)} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors">✏️</button>
                      <button onClick={() => deleteMutation.mutate(a.id)} className="px-2 py-1 text-xs bg-red-900/40 hover:bg-red-800/40 text-red-400 rounded transition-colors">🗑</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !data?.assets?.length && (
              <tr><td colSpan={8} className="text-center text-gray-500 py-8">Нет активов</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-sm transition-colors">Prev</button>
          <span className="text-sm text-gray-400">Стр. {page} / {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-sm transition-colors">Next</button>
        </div>
      )}
    </div>
  );
}
