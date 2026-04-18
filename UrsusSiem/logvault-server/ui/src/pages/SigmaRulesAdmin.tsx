import { useEffect, useState } from "react";
import { api } from "../api/client";

interface SigmaRule {
  id: string;
  title: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  yaml: string;
  enabled: boolean;
  created_at: string;
}

export default function SigmaRulesAdmin() {
  const [rules, setRules] = useState<SigmaRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SigmaRule>({
    id: "",
    title: "",
    description: "",
    severity: "MEDIUM",
    category: "",
    yaml: "",
    enabled: true,
    created_at: new Date().toISOString(),
  });
  const [searchFilter, setSearchFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");

  useEffect(() => {
    const loadRules = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await api.listSigmaRules({
          category: categoryFilter || undefined,
          search: searchFilter || undefined,
          severity: severityFilter || undefined,
        });
        const rulesArray = Array.isArray(response) ? response : response.data || [];
        setRules(rulesArray);
        if (rulesArray.length > 0 && !selectedId) {
          setSelectedId(rulesArray[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load SIGMA rules");
        setRules([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadRules();
  }, [searchFilter, categoryFilter, severityFilter]);

  const handleNew = () => {
    setForm({
      id: "",
      title: "",
      description: "",
      severity: "MEDIUM",
      category: "",
      yaml: "",
      enabled: true,
      created_at: new Date().toISOString(),
    });
    setSelectedId(null);
    setShowForm(true);
  };

  const handleEdit = (r: SigmaRule) => {
    setForm({ ...r });
    setSelectedId(r.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title || !form.yaml) return;
    try {
      if (selectedId && rules.find((r) => r.id === selectedId)) {
        // Update existing rule
        await api.updateSigmaRule(selectedId, form);
        setRules(rules.map((r) => (r.id === selectedId ? form : r)));
      } else {
        // Create new rule
        const newRule = await api.createSigmaRule(form);
        setRules([newRule, ...rules]);
        setSelectedId(newRule.id);
      }
      setShowForm(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rule");
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Удалить правило?")) {
      try {
        await api.deleteSigmaRule(id);
        setRules(rules.filter((r) => r.id !== id));
        setSelectedId(null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete rule");
      }
    }
  };

  const toggleEnabled = async (id: string) => {
    try {
      const rule = rules.find((r) => r.id === id);
      if (rule) {
        await api.toggleSigmaRule(id, !rule.enabled);
        setRules(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle rule");
    }
  };

  const selected = rules.find((r) => r.id === selectedId);

  const SEV_COLORS: Record<string, string> = {
    CRITICAL: "#f87171",
    HIGH: "#fb923c",
    MEDIUM: "#facc15",
    LOW: "#60a5fa",
  };

  if (isLoading) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin mb-3">⏳</div>
          <p className="text-gray-500">Загрузка SIGMA правил...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 mb-1">SIGMA Правила</h2>
        <p className="text-sm text-gray-500">Управление {rules.length} правилами корреляции для обнаружения угроз</p>
      </div>

      {error && (
        <div className="p-3 rounded border" style={{ borderColor: "#f87171", backgroundColor: "rgba(248, 113, 113, 0.1)", color: "#f87171" }}>
          <div className="text-sm font-medium">{error}</div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              placeholder="Поиск правил..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="siem-input text-sm flex-1"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="siem-input text-sm"
            >
              <option value="">Все категории</option>
              <option value="Credential Access">Credential Access</option>
              <option value="Privilege Escalation">Privilege Escalation</option>
              <option value="Execution">Execution</option>
              <option value="Exfiltration">Exfiltration</option>
              <option value="Command and Control">Command and Control</option>
              <option value="Impact">Impact</option>
            </select>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="siem-input text-sm"
            >
              <option value="">Все критичности</option>
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>
          <button onClick={handleNew} className="siem-btn text-xs px-4 py-2 whitespace-nowrap">
            + Новое правило
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-300">
            Правила ({rules.length})
            <span className="text-xs text-gray-600 ml-2">
              ({rules.filter((r) => r.enabled).length} активно)
            </span>
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* List */}
          <div className="lg:col-span-1 space-y-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="siem-card p-3 cursor-pointer transition-all hover:scale-[1.02]"
                style={{
                  background: selectedId === r.id ? "rgba(167,139,250,0.15)" : undefined,
                  borderColor: selectedId === r.id ? "#a78bfa" : undefined,
                }}
                onClick={() => setSelectedId(r.id)}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleEnabled(r.id);
                    }}
                    className="w-4 h-4 mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-200 truncate">{r.title}</div>
                    <div className="text-[10px] text-gray-600 truncate mt-0.5">{r.category}</div>
                    <div className="flex items-center gap-1 mt-1">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: `${SEV_COLORS[r.severity]}33`, color: SEV_COLORS[r.severity] }}
                      >
                        {r.severity}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Details */}
          <div className="lg:col-span-2">
            {selected ? (
              <div className="siem-card p-4 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-200">{selected.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{selected.description}</p>
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: `${SEV_COLORS[selected.severity]}33`, color: SEV_COLORS[selected.severity] }}
                  >
                    {selected.severity}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-gray-600">Категория:</span>
                    <span className="text-gray-300 ml-1">{selected.category}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Статус:</span>
                    <span className="text-gray-300 ml-1">{selected.enabled ? "🟢 Включено" : "🔴 Отключено"}</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-600 uppercase block mb-2">YAML</label>
                  <div
                    className="bg-gray-900 border rounded p-3 font-mono text-[11px] overflow-x-auto max-h-48 overflow-y-auto"
                    style={{ borderColor: "var(--border)", color: "#c9d1d9" }}
                  >
                    {selected.yaml.split("\n").map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                  <button onClick={() => handleEdit(selected)} className="siem-btn-ghost text-xs px-3 py-1.5 flex-1">
                    Редактировать
                  </button>
                  <button
                    onClick={() => toggleEnabled(selected.id)}
                    className="siem-btn-ghost text-xs px-3 py-1.5"
                  >
                    {selected.enabled ? "Отключить" : "Включить"}
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
                  <div className="text-4xl mb-2">📋</div>
                  <div className="text-gray-500 text-sm">Выберите правило</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="siem-card w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-lg font-semibold text-gray-200">
                {selectedId ? "Редактировать правило" : "Новое правило"}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-gray-600 hover:text-gray-400">
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase block mb-2">Название</label>
                  <input
                    className="siem-input w-full text-sm"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase block mb-2">Категория</label>
                  <input
                    className="siem-input w-full text-sm"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase block mb-2">Описание</label>
                <textarea
                  className="siem-input w-full text-sm resize-none"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase block mb-2">Критичность</label>
                  <select
                    className="siem-input w-full text-sm"
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value as SigmaRule["severity"] })}
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-xs text-gray-400">Включено</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase block mb-2">YAML</label>
                <textarea
                  className="siem-input w-full text-sm font-mono resize-none"
                  rows={8}
                  value={form.yaml}
                  onChange={(e) => setForm({ ...form, yaml: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setShowForm(false)} className="siem-btn-ghost text-xs px-4 py-2">
                Отмена
              </button>
              <button onClick={handleSave} disabled={!form.title || !form.yaml} className="siem-btn text-xs px-4 py-2 disabled:opacity-50">
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
