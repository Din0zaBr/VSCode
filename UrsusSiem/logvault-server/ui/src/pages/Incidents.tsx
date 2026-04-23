import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { CorrelationAlert } from "../api/client";
import {
  getIncidentExtra, saveIncidentExtra,
} from "../api/client";
import type { IncidentExtra, IncidentTask, IncidentNote, IncidentHistoryEntry } from "../api/client";

// ── Constants ────────────────────────────────────────────────────────────────

const TABS = ["Инциденты", "Задачи", "Статистика"] as const;
type Tab = typeof TABS[number];

const SEVERITY_MAP: Record<string, { badge: string; label: string }> = {
  CRITICAL: { badge: "badge-critical", label: "Критический" },
  HIGH:     { badge: "badge-high",     label: "Высокий" },
  MEDIUM:   { badge: "badge-medium",   label: "Средний" },
  LOW:      { badge: "badge-low",      label: "Низкий" },
};

const STATUS_MAP: Record<string, { badge: string; label: string }> = {
  OPEN:          { badge: "badge-open",          label: "Открыт" },
  INVESTIGATING: { badge: "badge-investigating", label: "Расследуется" },
  RESOLVED:      { badge: "badge-resolved",      label: "Закрыт" },
  FALSE_POSITIVE:{ badge: "badge-fp",            label: "Ложное срабатывание" },
};

const CATEGORY_OPTIONS = ["Вредоносное ПО", "Несанкционированный доступ", "Утечка данных", "DoS/DDoS", "Фишинг", "Брутфорс", "Аномалия", "Другое"];
const TYPE_OPTIONS      = ["Автоматический", "Ручной", "Корреляция", "Обогащение"];
const IMPACT_OPTIONS    = ["Критическое", "Высокое", "Среднее", "Низкое", "Нет"];

function fmtDt(ts: string): string {
  try { return new Date(ts).toLocaleString("ru-RU"); } catch { return ts; }
}

function uid(): string { return `id-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function buildBaseEventQuery(eventRef: unknown): string {
  const normalized = String(eventRef ?? "").trim();
  if (!normalized) return 'filter() | sort(time desc)';
  if (/^\d+$/.test(normalized)) {
    return `filter(id = ${normalized} OR event_id_raw = ${normalized} OR event_id = "${normalized}") | sort(time desc)`;
  }
  return `filter(event_id = "${normalized.replace(/"/g, "'")}") | sort(time desc)`;
}

// ── PDF Print ────────────────────────────────────────────────────────────────

