import { useState } from "react";

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

const EXAMPLE_RULES: SigmaRule[] = [
  {
    id: "rule-001",
    title: "Brute Force Login Attempt",
    description: "Detects multiple failed login attempts from a single source",
    severity: "HIGH",
    category: "Credential Access",
    yaml: `title: Brute Force Login Attempt
id: rule-brute-force-001
status: experimental
logsource:
  category: authentication
detection:
  selection:
    action: failure
    reason: invalid_credentials
  condition: selection | count(src.ip) > 5 | timeframe 5m
level: high`,
    enabled: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "rule-002",
    title: "Privilege Escalation",
    description: "Detects privilege escalation attempts",
    severity: "CRITICAL",
    category: "Privilege Escalation",
    yaml: `title: Privilege Escalation
id: rule-priv-esc-001
status: experimental
logsource:
  category: process_creation
detection:
  selection:
    action: execute
    privilege_level: admin
  condition: selection
level: critical`,
    enabled: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "rule-003",
    title: "Suspicious Process Execution",
    description: "Detects execution of suspicious processes",
    severity: "MEDIUM",
    category: "Execution",
    yaml: `title: Suspicious Process Execution
id: rule-susp-proc-001
status: experimental
logsource:
  category: process_creation
detection:
  selection:
    process_name|endswith:
      - powershell.exe
      - cmd.exe
  filter:
    parent_process: explorer.exe
  condition: selection and not filter
level: medium`,
    enabled: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "rule-004",
    title: "Data Exfiltration",
    description: "Detects potential data exfiltration",
    severity: "HIGH",
    category: "Exfiltration",
    yaml: `title: Data Exfiltration
id: rule-exfil-001
status: experimental
logsource:
  category: network_connection
detection:
  selection:
    destination_port: 443
    traffic_volume_bytes: '>1000000'
  condition: selection
level: high`,
    enabled: false,
    created_at: new Date().toISOString(),
  },
];

export default function SigmaRulesAdmin() {
  const RULES_KEY = "ursus_sigma_rules";
  const [rules, setRules] = useState<SigmaRule[]>(() => {
    try {
      const stored = localStorage.getItem(RULES_KEY);
      return stored ? JSON.parse(stored) : EXAMPLE_RULES;
    } catch {
      return EXAMPLE_RULES;
    }
  });
  const [selectedId, setSelectedId] = useState<string | null>(rules[0]?.id || null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SigmaRule>(EXAMPLE_RULES[0]);

  const saveRules = (updated: SigmaRule[]) => {
    setRules(updated);
    localStorage.setItem(RULES_KEY, JSON.stringify(updated));
  };

  const handleNew = () => {
    setForm({
      id: `rule-${Date.now()}`,
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

  const handleSave = () => {
    if (!form.title || !form.yaml) return;
    if (selectedId && rules.find((r) => r.id === selectedId)) {
      saveRules(rules.map((r) => (r.id === selectedId ? form : r)));
    } else {
      saveRules([form, ...rules]);
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (confirm("Удалить правило?")) {
      saveRules(rules.filter((r) => r.id !== id));
      setSelectedId(null);
    }
  };

  const toggleEnabled = (id: string) => {
    saveRules(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  const selected = rules.find((r) => r.id === selectedId);

  const SEV_COLORS: Record<string, string> = {
    CRITICAL: "#f87171",
    HIGH: "#fb923c",
    MEDIUM: "#facc15",
    LOW: "#60a5fa",
  };

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 mb-1">SIGMA Правила</h2>
        <p className="text-sm text-gray-500">Управление правилами корреляции для обнаружения угроз</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-300">
            Правила ({rules.length})
            <span className="text-xs text-gray-600 ml-2">
              ({rules.filter((r) => r.enabled).length} активно)
            </span>
          </span>
          <button onClick={handleNew} className="siem-btn text-xs px-4 py-2">
            + Новое правило
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* List */}
          <div className="lg:col-span-1 space-y-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="siem-card p-3 cursor-pointer transition-all hover:scale-[1.02]"
                style={{
                  background: selectedId === r.id ? "rgba(106,13,173,0.15)" : undefined,
                  borderColor: selectedId === r.id ? "#BF40BF" : undefined,
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
                    style={{ borderColor: "#1a0d2e", color: "#c9d1d9" }}
                  >
                    {selected.yaml.split("\n").map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t" style={{ borderColor: "#1a0d2e" }}>
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
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#1a0d2e" }}>
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

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "#1a0d2e" }}>
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
