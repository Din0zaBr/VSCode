import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAdmin } from "../api/client";
import type { Exclusion } from "../api/client";

export default function Exclusions() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editEx, setEditEx] = useState<Exclusion | null>(null);
  const [form, setForm] = useState({ name: "", description: "", exclusion_type: "ip", field: "src.ip", operator: "=", value: "", enabled: true, scope: "all", expires_at: "" });
  const size = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["exclusions", page, typeFilter],
    queryFn: () => api.listExclusions({ page, size, type: typeFilter }),
  });

  const saveMutation = useMutation({
    mutationFn: (d: typeof form) => {
      const body = { name: d.name, description: d.description, exclusion_type: d.exclusion_type, conditions: { field: d.field, operator: d.operator, value: d.value }, enabled: d.enabled, scope: d.scope, expires_at: d.expires_at || null };
      return editEx ? api.updateExclusion(editEx.id, body) : api.createExclusion(body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exclusions"] }); setShowForm(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteExclusion(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exclusions"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: (ex: Exclusion) => api.updateExclusion(ex.id, { ...ex, conditions: ex.conditions as any, enabled: !ex.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exclusions"] }),
  });

  const openCreate = () => { setEditEx(null); setForm({ name: "", description: "", exclusion_type: "ip", field: "src.ip", operator: "=", value: "", enabled: true, scope: "all", expires_at: "" }); setShowForm(true); };
  const openEdit = (ex: Exclusion) => {
    const cond = ex.conditions as any;
    setEditEx(ex);
    setForm({ name: ex.name, description: ex.description ?? "", exclusion_type: ex.exclusion_type, field: cond?.field ?? "", operator: cond?.operator ?? "=", value: cond?.value ?? "", enabled: ex.enabled, scope: ex.scope ?? "all", expires_at: ex.expires_at ?? "" });
    setShowForm(true);
  };

  const totalPages = data ? Math.ceil(data.total / size) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-100">Исключения</h2>
        {isAdmin() && <button onClick={openCreate} className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors">+ Создать</button>}
      </div>

      <div className="flex gap-2">
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
          <option value="">Все типы</option>
          {["event", "host", "user", "ip", "rule"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-100">{editEx ? "Редактировать исключение" : "Новое исключение"}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Название</label>
              <input value={form.name} onChange={(e) => setForm((d) => ({ ...d, name: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Тип</label>
              <select value={form.exclusion_type} onChange={(e) => setForm((d) => ({ ...d, exclusion_type: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
                {["event", "host", "user", "ip", "rule"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="text-sm text-gray-400 font-medium mt-2">Условие</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Поле</label>
              <input value={form.field} onChange={(e) => setForm((d) => ({ ...d, field: e.target.value }))} placeholder="src.ip" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-vault-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Оператор</label>
              <select value={form.operator} onChange={(e) => setForm((d) => ({ ...d, operator: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
                {["=", "contains", "startswith", "regex"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Значение</label>
              <input value={form.value} onChange={(e) => setForm((d) => ({ ...d, value: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-vault-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Область применения</label>
              <select value={form.scope} onChange={(e) => setForm((d) => ({ ...d, scope: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
                {["all", "correlation", "alerts"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Истекает (оставить пустым = бессрочно)</label>
              <input type="datetime-local" value={form.expires_at} onChange={(e) => setForm((d) => ({ ...d, expires_at: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">Сохранить</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors">Отмена</button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center text-gray-500 py-12">Загрузка...</div>}

      <div className="space-y-2">
        {(data?.exclusions ?? []).map((ex: Exclusion) => (
          <div key={ex.id} className={`bg-gray-800 border rounded-xl p-4 flex items-center gap-4 ${ex.enabled ? "border-gray-700" : "border-gray-800 opacity-60"}`}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-100">{ex.name}</span>
                <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-400 rounded">{ex.exclusion_type}</span>
                <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-400 rounded">{ex.scope}</span>
                {!ex.enabled && <span className="text-xs text-gray-600">отключено</span>}
              </div>
              <div className="text-xs text-gray-500 font-mono mt-1">
                {(ex.conditions as any)?.field} {(ex.conditions as any)?.operator} "{(ex.conditions as any)?.value}"
              </div>
              {ex.expires_at && <div className="text-xs text-gray-600">Истекает: {new Date(ex.expires_at).toLocaleString("ru")}</div>}
            </div>
            {isAdmin() && (
              <div className="flex gap-2">
                <button onClick={() => toggleMutation.mutate(ex)} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${ex.enabled ? "bg-gray-700 hover:bg-gray-600 text-gray-300" : "bg-green-900/40 hover:bg-green-800/40 text-purple-300"}`}>
                  {ex.enabled ? "Отключить" : "Включить"}
                </button>
                <button onClick={() => openEdit(ex)} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors">Изменить</button>
                <button onClick={() => deleteMutation.mutate(ex.id)} className="px-3 py-1.5 text-xs bg-red-900/40 hover:bg-red-800/40 text-red-400 rounded-lg transition-colors">Удалить</button>
              </div>
            )}
          </div>
        ))}
        {!isLoading && !data?.exclusions?.length && <div className="text-center text-gray-500 py-8">Нет исключений</div>}
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