function printIncident(alert: CorrelationAlert, extra: IncidentExtra) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>Инцидент #${alert.id}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 40px; color: #222; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #666; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  td, th { border: 1px solid #ddd; padding: 6px 10px; font-size: 12px; text-align: left; }
  th { background: #f0e6ff; font-weight: bold; }
  .section { font-size: 14px; font-weight: bold; margin: 16px 0 8px; color: var(--accent-secondary); border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
  .badge-critical { background: #fee2e2; color: #991b1b; }
  .badge-open { background: #fef9c3; color: #854d0e; }
  .badge-resolved { background: #dcfce7; color: #166534; }
  ul { margin: 0; padding-left: 16px; font-size: 12px; }
  li { margin-bottom: 3px; }
  pre { background: #f5f5f5; padding: 10px; font-size: 11px; border-radius: 4px; }
</style></head><body>
<h1>Инцидент #${alert.id} — ${alert.rule_name}</h1>
<div class="subtitle">Сгенерировано: ${new Date().toLocaleString("ru-RU")} | URSUS Insight SIEM</div>
<div class="section">Основная информация</div>
<table>
  <tr><th>Параметр</th><th>Значение</th></tr>
  <tr><td>ID</td><td>#${alert.id}</td></tr>
  <tr><td>Правило</td><td>${alert.rule_name}</td></tr>
  <tr><td>Критичность</td><td>${alert.severity}</td></tr>
  <tr><td>Статус</td><td>${STATUS_MAP[alert.status]?.label || alert.status}</td></tr>
  <tr><td>Категория</td><td>${extra.category || "—"}</td></tr>
  <tr><td>Тип</td><td>${extra.type || "—"}</td></tr>
  <tr><td>Влияние</td><td>${extra.impact || "—"}</td></tr>
  <tr><td>Ответственный</td><td>${extra.assignee || "—"}</td></tr>
  <tr><td>Источник IP</td><td>${alert.source_ip || "—"}</td></tr>
  <tr><td>Описание</td><td>${alert.description || "—"}</td></tr>
  <tr><td>Обнаружен</td><td>${fmtDt(alert.created_at)}</td></tr>
</table>
<div class="section">Задачи (${extra.tasks.length})</div>
<ul>${extra.tasks.map((t) => `<li>[${t.done ? "x" : " "}] ${t.title}</li>`).join("") || "<li>Нет задач</li>"}</ul>
<div class="section">Заметки (${extra.notes.length})</div>
${extra.notes.map((n) => `<div style="margin-bottom:8px;font-size:12px;"><b>${fmtDt(n.created_at)} ${n.author ? "(" + n.author + ")" : ""}</b><br>${n.text}</div>`).join("") || "<p style='font-size:12px'>Нет заметок</p>"}
<div class="section">История изменений</div>
<ul>${extra.history.map((h) => `<li><b>${fmtDt(h.timestamp)}</b> — ${h.event}</li>`).join("") || "<li>Нет записей</li>"}</ul>
</body></html>`);
  win.document.close();
  win.print();
}

// ── Incident Detail Modal ────────────────────────────────────────────────────

function IncidentDetailModal({ alert, onClose, onStatusChange }: {
  alert: CorrelationAlert;
  onClose: () => void;
  onStatusChange: (id: number, status: string, notes?: string) => void;
}) {
  const navigate = useNavigate();
  const [extra, setExtra] = useState<IncidentExtra>(() => getIncidentExtra(alert.id));
  const [activeTab, setActiveTab] = useState<"info" | "tasks" | "notes" | "history">("info");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newNote, setNewNote] = useState("");
  const [editField, setEditField] = useState<keyof IncidentExtra | null>(null);
  const [editVal, setEditVal] = useState("");

  const persist = useCallback((updated: IncidentExtra) => {
    setExtra(updated);
    saveIncidentExtra(updated);
  }, []);

  const addHistoryEntry = useCallback((event: string, updated: IncidentExtra): IncidentExtra => {
    const entry: IncidentHistoryEntry = { id: uid(), event, timestamp: new Date().toISOString(), author: "me" };
    return { ...updated, history: [...updated.history, entry] };
  }, []);

  // tasks
  const addTask = () => {
    if (!newTaskTitle.trim()) return;
    const task: IncidentTask = { id: uid(), title: newTaskTitle.trim(), done: false, created_at: new Date().toISOString() };
    const updated = addHistoryEntry(`Добавлена задача: "${task.title}"`, { ...extra, tasks: [...extra.tasks, task] });
    persist(updated);
    setNewTaskTitle("");
  };
  const toggleTask = (id: string) => {
    const task = extra.tasks.find((t) => t.id === id);
    if (!task) return;
    const updated = { ...extra, tasks: extra.tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t) };
    persist(addHistoryEntry(`Задача "${task.title}" ${task.done ? "снята" : "выполнена"}`, updated));
  };
  const deleteTask = (id: string) => {
    const task = extra.tasks.find((t) => t.id === id);
    const updated = { ...extra, tasks: extra.tasks.filter((t) => t.id !== id) };
    persist(addHistoryEntry(`Удалена задача: "${task?.title}"`, updated));
  };

  // notes
  const addNote = () => {
    if (!newNote.trim()) return;
    const note: IncidentNote = { id: uid(), text: newNote.trim(), created_at: new Date().toISOString(), author: "me" };
    const updated = addHistoryEntry("Добавлена заметка", { ...extra, notes: [...extra.notes, note] });
    persist(updated);
    setNewNote("");
  };
  const deleteNote = (id: string) => {
    const updated = { ...extra, notes: extra.notes.filter((n) => n.id !== id) };
    persist(addHistoryEntry("Удалена заметка", updated));
  };

  // meta fields
  const startEdit = (field: "assignee" | "category" | "type" | "impact", val: string) => {
    setEditField(field);
    setEditVal(val ?? "");
  };
  const saveEdit = () => {
    if (!editField) return;
    const updated = addHistoryEntry(`Изменено поле "${editField}": ${extra[editField as keyof IncidentExtra] || "—"} → ${editVal}`, { ...extra, [editField]: editVal });
    persist(updated);
    setEditField(null);
  };

  const statusAction = (status: string) => {
    const prev = alert.status;
    onStatusChange(alert.id, status, extra.notes.map((n) => n.text).join("\n"));
    const updated = addHistoryEntry(`Статус изменён: ${STATUS_MAP[prev]?.label || prev} → ${STATUS_MAP[status]?.label || status}`, extra);
    persist(updated);
  };

  const eventIds: string[] = Array.isArray(alert.event_ids) ? alert.event_ids as string[] : [];

  const MODAL_TABS = [
    { id: "info",    label: "Инфо" },
    { id: "tasks",   label: `Задачи (${extra.tasks.length})` },
    { id: "notes",   label: `Заметки (${extra.notes.length})` },
    { id: "history", label: `История (${extra.history.length})` },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-[720px] max-h-[90vh] flex flex-col rounded-2xl border overflow-hidden" style={{ background: "var(--surface-panel)", borderColor: "var(--border-strong)" }}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono siem-fg-soft">#{alert.id}</span>
              <span className={SEVERITY_MAP[alert.severity]?.badge ?? "badge-info"}>
                {SEVERITY_MAP[alert.severity]?.label || alert.severity}
              </span>
              <span className={STATUS_MAP[alert.status]?.badge ?? "badge-info"}>
                {STATUS_MAP[alert.status]?.label || alert.status}
              </span>
            </div>
            <div className="text-base font-semibold siem-fg">{alert.rule_name}</div>
            <div className="text-xs siem-fg-soft mt-0.5">Обнаружен: {fmtDt(alert.created_at)}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => printIncident(alert, extra)}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: "rgba(47,79,79,0.3)", color: "#3d6565", border: "1px solid #2F4F4F" }}
              title="Скачать PDF"
            >
              ↓ PDF
            </button>
            <button onClick={onClose} className="siem-fg-soft hover:text-[color:var(--text)] text-xl leading-none">✕</button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          {MODAL_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="px-4 py-2.5 text-xs font-medium transition-colors"
              style={{
                color: activeTab === t.id ? "var(--accent)" : "var(--text-soft)",
                borderBottom: activeTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* INFO */}
          {activeTab === "info" && (
            <div className="space-y-3">
              {/* Meta fields */}
              <div className="grid grid-cols-2 gap-3">
                {([
                  { key: "assignee", label: "Ответственный", options: null },
                  { key: "category", label: "Категория",     options: CATEGORY_OPTIONS },
                  { key: "type",     label: "Тип",           options: TYPE_OPTIONS },
                  { key: "impact",   label: "Влияние",       options: IMPACT_OPTIONS },
                ] as const).map(({ key, label, options }) => (
                  <div key={key} className="rounded-lg p-3 border" style={{ background: "var(--surface-panel)", borderColor: "var(--border)" }}>
                    <div className="text-[10px] siem-fg-soft mb-1 uppercase tracking-wider">{label}</div>
                    {editField === key ? (
                      <div className="flex gap-1">
                        {options ? (
                          <select className="siem-input flex-1 text-xs py-1" value={editVal} onChange={(e) => setEditVal(e.target.value)}>
                            <option value="">—</option>
                            {options.map((o) => <option key={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input className="siem-input flex-1 text-xs py-1" value={editVal} onChange={(e) => setEditVal(e.target.value)} />
                        )}
                        <button onClick={saveEdit} className="text-xs px-2 py-1 rounded" style={{ background: "color-mix(in srgb, var(--accent) 30%, transparent)", color: "var(--accent)" }}>✓</button>
                        <button onClick={() => setEditField(null)} className="text-xs px-1.5 siem-fg-soft">✕</button>
                      </div>
                    ) : (
                      <div
                        className="text-sm siem-fg-muted cursor-pointer hover:text-[var(--text)] flex items-center justify-between group"
                        onClick={() => startEdit(key, (extra[key] as string) ?? "")}
                      >
                        <span>{(extra[key] as string) || "—"}</span>
                        <span className="text-[10px] siem-fg-soft group-hover:text-[color:var(--accent)] opacity-0 group-hover:opacity-100">✎</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Alert info */}
              <div className="rounded-lg p-3 border space-y-2" style={{ background: "var(--surface-panel)", borderColor: "var(--border)" }}>
                <div className="text-[10px] siem-fg-soft uppercase tracking-wider mb-1">Технические данные</div>
                {[
                  { label: "Источник IP", value: alert.source_ip },
                  { label: "Правило", value: alert.rule_id },
                  { label: "Описание", value: alert.description },
                ].filter((f) => f.value).map((f) => (
                  <div key={f.label} className="flex gap-3 text-xs">
                    <span className="siem-fg-soft w-24 flex-shrink-0">{f.label}</span>
                    <span className="siem-fg-muted">{f.value}</span>
                  </div>
                ))}
              </div>

              {/* Base events */}
              {eventIds.length > 0 && (
                <div className="rounded-lg p-3 border" style={{ background: "var(--surface-panel)", borderColor: "var(--border)" }}>
                  <div className="text-[10px] siem-fg-soft uppercase tracking-wider mb-2">Базовые события ({eventIds.length})</div>
                  <div className="flex flex-wrap gap-2">
                    {eventIds.map((eid) => (
                      <button
                        key={String(eid)}
                        onClick={() => navigate(`/events?q=${encodeURIComponent(buildBaseEventQuery(eid))}`)}
                        className="text-[11px] font-mono px-2 py-1 rounded hover:opacity-80 transition-opacity"
                        style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", color: "var(--accent)", border: "1px solid var(--border-strong)" }}
                      >
                        {String(eid)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Status actions */}
              <div className="rounded-lg p-3 border" style={{ background: "var(--surface-panel)", borderColor: "var(--border)" }}>
                <div className="text-[10px] siem-fg-soft uppercase tracking-wider mb-2">Действия</div>
                <div className="flex flex-wrap gap-2">
                  {alert.status !== "INVESTIGATING" && (
                    <button onClick={() => statusAction("INVESTIGATING")} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(234,179,8,0.15)", color: "#facc15", border: "1px solid rgba(234,179,8,0.3)" }}>
                      Расследую
                    </button>
                  )}
                  {alert.status !== "RESOLVED" && (
                    <button onClick={() => statusAction("RESOLVED")} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(34,197,94,0.12)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.25)" }}>
                      Закрыть
                    </button>
                  )}
                  {alert.status !== "FALSE_POSITIVE" && (
                    <button onClick={() => statusAction("FALSE_POSITIVE")} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(100,116,139,0.12)", color: "var(--text-muted)", border: "1px solid rgba(100,116,139,0.25)" }}>
                      Ложное срабатывание
                    </button>
                  )}
                  {alert.status !== "OPEN" && (
                    <button onClick={() => statusAction("OPEN")} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}>
                      Переоткрыть
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TASKS */}
          {activeTab === "tasks" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  className="siem-input flex-1 text-sm"
                  placeholder="Название задачи..."
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTask()}
                />
                <button onClick={addTask} className="siem-btn text-xs px-4">+ Добавить</button>
              </div>
              {extra.tasks.length === 0 && <div className="text-center siem-fg-soft py-8 text-sm">Нет задач</div>}
              {extra.tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 p-3 rounded-lg border" style={{ background: "var(--surface-panel)", borderColor: "var(--border)" }}>
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={() => toggleTask(task.id)}
                    className="w-4 h-4 accent-violet-500 flex-shrink-0"
                  />
                  <span className={`flex-1 text-sm ${task.done ? "line-through siem-fg-soft" : "siem-fg"}`}>{task.title}</span>
                  <span className="text-[10px] siem-fg-soft">{fmtDt(task.created_at)}</span>
                  <button onClick={() => deleteTask(task.id)} className="text-red-500/50 hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
            </div>
          )}

          {/* NOTES */}
          {activeTab === "notes" && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2">
                <textarea
                  className="siem-input text-sm min-h-[80px] resize-none"
                  placeholder="Введите заметку..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <button onClick={addNote} className="siem-btn text-xs self-end px-4">+ Добавить заметку</button>
              </div>
              {extra.notes.length === 0 && <div className="text-center siem-fg-soft py-8 text-sm">Нет заметок</div>}
              {[...extra.notes].reverse().map((note) => (
                <div key={note.id} className="p-3 rounded-lg border" style={{ background: "var(--surface-panel)", borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] siem-fg-soft">{fmtDt(note.created_at)}{note.author ? ` · ${note.author}` : ""}</span>
                    <button onClick={() => deleteNote(note.id)} className="text-red-500/40 hover:text-red-400 text-xs">✕</button>
                  </div>
                  <div className="text-sm siem-fg-muted whitespace-pre-wrap">{note.text}</div>
                </div>
              ))}
            </div>
          )}

          {/* HISTORY */}
          {activeTab === "history" && (
            <div className="space-y-0">
              {extra.history.length === 0 && <div className="text-center siem-fg-soft py-8 text-sm">Нет записей</div>}
              {[...extra.history].reverse().map((h, idx) => (
                <div key={h.id} className="flex gap-3 items-start pb-3">
                  <div className="flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ background: "var(--accent-secondary)" }} />
                    {idx < extra.history.length - 1 && <div className="w-px flex-1 mt-1" style={{ background: "var(--border-strong)", minHeight: "20px" }} />}
                  </div>
                  <div>
                    <div className="text-xs siem-fg-muted">{h.event}</div>
                    <div className="text-[10px] siem-fg-soft mt-0.5">{fmtDt(h.timestamp)}{h.author ? ` · ${h.author}` : ""}</div>
                  </div>
                </div>
              ))}
              {/* Creation entry */}
              <div className="flex gap-3 items-start">
                <div className="w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0" style={{ background: "#2F4F4F" }} />
                <div>
                  <div className="text-xs siem-fg-muted">Инцидент обнаружен системой</div>
                  <div className="text-[10px] siem-fg-soft mt-0.5">{fmtDt(alert.created_at)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Create Manual Incident Modal ─────────────────────────────────────────────

function CreateIncidentModal({ onClose }: { onClose: (refresh?: boolean) => void }) {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const initTitle = searchParams.get("title") || "";
  const [form, setForm] = useState({ name: initTitle, severity: "MEDIUM", description: "" });

  // We use a correlation-alert compatible structure by creating a note
  const createMutation = useMutation({
    mutationFn: () =>
      api.createCorrelationRule({
        id: `manual-${Date.now()}`,
        name: form.name,
        description: form.description,
        severity: form.severity,
        enabled: true,
        conditions: { type: "manual" },
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["corr-alerts"] }); onClose(true); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[480px] rounded-2xl border" style={{ background: "var(--surface-panel)", borderColor: "var(--border-strong)" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--accent)" }}>Создать инцидент вручную</span>
          <button onClick={() => onClose()} className="siem-fg-soft hover:text-[color:var(--text)]">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs siem-fg-soft mb-1 block">Название *</label>
            <input className="siem-input w-full" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Название инцидента" />
          </div>
          <div>
            <label className="text-xs siem-fg-soft mb-1 block">Критичность</label>
            <select className="siem-input w-full" value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs siem-fg-soft mb-1 block">Описание</label>
            <textarea className="siem-input w-full min-h-[80px] resize-none" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => onClose()} className="siem-btn-ghost text-sm">Отмена</button>
            <button onClick={() => createMutation.mutate()} disabled={!form.name || createMutation.isPending} className="siem-btn text-sm disabled:opacity-50">
              {createMutation.isPending ? "Создание..." : "Создать"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Statistics Tab ───────────────────────────────────────────────────────────

function StatsTab({ alerts }: { alerts: CorrelationAlert[] }) {
  const bySeverity = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => ({
    label: s, count: alerts.filter((a) => a.severity === s).length,
  }));
  const byStatus = ["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"].map((s) => ({
    label: STATUS_MAP[s]?.label || s, count: alerts.filter((a) => a.status === s).length,
  }));
  const maxS = Math.max(...bySeverity.map((b) => b.count), 1);
  const maxSt = Math.max(...byStatus.map((b) => b.count), 1);

  const colorS: Record<string, string> = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308", LOW: "#3b82f6" };
  const colorSt: Record<string, string> = { Открыт: "#ef4444", Расследуется: "#eab308", Закрыт: "#4ade80", "Ложное срабатывание": "var(--text-soft)" };

  return (
    <div className="p-6 space-y-8">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Всего", value: alerts.length, color: "var(--accent)" },
          { label: "Открытых", value: alerts.filter((a) => a.status === "OPEN").length, color: "#ef4444" },
          { label: "Расследуется", value: alerts.filter((a) => a.status === "INVESTIGATING").length, color: "#eab308" },
          { label: "Закрыто", value: alerts.filter((a) => a.status === "RESOLVED").length, color: "#4ade80" },
        ].map((s) => (
          <div key={s.label} className="siem-card p-4">
            <div className="text-xs siem-fg-soft uppercase tracking-wider mb-2">{s.label}</div>
            <div className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="siem-card p-4">
          <div className="text-sm font-semibold siem-fg-muted mb-4">По критичности</div>
          <div className="space-y-3">
            {bySeverity.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-xs w-20 flex-shrink-0" style={{ color: colorS[b.label] }}>{b.label}</span>
                <div className="flex-1 h-5 rounded-sm overflow-hidden" style={{ background: "var(--surface-panel)" }}>
                  <div className="h-full rounded-sm transition-all duration-500"
                    style={{ width: `${(b.count / maxS) * 100}%`, background: colorS[b.label], opacity: 0.8 }} />
                </div>
                <span className="text-xs siem-fg-muted w-8 text-right">{b.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="siem-card p-4">
          <div className="text-sm font-semibold siem-fg-muted mb-4">По статусу</div>
          <div className="space-y-3">
            {byStatus.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-xs w-32 flex-shrink-0 truncate" style={{ color: colorSt[b.label] ?? "var(--text-soft)" }}>{b.label}</span>
                <div className="flex-1 h-5 rounded-sm overflow-hidden" style={{ background: "var(--surface-panel)" }}>
                  <div className="h-full rounded-sm transition-all duration-500"
                    style={{ width: `${(b.count / maxSt) * 100}%`, background: colorSt[b.label] ?? "var(--text-soft)", opacity: 0.7 }} />
                </div>
                <span className="text-xs siem-fg-muted w-8 text-right">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tasks Overview Tab ───────────────────────────────────────────────────────

function TasksOverviewTab() {
  const { data } = useQuery({
    queryKey: ["corr-alerts-tasks"],
    queryFn: () => api.correlationAlerts({ limit: 200 }),
  });

  const allAlerts = data?.alerts ?? [];
  const tasksWithIncident = allAlerts.flatMap((a) => {
    const extra = getIncidentExtra(a.id);
    return extra.tasks.map((t) => ({ ...t, incidentId: a.id, incidentName: a.rule_name }));
  });

  const pending = tasksWithIncident.filter((t) => !t.done);
  const done    = tasksWithIncident.filter((t) => t.done);

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="siem-card p-4">
          <div className="text-xs siem-fg-soft uppercase tracking-wider mb-1">Ожидают</div>
          <div className="text-3xl font-bold" style={{ color: "#eab308" }}>{pending.length}</div>
        </div>
        <div className="siem-card p-4">
          <div className="text-xs siem-fg-soft uppercase tracking-wider mb-1">Выполнено</div>
          <div className="text-3xl font-bold" style={{ color: "#4ade80" }}>{done.length}</div>
        </div>
      </div>

      <div className="siem-card overflow-hidden">
        <div className="px-4 py-3 border-b text-sm font-semibold siem-fg-muted" style={{ borderColor: "var(--border)" }}>
          Все задачи по инцидентам
        </div>
        {tasksWithIncident.length === 0 && (
          <div className="text-center siem-fg-soft py-8 text-sm">Нет задач</div>
        )}
        {tasksWithIncident.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${t.done ? "bg-green-500" : "bg-yellow-500"}`} />
            <span className={`flex-1 text-sm ${t.done ? "line-through siem-fg-soft" : "siem-fg"}`}>{t.title}</span>
            <span className="text-[10px] siem-fg-soft">#{t.incidentId} · {t.incidentName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Incidents List ───────────────────────────────────────────────────────────

function IncidentsList() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter]   = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedAlert, setSelectedAlert] = useState<CorrelationAlert | null>(() => {
    const id = searchParams.get("id");
    return id ? null : null; // will be set after data loads
  });
  const [showCreate, setShowCreate] = useState(searchParams.get("create") === "1");
  const PAGE = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["corr-alerts", statusFilter, severityFilter, page],
    queryFn: () => api.correlationAlerts({ limit: PAGE, offset: (page - 1) * PAGE, status: statusFilter, severity: severityFilter }),
    refetchInterval: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes?: string }) =>
      api.updateCorrelationAlertStatus(id, status, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corr-alerts"] }),
  });

  const alerts = data?.alerts ?? [];
  const filtered = search
    ? alerts.filter((a) => a.rule_name.toLowerCase().includes(search.toLowerCase()) || String(a.id).includes(search))
    : alerts;
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE);

  return (
    <>
      {/* Filters */}
      <div className="px-4 py-3 border-b flex items-center gap-3 flex-wrap flex-shrink-0" style={{ borderColor: "var(--border)" }}>
        <input
          className="siem-input text-xs py-1.5 flex-1 min-w-[200px]"
          placeholder="Поиск по названию, ID..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select className="siem-input text-xs py-1.5" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">Все статусы</option>
          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="siem-input text-xs py-1.5" value={severityFilter} onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}>
          <option value="">Все критичности</option>
          {Object.entries(SEVERITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={() => setShowCreate(true)} className="siem-btn text-xs py-1.5 flex-shrink-0">+ Создать</button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="text-center siem-fg-soft py-16">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center siem-fg-soft py-16">
            <div className="text-3xl mb-2" style={{ color: "var(--border-strong)" }}>⚠</div>
            <div>Инцидентов не найдено</div>
          </div>
        ) : (
          <table className="w-full siem-table">
            <thead className="sticky top-0" style={{ background: "var(--surface-panel)" }}>
              <tr>
                <th>ID</th>
                <th>Название</th>
                <th>Критичность</th>
                <th>Статус</th>
                <th>Источник</th>
                <th>Ответственный</th>
                <th>Обнаружен</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const extra = getIncidentExtra(a.id);
                return (
                  <tr key={a.id} className="cursor-pointer" onClick={() => setSelectedAlert(a)}>
                    <td className="font-mono siem-fg-soft text-xs">#{a.id}</td>
                    <td>
                      <div className="text-sm siem-fg font-medium">{a.rule_name}</div>
                      {a.description && <div className="text-[10px] siem-fg-soft truncate max-w-[300px]">{a.description}</div>}
                    </td>
                    <td><span className={SEVERITY_MAP[a.severity]?.badge ?? "badge-info"}>{SEVERITY_MAP[a.severity]?.label || a.severity}</span></td>
                    <td><span className={STATUS_MAP[a.status]?.badge ?? "badge-info"}>{STATUS_MAP[a.status]?.label || a.status}</span></td>
                    <td className="text-xs siem-fg-soft">{a.source_ip || "—"}</td>
                    <td className="text-xs siem-fg-muted">{extra.assignee || <span className="siem-fg-soft">—</span>}</td>
                    <td className="text-xs siem-fg-soft font-mono">{fmtDt(a.created_at)}</td>
                    <td>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {a.status === "OPEN" && (
                          <button
                            onClick={() => updateMutation.mutate({ id: a.id, status: "INVESTIGATING" })}
                            className="text-[10px] px-2 py-1 rounded"
                            style={{ background: "rgba(234,179,8,0.15)", color: "#facc15" }}
                          >
                            Расследую
                          </button>
                        )}
                        {a.status !== "RESOLVED" && (
                          <button
                            onClick={() => updateMutation.mutate({ id: a.id, status: "RESOLVED" })}
                            className="text-[10px] px-2 py-1 rounded"
                            style={{ background: "rgba(34,197,94,0.12)", color: "#4ade80" }}
                          >
                            Закрыть
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          <span className="text-xs siem-fg-soft">{total} инцидентов</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="siem-btn-ghost text-xs px-3 py-1 disabled:opacity-30">←</button>
            <span className="text-xs siem-fg-soft">Стр. {page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="siem-btn-ghost text-xs px-3 py-1 disabled:opacity-30">→</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {selectedAlert && (
        <IncidentDetailModal
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onStatusChange={(id, status, notes) => updateMutation.mutate({ id, status, notes })}
        />
      )}
      {showCreate && <CreateIncidentModal onClose={(r) => { setShowCreate(false); if (r) qc.invalidateQueries({ queryKey: ["corr-alerts"] }); }} />}
    </>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Incidents() {
  const [tab, setTab] = useState<Tab>("Инциденты");

  const { data: allData } = useQuery({
    queryKey: ["corr-alerts-all"],
    queryFn: () => api.correlationAlerts({ limit: 500 }),
    refetchInterval: 60_000,
  });
  const allAlerts = allData?.alerts ?? [];

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* Section header + sub-tabs */}
      <div className="flex items-center gap-0 border-b flex-shrink-0 px-4" style={{ borderColor: "var(--border)", background: "var(--surface-panel)" }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-5 py-3 text-sm font-medium transition-colors"
            style={{
              color: tab === t ? "var(--accent)" : "var(--text-soft)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            {t}
            {t === "Инциденты" && allData && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                {allAlerts.filter((a) => a.status === "OPEN").length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "Инциденты" && <IncidentsList />}
        {tab === "Задачи" && <div className="flex-1 overflow-auto"><TasksOverviewTab /></div>}
        {tab === "Статистика" && <div className="flex-1 overflow-auto"><StatsTab alerts={allAlerts} /></div>}
      </div>
    </div>
  );
}
