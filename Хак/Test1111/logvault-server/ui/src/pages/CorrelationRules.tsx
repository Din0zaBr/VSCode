import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CorrelationRule } from "../api/client";
import { isAdmin } from "../api/client";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "text-red-400 bg-red-500/10 border-red-500/30",
  HIGH: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  MEDIUM: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  LOW: "text-blue-400 bg-blue-500/10 border-blue-500/30",
};

export default function CorrelationRules() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState<CorrelationRule | null>(null);
  const [form, setForm] = useState({ id: "", name: "", description: "", severity: "MEDIUM", enabled: true, conditionsRaw: '{"type":"threshold","pattern":"","window_sec":60,"count":5,"group_by":"source_ip"}' });

  const { data: rules, isLoading } = useQuery({ queryKey: ["corr-rules"], queryFn: api.correlationRules });

  const saveMutation = useMutation({
    mutationFn: (data: CorrelationRule) => editRule ? api.updateCorrelationRule(data.id, data) : api.createCorrelationRule(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["corr-rules"] }); setShowForm(false); setEditRule(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCorrelationRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corr-rules"] }),
  });

  const openCreate = () => {
    setEditRule(null);
    setForm({ id: "", name: "", description: "", severity: "MEDIUM", enabled: true, conditionsRaw: '{"type":"threshold","pattern":"","window_sec":60,"count":5,"group_by":"source_ip"}' });
    setShowForm(true);
  };

  const openEdit = (rule: CorrelationRule) => {
    setEditRule(rule);
    setForm({ id: rule.id, name: rule.name, description: rule.description ?? "", severity: rule.severity, enabled: rule.enabled, conditionsRaw: JSON.stringify(rule.conditions, null, 2) });
    setShowForm(true);
  };

  const handleSave = () => {
    try {
      const conditions = JSON.parse(form.conditionsRaw);
      saveMutation.mutate({ id: form.id || `rule-${Date.now()}`, name: form.name, description: form.description, severity: form.severity, enabled: form.enabled, conditions, hit_count: 0 });
    } catch {
      alert("Невалидный JSON в поле conditions");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-100">Правила корреляции</h2>
        {isAdmin() && <button onClick={openCreate} className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors">+ Создать правило</button>}
      </div>

      {showForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-100">{editRule ? "Редактировать правило" : "Новое правило"}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">ID</label>
              <input value={form.id} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} disabled={!!editRule} placeholder="rule-id" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500 disabled:opacity-50" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Название</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Severity</label>
              <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
                {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="enabled" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="w-4 h-4" />
              <label htmlFor="enabled" className="text-sm text-gray-300">Включено</label>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Описание</label>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500" />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Conditions (JSON)</label>
            <textarea value={form.conditionsRaw} onChange={(e) => setForm((f) => ({ ...f, conditionsRaw: e.target.value }))} rows={6} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-green-300 font-mono focus:outline-none focus:border-vault-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saveMutation.isPending} className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors">Отмена</button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center text-gray-500 py-12">Загрузка...</div>}

      <div className="space-y-2">
        {(rules ?? []).map((rule) => (
          <div key={rule.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-4">
            <div className={`w-2 h-2 rounded-full ${rule.enabled ? "bg-green-500" : "bg-gray-600"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-100">{rule.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${SEVERITY_COLORS[rule.severity] ?? "text-gray-400"}`}>{rule.severity}</span>
                <span className="text-xs text-gray-500">{(rule.conditions as any)?.type ?? "?"}</span>
              </div>
              {rule.description && <div className="text-xs text-gray-500 mt-0.5">{rule.description}</div>}
              <div className="text-xs text-gray-600 mt-0.5">Срабатываний: {rule.hit_count ?? 0}</div>
            </div>
            {isAdmin() && (
              <div className="flex gap-2">
                <button onClick={() => openEdit(rule)} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors">Изменить</button>
                <button onClick={() => deleteMutation.mutate(rule.id)} className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-400 rounded-lg transition-colors">Удалить</button>
              </div>
            )}
          </div>
        ))}
        {!isLoading && !rules?.length && <div className="text-center text-gray-500 py-8">Нет правил</div>}
      </div>
    </div>
  );
}
