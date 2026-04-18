import { useState } from "react";

interface SavedQuery {
  id: string;
  name: string;
  description: string;
  pdql: string;
  timeRange: string;
  starred: boolean;
  created_at: string;
}

const SAVED_QUERIES_KEY = "ursus_saved_queries";

const PRESETS: SavedQuery[] = [
  {
    id: "preset-1", name: "Ошибки за последний час", description: "Все события уровня ERROR",
    pdql: 'filter(level = "ERROR") | sort(time desc) | limit(100)',
    timeRange: "1h", starred: true, created_at: new Date().toISOString(),
  },
  {
    id: "preset-2", name: "Критические события", description: "CRITICAL и ERROR уровни",
    pdql: 'filter(level in ["ERROR", "CRITICAL"]) | sort(time desc) | limit(200)',
    timeRange: "24h", starred: false, created_at: new Date().toISOString(),
  },
  {
    id: "preset-3", name: "Попытки входа с ошибкой", description: "Неудачные попытки аутентификации",
    pdql: 'filter(category.generic = "Authentication" and level = "ERROR") | sort(time desc) | limit(100)',
    timeRange: "6h", starred: false, created_at: new Date().toISOString(),
  },
  {
    id: "preset-4", name: "Сетевые события по IP", description: "Группировка по src.ip",
    pdql: 'filter(src.ip != "") | group(src.ip) | aggregate(count()) | sort(count desc) | limit(50)',
    timeRange: "1h", starred: false, created_at: new Date().toISOString(),
  },
  {
    id: "preset-5", name: "Атаки и разведка", description: "Подозрительная сетевая активность",
    pdql: 'filter(category.generic = "Attacks & Recon") | sort(time desc) | limit(100)',
    timeRange: "6h", starred: false, created_at: new Date().toISOString(),
  },
  {
    id: "preset-6", name: "Эскалация привилегий", description: "Попытки повышения прав",
    pdql: 'filter(category.high = "Privilege Escalation") | sort(time desc) | limit(100)',
    timeRange: "24h", starred: false, created_at: new Date().toISOString(),
  },
];

function loadUserQueries(): SavedQuery[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveUserQueries(qs: SavedQuery[]) {
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(qs));
}

interface SavedQueriesProps {
  currentPdql: string;
  onLoad: (pdql: string, timeRange: string) => void;
  onClose: () => void;
}

export default function SavedQueries({ currentPdql, onLoad, onClose }: SavedQueriesProps) {
  const [userQueries, setUserQueries] = useState<SavedQuery[]>(loadUserQueries);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [saveRange, setSaveRange] = useState("1h");
  const [activeTab, setActiveTab] = useState<"presets" | "saved">("presets");

  const handleSave = () => {
    if (!saveName.trim()) return;
    const q: SavedQuery = {
      id: `uq-${Date.now()}`,
      name: saveName.trim(),
      description: saveDesc.trim(),
      pdql: currentPdql,
      timeRange: saveRange,
      starred: false,
      created_at: new Date().toISOString(),
    };
    const updated = [q, ...userQueries];
    setUserQueries(updated);
    saveUserQueries(updated);
    setSaveName("");
    setSaveDesc("");
    setShowSaveForm(false);
    setActiveTab("saved");
  };

  const handleDelete = (id: string) => {
    const updated = userQueries.filter((q) => q.id !== id);
    setUserQueries(updated);
    saveUserQueries(updated);
  };

  const handleStar = (id: string) => {
    const updated = userQueries.map((q) =>
      q.id === id ? { ...q, starred: !q.starred } : q
    );
    setUserQueries(updated);
    saveUserQueries(updated);
  };

  const displayList = activeTab === "presets" ? PRESETS : userQueries;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="siem-card w-full max-w-xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold text-gray-200">Сохранённые запросы</h3>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          {(["presets", "saved"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-5 py-2 text-xs font-medium transition-colors"
              style={{
                color: activeTab === tab ? "#a78bfa" : "#64748b",
                borderBottom: activeTab === tab ? "2px solid #a78bfa" : "2px solid transparent",
              }}
            >
              {tab === "presets" ? "Шаблоны" : `Мои запросы (${userQueries.length})`}
            </button>
          ))}
        </div>

        {/* Save form */}
        {activeTab === "saved" && (
          <div className="flex-shrink-0 px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            {showSaveForm ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="siem-input text-sm"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Название запроса"
                    autoFocus
                  />
                  <select
                    className="siem-input text-sm"
                    value={saveRange}
                    onChange={(e) => setSaveRange(e.target.value)}
                  >
                    {["15m", "1h", "6h", "12h", "24h", "7d"].map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <input
                  className="siem-input w-full text-sm"
                  value={saveDesc}
                  onChange={(e) => setSaveDesc(e.target.value)}
                  placeholder="Описание (необязательно)"
                />
                <div
                  className="font-mono text-[10px] px-2 py-1 rounded truncate"
                  style={{ background: "#111827", color: "#a78bfa", border: "1px solid #374151" }}
                >
                  {currentPdql || "— пустой запрос —"}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={!saveName.trim()} className="siem-btn text-xs px-3 py-1.5 disabled:opacity-50">Сохранить</button>
                  <button onClick={() => setShowSaveForm(false)} className="siem-btn-ghost text-xs px-3 py-1.5">Отмена</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowSaveForm(true)} className="siem-btn text-xs px-3 py-1.5">
                + Сохранить текущий запрос
              </button>
            )}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {displayList.length === 0 ? (
            <div className="p-8 text-center text-gray-600 text-sm">
              {activeTab === "saved" ? "Нет сохранённых запросов" : "Нет шаблонов"}
            </div>
          ) : (
            displayList.map((q) => (
              <div
                key={q.id}
                className="px-5 py-3 border-b hover:bg-white/[0.02] transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {activeTab === "saved" && (
                        <button
                          onClick={() => handleStar(q.id)}
                          className="text-sm flex-shrink-0"
                          title={q.starred ? "Убрать из избранного" : "В избранное"}
                        >
                          {q.starred ? "⭐" : "☆"}
                        </button>
                      )}
                      <span className="text-xs font-semibold text-gray-200">{q.name}</span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}
                      >
                        {q.timeRange}
                      </span>
                    </div>
                    {q.description && (
                      <p className="text-[10px] text-gray-600 mt-0.5">{q.description}</p>
                    )}
                    <div
                      className="font-mono text-[10px] mt-1 truncate px-1.5 py-0.5 rounded"
                      style={{ background: "#111827", color: "#6b7280" }}
                    >
                      {q.pdql}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => { onLoad(q.pdql, q.timeRange); onClose(); }}
                      className="siem-btn text-[10px] px-2 py-1"
                    >
                      Загрузить
                    </button>
                    {activeTab === "saved" && (
                      <button
                        onClick={() => handleDelete(q.id)}
                        className="text-[10px] px-2 py-1 rounded"
                        style={{ color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
