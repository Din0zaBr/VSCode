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
        <h2 className="siem-page-title">Исключения</h2>
        {isAdmin() && (
          <button type="button" onClick={openCreate} className="siem-btn text-sm">
            + Создать
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="siem-input text-sm min-w-[160px]"
        >
          <option value="">Все типы</option>
          {["event", "host", "user", "ip", "rule"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="siem-card rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold siem-fg">{editEx ? "Редактировать исключение" : "Новое исключение"}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Название</label>
              <input value={form.name} onChange={(e) => setForm((d) => ({ ...d, name: e.target.value }))} className="siem-input w-full text-sm" />
            </div>
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Тип</label>
              <select value={form.exclusion_type} onChange={(e) => setForm((d) => ({ ...d, exclusion_type: e.target.value }))} className="siem-input w-full text-sm">
                {["event", "host", "user", "ip", "rule"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="text-sm siem-fg-soft font-medium mt-2">Условие</div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Поле</label>
              <input value={form.field} onChange={(e) => setForm((d) => ({ ...d, field: e.target.value }))} placeholder="src.ip" className="siem-input w-full text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Оператор</label>
              <select value={form.operator} onChange={(e) => setForm((d) => ({ ...d, operator: e.target.value }))} className="siem-input w-full text-sm">
                {["=", "contains", "startswith", "regex"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Значение</label>
              <input value={form.value} onChange={(e) => setForm((d) => ({ ...d, value: e.target.value }))} className="siem-input w-full text-sm font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Область применения</label>
              <select value={form.scope} onChange={(e) => setForm((d) => ({ ...d, scope: e.target.value }))} className="siem-input w-full text-sm">
                {["all", "correlation", "alerts"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Истекает (оставить пустым = бессрочно)</label>
              <input type="datetime-local" value={form.expires_at} onChange={(e) => setForm((d) => ({ ...d, expires_at: e.target.value }))} className="siem-input w-full text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="siem-btn text-sm disabled:opacity-50">
              Сохранить
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="siem-btn-ghost text-sm">
              Отмена
            </button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center siem-fg-soft py-12">Загрузка...</div>}

      <div className="space-y-2">
        {(data?.exclusions ?? []).map((ex: Exclusion) => (
          <div key={ex.id} className={`siem-card rounded-xl p-4 flex items-center gap-4 ${!ex.enabled ? "opacity-60" : ""}`}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium siem-fg">{ex.name}</span>
                <span className="text-xs px-2 py-0.5 rounded border siem-fg-soft" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>{ex.exclusion_type}</span>
                <span className="text-xs px-2 py-0.5 rounded border siem-fg-soft" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>{ex.scope}</span>
                {!ex.enabled && <span className="text-xs siem-fg-soft">отключено</span>}
              </div>
              <div className="text-xs siem-fg-soft font-mono mt-1">
                {(ex.conditions as any)?.field} {(ex.conditions as any)?.operator} "{(ex.conditions as any)?.value}"
              </div>
              {ex.expires_at && <div className="text-xs siem-fg-soft">Истекает: {new Date(ex.expires_at).toLocaleString("ru")}</div>}
            </div>
            {isAdmin() && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => toggleMutation.mutate(ex)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    ex.enabled
                      ? "siem-btn-ghost"
                      : "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/15"
                  }`}
                >
                  {ex.enabled ? "Отключить" : "Включить"}
                </button>
                <button type="button" onClick={() => openEdit(ex)} className="siem-btn-ghost text-xs px-3 py-1.5">
                  Изменить
                </button>
                <button type="button" onClick={() => deleteMutation.mutate(ex.id)} className="text-xs px-3 py-1.5 rounded-lg border border-red-500/35 text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/15 transition-colors">
                  Удалить
                </button>
              </div>
            )}
          </div>
        ))}
        {!isLoading && !data?.exclusions?.length && <div className="text-center siem-fg-soft py-8">Нет исключений</div>}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="siem-btn-ghost text-sm px-3 py-1.5 disabled:opacity-40">
            Prev
          </button>
          <span className="text-sm siem-fg-soft">Стр. {page} / {totalPages}</span>
          <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="siem-btn-ghost text-sm px-3 py-1.5 disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
