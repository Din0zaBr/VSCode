import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { LogEvent } from "../api/client";
import {
  getFieldsets, saveFieldsets, getQueryHistory, addQueryHistory, clearQueryHistory,
} from "../api/client";
import type { Fieldset, QueryHistoryItem } from "../api/client";
import GroupingConfig from "../components/GroupingConfig";
import AggregateSelector from "../components/AggregateSelector";
import QueryBuilder from "../components/QueryBuilder";
import SavedQueries from "../components/SavedQueries";

// ── Constants ────────────────────────────────────────────────────────────────

const QUICK_RANGES = [
  { label: "15 мин", value: "15m", ms: 15 * 60_000 },
  { label: "1 ч",   value: "1h",  ms: 60 * 60_000 },
  { label: "2 ч",   value: "2h",  ms: 2 * 60 * 60_000 },
  { label: "6 ч",   value: "6h",  ms: 6 * 60 * 60_000 },
  { label: "12 ч",  value: "12h", ms: 12 * 60 * 60_000 },
  { label: "24 ч",  value: "24h", ms: 24 * 60 * 60_000 },
  { label: "7 д",   value: "7d",  ms: 7 * 24 * 60 * 60_000 },
];

const FULL_FIELDSET_ID = "full_fld";

// All possible detail fields in display order
const DETAIL_FIELDS: { key: string; label: string }[] = [
  { key: "time",                         label: "Время" },
  { key: "event_type",                   label: "event_type" },
  { key: "category.generic",             label: "category.generic" },
  { key: "category.high",                label: "category.high" },
  { key: "category.low",                 label: "category.low" },
  { key: "detected_level",               label: "detected_level" },
  { key: "msgid",                        label: "msgid" },
  { key: "src.host",                     label: "src.host" },
  { key: "src.ip",                       label: "src.ip" },
  { key: "assigned_src_ip",             label: "assigned_src_ip" },
  { key: "src.port",                     label: "src.port" },
  { key: "src.geo.country",              label: "src.geo.country" },
  { key: "src.geo.org",                  label: "src.geo.org" },
  { key: "dst.hostname",                 label: "dst.hostname" },
  { key: "dst.host",                     label: "dst.host" },
  { key: "dst.ip",                       label: "dst.ip" },
  { key: "dst.port",                     label: "dst.port" },
  { key: "dst.geo.org",                  label: "dst.geo.org" },
  { key: "protocol",                     label: "protocol" },
  { key: "reason",                       label: "reason" },
  { key: "action",                       label: "action" },
  { key: "status",                       label: "status" },
  { key: "duration",                     label: "duration" },
  { key: "subject",                      label: "subject" },
  { key: "subject.domain",               label: "subject.domain" },
  { key: "subject.name",                 label: "subject.name" },
  { key: "subject.group",                label: "subject.group" },
  { key: "subject.type",                 label: "subject.type" },
  { key: "subject.version",              label: "subject.version" },
  { key: "subject.account.contact",      label: "subject.account.contact" },
  { key: "subject.account.domain",       label: "subject.account.domain" },
  { key: "subject.account.name",         label: "subject.account.name" },
  { key: "subject.account.id",           label: "subject.account.id" },
  { key: "subject.process.meta",         label: "subject.process.meta" },
  { key: "subject.process.cmdline",      label: "subject.process.cmdline" },
  { key: "subject.process.fullpath",     label: "subject.process.fullpath" },
  { key: "subject.process.id",           label: "subject.process.id" },
  { key: "subject.process.parent.id",    label: "subject.process.parent.id" },
  { key: "object",                       label: "object" },
  { key: "object.id",                    label: "object.id" },
  { key: "object.domain",                label: "object.domain" },
  { key: "object.name",                  label: "object.name" },
  { key: "object.account.contact",       label: "object.account.contact" },
  { key: "object.account.domain",        label: "object.account.domain" },
  { key: "object.account.name",          label: "object.account.name" },
  { key: "object.group",                 label: "object.group" },
  { key: "object.type",                  label: "object.type" },
  { key: "object.state",                 label: "object.state" },
  { key: "object.property",              label: "object.property" },
  { key: "object.path",                  label: "object.path" },
  { key: "object.fullpath",              label: "object.fullpath" },
  { key: "object.application.name",      label: "object.application.name" },
  { key: "object.process.name",          label: "object.process.name" },
  { key: "object.process.fullpath",      label: "object.process.fullpath" },
  { key: "object.process.cmdline",       label: "object.process.cmdline" },
  { key: "object.process.id",            label: "object.process.id" },
  { key: "object.process.parent.fullpath",label:"object.process.parent.fullpath" },
  { key: "object.process.parent.id",     label: "object.process.parent.id" },
  { key: "object.hash",                  label: "object.hash" },
  { key: "object.hash.md5",              label: "object.hash.md5" },
  { key: "object.hash.sha1",             label: "object.hash.sha1" },
  { key: "object.hash.sha256",           label: "object.hash.sha256" },
  { key: "object.process.hash",          label: "object.process.hash" },
  { key: "object.process.hash.md5",      label: "object.process.hash.md5" },
  { key: "object.process.hash.sha1",     label: "object.process.hash.sha1" },
  { key: "object.process.hash.sha256",   label: "object.process.hash.sha256" },
  { key: "object.value",                 label: "object.value" },
  { key: "object.new_value",             label: "object.new_value" },
  { key: "object.storage.name",          label: "object.storage.name" },
  { key: "object.storage.path",          label: "object.storage.path" },
  { key: "object.storage.fullpath",      label: "object.storage.fullpath" },
  { key: "object.vendor",                label: "object.vendor" },
  { key: "object.version",               label: "object.version" },
  { key: "count",                        label: "count" },
  { key: "count.bytes",                  label: "count.bytes" },
  { key: "count.bytes_in",               label: "count.bytes_in" },
  { key: "count.bytes_out",              label: "count.bytes_out" },
  { key: "datafield1",                   label: "datafield1" },
  { key: "datafield2",                   label: "datafield2" },
  { key: "datafield3",                   label: "datafield3" },
  { key: "datafield4",                   label: "datafield4" },
  { key: "datafield6",                   label: "datafield6" },
  { key: "datafield7",                   label: "datafield7" },
  { key: "datafield8",                   label: "datafield8" },
  { key: "datafield9",                   label: "datafield9" },
  { key: "event_src.host",               label: "event_src.host" },
  { key: "event_src.ip",                 label: "event_src.ip" },
  { key: "event_src.category",           label: "event_src.category" },
  { key: "event_src.vendor",             label: "event_src.vendor" },
  { key: "event_src.title",              label: "event_src.title" },
  { key: "event_src.subsys",             label: "event_src.subsys" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEventField(event: LogEvent, key: string): string {
  if (key === "time")        return event.timestamp;
  if (key === "text")        return event.message;
  if (key === "criticality") return deriveCriticality(event);
  if (key === "event_src.host") return (event.meta?.["event_src.host"] as string) || event.host || "";
  if (key === "event_src.ip")   return (event.meta?.["event_src.ip"]  as string) || "";
  // dot-notation lookup in meta
  const metaVal = event.meta?.[key];
  if (metaVal !== undefined && metaVal !== null) return String(metaVal);
  // nested dot path
  const parts = key.split(".");
  let cur: unknown = event.meta;
  for (const p of parts) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
    else { cur = undefined; break; }
  }
  return cur !== undefined && cur !== null ? String(cur) : "";
}

function deriveCriticality(event: LogEvent): string {
  const lvl = (event.level || "").toUpperCase();
  const sev = String(event.meta?.severity || event.meta?.["subject.type"] || "").toUpperCase();
  if (lvl === "CRITICAL" || sev === "CRITICAL") return "critical";
  if (lvl === "ERROR"    || sev === "HIGH")     return "high";
  if (lvl === "WARN" || lvl === "WARNING" || sev === "MEDIUM") return "medium";
  if (lvl === "INFO"     || sev === "LOW")      return "low";
  return "info";
}

function critDotClass(c: string): string {
  const map: Record<string, string> = {
    critical: "crit-dot crit-dot-critical",
    high:     "crit-dot crit-dot-high",
    medium:   "crit-dot crit-dot-medium",
    low:      "crit-dot crit-dot-low",
    info:     "crit-dot crit-dot-info",
  };
  return map[c] ?? "crit-dot crit-dot-info";
}

function isCorrelationEvent(event: LogEvent): boolean {
  return !!(event.meta?.corr_rule_id || event.meta?.["is_correlation"] || event.source === "correlation");
}

function fmtTime(ts: string): string {
  try { return new Date(ts).toLocaleString("ru-RU"); } catch { return ts; }
}

function fmtTimeShort(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts; }
}

function nowMinus(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

// ── Export functions ─────────────────────────────────────────────────────────

function exportCSV(events: LogEvent[], fields: string[]) {
  const header = fields.join(",");
  const rows = events.map((e) =>
    fields.map((f) => `"${getEventField(e, f).replace(/"/g, '""')}"`).join(",")
  );
  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, "events.csv");
}

function exportJSON(events: LogEvent[]) {
  const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
  downloadBlob(blob, "events.json");
}

function exportXML(events: LogEvent[], fields: string[]) {
  const rows = events.map((e) => {
    const fields_xml = fields
      .map((f) => `    <${f.replace(/\./g, "_")}>${escXml(getEventField(e, f))}</${f.replace(/\./g, "_")}>`)
      .join("\n");
    return `  <event>\n${fields_xml}\n  </event>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<events>\n${rows}\n</events>`;
  const blob = new Blob([xml], { type: "application/xml" });
  downloadBlob(blob, "events.xml");
}

function escXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function exportGroupedCSV(columns: string[], rows: Record<string, unknown>[]) {
  const header = columns.join(",");
  const lines = rows.map((row) =>
    columns.map((c) => `"${String(row[c] ?? "").replace(/"/g, '""')}"`).join(","),
  );
  const blob = new Blob([header + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, "groups.csv");
}

function exportGroupedJSON(columns: string[], rows: Record<string, unknown>[]) {
  const blob = new Blob([JSON.stringify({ columns, rows }, null, 2)], { type: "application/json" });
  downloadBlob(blob, "groups.json");
}

function exportGroupedXML(columns: string[], rows: Record<string, unknown>[]) {
  const body = rows.map((row, i) => {
    const cells = columns
      .map((c) => `    <f name="${escXml(c)}">${escXml(String(row[c] ?? ""))}</f>`)
      .join("\n");
    return `  <group idx="${i}">\n${cells}\n  </group>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<groups>\n${body}\n</groups>`;
  const blob = new Blob([xml], { type: "application/xml" });
  downloadBlob(blob, "groups.xml");
}

// ── PDQL Modal ───────────────────────────────────────────────────────────────

function PDQLModal({ value, onSave, onClose }: { value: string; onSave: (v: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[700px] max-h-[80vh] flex flex-col rounded-2xl border" style={{ background: "var(--surface-panel)", borderColor: "var(--border-strong)" }}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: "var(--accent)" }}>⚡ PDQL Редактор</span>
            <span className="text-xs siem-fg-soft">Полный запрос к каналу событий</span>
          </div>
          <button onClick={onClose} className="siem-fg-soft hover:text-[color:var(--text)] text-lg">✕</button>
        </div>
        <div className="px-4 py-2 text-xs siem-fg-soft border-b" style={{ borderColor: "var(--border)" }}>
          Команды через запятую или <code className="siem-fg-muted">|</code>:{" "}
          <span style={{ color: "var(--code-accent-2)" }}>filter</span>/<span style={{ color: "var(--code-accent-2)" }}>where</span>(предикаты),{" "}
          <span style={{ color: "var(--accent)" }}>select</span>(поля), <span style={{ color: "var(--accent-secondary)" }}>sort</span>, <span style={{ color: "#3d6565" }}>limit</span>.
          Операторы: <code className="siem-fg-muted">= != contains</code> и др.
        </div>
        <textarea
          className="flex-1 m-4 rounded-lg p-3 text-sm font-mono resize-none focus:outline-none"
          style={{ background: "var(--surface-inset)", color: "var(--accent)", border: "1px solid var(--border-strong)", minHeight: "300px" }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={`select(time, event_src.host, src.ip, text)\nwhere(src.ip = "192.168.1.1")\nsort(time desc)\nlimit(100)`}
        />
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button onClick={onClose} className="siem-btn-ghost px-4 py-2 text-sm">Отмена</button>
          <button onClick={() => { onSave(text); onClose(); }} className="siem-btn px-4 py-2 text-sm">Применить</button>
        </div>
      </div>
    </div>
  );
}

// ── Fieldset Manager Modal ───────────────────────────────────────────────────

function FieldsetManagerModal({ onClose, onSelect, currentFieldsetId }: {
  onClose: () => void;
  onSelect: (fs: Fieldset) => void;
  currentFieldsetId: string;
}) {
  const [fieldsets, setFieldsets] = useState<Fieldset[]>(getFieldsets());
  const [editing, setEditing] = useState<Fieldset | null>(null);
  const [newName, setNewName] = useState("");
  const [checkedFields, setCheckedFields] = useState<string[]>([]);
  const allFieldKeys = ["criticality", "time", "event_src.host", "text", ...DETAIL_FIELDS.map((f) => f.key)];
  const uniqueFields = [...new Set(allFieldKeys)];

  const startEdit = (fs: Fieldset) => {
    setEditing(fs);
    setNewName(fs.name);
    setCheckedFields([...fs.fields]);
  };

  const startCreate = () => {
    const nfs: Fieldset = { id: `fs-${Date.now()}`, name: "Новый филдсет", fields: ["time", "event_src.host", "text"] };
    setEditing(nfs);
    setNewName(nfs.name);
    setCheckedFields([...nfs.fields]);
  };

  const save = () => {
    if (!editing) return;
    if (editing.id === FULL_FIELDSET_ID) return;
    const updated = { ...editing, name: newName, fields: checkedFields };
    const idx = fieldsets.findIndex((f) => f.id === updated.id);
    let next: Fieldset[];
    if (idx >= 0) {
      next = fieldsets.map((f) => (f.id === updated.id ? updated : f));
    } else {
      next = [...fieldsets, updated];
    }
    setFieldsets(next);
    saveFieldsets(next);
    setEditing(null);
  };

  const del = (id: string) => {
    if (id === "default" || id === FULL_FIELDSET_ID) return;
    const next = fieldsets.filter((f) => f.id !== id);
    setFieldsets(next);
    saveFieldsets(next);
  };

  const toggleField = (key: string) => {
    setCheckedFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };
  const moveField = (idx: number, dir: -1 | 1) => {
    setCheckedFields((prev) => {
      const to = idx + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[800px] max-h-[85vh] flex rounded-2xl border overflow-hidden" style={{ background: "var(--surface-panel)", borderColor: "var(--border-strong)" }}>
        {/* Left: fieldset list */}
        <div className="w-56 border-r flex flex-col" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between px-3 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>Филдсеты</span>
            <button onClick={startCreate} className="text-xs px-2 py-1 rounded" style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", color: "var(--accent)" }}>+ Новый</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {fieldsets.map((fs) => (
              <div
                key={fs.id}
                className="flex items-center justify-between px-3 py-2 cursor-pointer border-b"
                style={{
                  borderColor: "var(--border)",
                  background: fs.id === currentFieldsetId ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "transparent",
                }}
              >
                <button onClick={() => onSelect(fs)} className="flex-1 text-left text-xs truncate" style={{ color: fs.id === currentFieldsetId ? "var(--accent)" : "var(--text-soft)" }}>
                  {fs.name}
                </button>
                <div className="flex gap-1">
                  {fs.id !== FULL_FIELDSET_ID && (
                    <button onClick={() => startEdit(fs)} className="text-[10px] siem-fg-soft hover:text-[color:var(--text)] px-1">✎</button>
                  )}
                  {!fs.isDefault && fs.id !== FULL_FIELDSET_ID && <button onClick={() => del(fs.id)} className="text-[10px] text-red-500/60 hover:text-red-400 px-1">✕</button>}
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
            <button onClick={onClose} className="w-full siem-btn-ghost text-xs py-1.5">Закрыть</button>
          </div>
        </div>

        {/* Right: field editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {editing ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <span className="text-xs siem-fg-muted">Название:</span>
                <input
                  className="siem-input text-xs py-1 flex-1"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="text-xs siem-fg-soft px-4 pt-2">Выберите отображаемые поля:</div>
              <div className="flex-1 overflow-y-auto px-4 py-2 grid grid-cols-3 gap-1 content-start">
                {uniqueFields.map((key) => (
                  <label key={key} className="flex items-center gap-1.5 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={checkedFields.includes(key)}
                      onChange={() => toggleField(key)}
                      className="accent-violet-500 w-3 h-3"
                    />
                    <span className="text-[11px] font-mono truncate" style={{ color: checkedFields.includes(key) ? "var(--accent)" : "var(--text-soft)" }}>{key}</span>
                  </label>
                ))}
              </div>
              <div className="px-4 pb-2">
                <div className="text-xs siem-fg-soft mb-1">Порядок отображения (в таблице):</div>
                <div className="max-h-36 overflow-y-auto rounded border p-1" style={{ borderColor: "var(--border)" }}>
                  {checkedFields.map((key, idx) => (
                    <div key={key} className="flex items-center gap-2 px-1 py-0.5">
                      <span className="text-[10px] w-5 siem-fg-soft">{idx + 1}</span>
                      <span className="text-[11px] font-mono flex-1 truncate" style={{ color: "var(--accent)" }}>{key}</span>
                      <button type="button" onClick={() => moveField(idx, -1)} className="text-[10px] px-1 rounded siem-btn-ghost">↑</button>
                      <button type="button" onClick={() => moveField(idx, 1)} className="text-[10px] px-1 rounded siem-btn-ghost">↓</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 px-4 pb-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <button onClick={() => setEditing(null)} className="siem-btn-ghost text-xs px-3 py-1.5">Отмена</button>
                <button onClick={save} className="siem-btn text-xs px-3 py-1.5">Сохранить</button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center siem-fg-soft text-sm">
              Выберите филдсет для редактирования
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Query History Modal ──────────────────────────────────────────────────────

function QueryHistoryModal({ onClose, onRestore }: {
  onClose: () => void;
  onRestore: (item: QueryHistoryItem) => void;
}) {
  const [history, setHistory] = useState<QueryHistoryItem[]>(getQueryHistory());
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40">
      <div className="w-[420px] h-full flex flex-col border-l" style={{ background: "var(--surface-panel)", borderColor: "var(--border-strong)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--accent)" }}>История запросов</span>
          <div className="flex gap-2">
            <button onClick={() => { clearQueryHistory(); setHistory([]); }} className="text-xs siem-fg-soft hover:text-red-400">Очистить</button>
            <button onClick={onClose} className="siem-fg-soft hover:text-[color:var(--text)]">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 && <div className="text-center siem-fg-soft py-12 text-sm">История пуста</div>}
          {history.map((item) => (
            <div
              key={item.id}
              className="px-4 py-3 border-b cursor-pointer hover:bg-purple-900/10 transition-colors"
              style={{ borderColor: "var(--border)" }}
              onClick={() => { onRestore(item); onClose(); }}
            >
              <div className="text-[11px] siem-fg-soft mb-1">{fmtTime(item.timestamp)}</div>
              <div className="text-xs font-mono truncate" style={{ color: "var(--accent)" }}>{item.pdql}</div>
              {item.label && <div className="text-[11px] siem-fg-muted mt-0.5">{item.label}</div>}
              <div className="text-[10px] siem-fg-soft mt-0.5">
                {item.timeRange.type === "relative" ? `Последние: ${item.timeRange.relative}` : `${item.timeRange.from} → ${item.timeRange.to}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Event Detail Panel ───────────────────────────────────────────────────────

function EventDetailPanel({ event, onClose, onAddFilter, onLinkIncident }: {
  event: LogEvent;
  onClose: () => void;
  onAddFilter: (key: string, value: string) => void;
  onLinkIncident: (event: LogEvent) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const crit = deriveCriticality(event);

  return (
    <div className="flex flex-col h-full overflow-hidden border-r" style={{ borderColor: "var(--border)", background: "var(--surface-panel)", width: "360px", flexShrink: 0 }}>
      {/* Header */}
      <div className="flex items-start justify-between px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex-1 pr-2">
          <div className="flex items-center gap-2 mb-1">
            <span className={critDotClass(crit)} />
            {isCorrelationEvent(event) && <span className="corr-star">★</span>}
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-soft)" }}>
              {event.level || "—"}
            </span>
          </div>
          <div className="text-xs font-medium leading-snug" style={{ color: "var(--text-muted)" }}>
            {event.message || "(нет сообщения)"}
          </div>
          <div className="text-[10px] mt-1" style={{ color: "var(--text-soft)" }}>{fmtTime(event.timestamp)}</div>
        </div>
        <button onClick={onClose} className="siem-fg-soft hover:text-[color:var(--text-muted)] text-sm flex-shrink-0 mt-0.5">✕</button>
      </div>

      {/* Scrollable fields */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {/* Top fields: level, source, host, agent */}
        {[
          { key: "event_id", label: "event_id", value: event.event_id },
          { key: "host",     label: "host",     value: event.host },
          { key: "agent_id", label: "agent_id", value: event.agent_id },
          { key: "source",   label: "source",   value: event.source },
          { key: "service",  label: "service",  value: event.service },
          { key: "level",    label: "level",    value: event.level },
        ].filter((f) => f.value !== undefined && f.value !== null && String(f.value).length > 0).map((f) => (
          <FieldRow key={f.key} fieldKey={f.key} label={f.label} value={f.value} onAddFilter={onAddFilter} />
        ))}

        {/* Divider */}
        <div className="my-1 mx-2 border-t" style={{ borderColor: "var(--border)" }} />

        {/* SIEM parsed fields */}
        {DETAIL_FIELDS.map(({ key, label }) => {
          const value = getEventField(event, key);
          if (!value) return null;
          return <FieldRow key={key} fieldKey={key} label={label} value={value} onAddFilter={onAddFilter} />;
        })}

        {/* Raw event */}
        <div className="mx-2 my-2">
          <button
            onClick={() => setShowRaw((s) => !s)}
            className="text-[11px] flex items-center gap-1 mb-1"
            style={{ color: "var(--accent-secondary)" }}
          >
            <span>{showRaw ? "▾" : "▸"}</span> Исходное событие (raw)
          </button>
          {showRaw && (
            <pre className="text-[10px] font-mono p-2 rounded leading-relaxed overflow-auto max-h-64"
              style={{ background: "var(--surface-inset)", color: "var(--text-muted)", border: "1px solid var(--border-strong)" }}>
              {JSON.stringify({ ...event }, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-t flex gap-2" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={() => onLinkIncident(event)}
          className="flex-1 text-xs py-1.5 rounded-lg transition-colors"
          style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", color: "var(--accent)", border: "1px solid var(--border-strong)" }}
        >
          + В инцидент
        </button>
      </div>
    </div>
  );
}

function FieldRow({ fieldKey, label, value, onAddFilter }: {
  fieldKey: string; label: string; value: string;
  onAddFilter: (k: string, v: string) => void;
}) {
  return (
    <div className="field-row group" onClick={() => onAddFilter(fieldKey, value)}>
      <span className="text-[10px] font-mono w-32 flex-shrink-0 truncate" style={{ color: "var(--accent-secondary)" }} title={label}>{label}</span>
      <span className="text-[11px] flex-1 break-all leading-tight" style={{ color: "var(--text-muted)" }}>{value}</span>
      <span className="field-add-btn">+ фильтр</span>
    </div>
  );
}

// ── Link to Incident Modal ───────────────────────────────────────────────────

function LinkIncidentModal({ event, onClose }: { event: LogEvent; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["corr-alerts-link"],
    queryFn: () => api.correlationAlerts({ limit: 100 }),
  });
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState(`Ручной инцидент ${new Date().toLocaleString("ru-RU")}`);
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[480px] rounded-2xl border" style={{ background: "var(--surface-panel)", borderColor: "var(--border-strong)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--accent)" }}>Привязка к инциденту</span>
          <button onClick={onClose} className="siem-fg-soft hover:text-[color:var(--text)]">✕</button>
        </div>
        <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
          <div className="text-xs siem-fg-soft mb-2">Событие: <span className="siem-fg-muted">{event.message}</span></div>
          {(data?.alerts ?? []).map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer hover:bg-purple-900/10 border"
              style={{ borderColor: "var(--border)" }}
            >
              <div>
                <div className="text-xs font-medium siem-fg">#{a.id} — {a.rule_name}</div>
                <div className="text-[10px] siem-fg-soft">{a.severity} · {a.status}</div>
              </div>
              <button
                className="text-xs px-2 py-1 rounded"
                style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", color: "var(--accent)" }}
                onClick={() => { navigate(`/incidents?id=${a.id}`); onClose(); }}
              >
                Привязать
              </button>
            </div>
          ))}
        </div>
        <div className="px-4 pb-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs siem-fg-muted mb-2">Или создать новый инцидент:</div>
          <div className="flex gap-2">
            <input
              className="siem-input flex-1 text-xs"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Название инцидента"
            />
            <button className="siem-btn text-xs px-3" onClick={() => { navigate(`/incidents?create=1&title=${encodeURIComponent(newTitle)}`); onClose(); }}>
              Создать
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Events Page ─────────────────────────────────────────────────────────

/** Split on commas or pipes only at nesting depth 0, respecting quotes and lists. */
function splitTopLevelDelim(input: string, sep: "," | "|"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function isPdqlCommand(chunk: string): boolean {
  return /^(filter|select|sort|limit|group|aggregate)\s*\(/i.test(chunk.trim());
}

function normalizeWhereToFilter(chunk: string): string {
  return chunk.trim().replace(/^where\s*\(/i, "filter(");
}

function normalizeFieldForPdql(field: string): string {
  if (field === "text") return "message";
  if (field === "criticality") return "level";
  return field;
}

/** Ensure select() lists include event_id so rows are addressable in the channel UI. */
function ensureEventIdInSelect(pipeline: string): string {
  const segments = pipeline.length ? splitTopLevelDelim(pipeline, "|") : [];
  return segments
    .map((seg) => {
      const s = seg.trim();
      if (!/^select\s*\(/i.test(s)) return s;
      const start = s.indexOf("(");
      if (start < 0) return s;
      let depth = 1;
      let i = start + 1;
      for (; i < s.length; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      const inner = s.slice(start + 1, i);
      const rest = s.slice(i + 1);
      const fields = splitTopLevelDelim(inner, ",")
        .map((f) => f.trim())
        .filter(Boolean);
      if (!fields.some((f) => /^event_id$/i.test(f))) {
        return `select(event_id, ${inner})${rest}`;
      }
      return s;
    })
    .join(" | ");
}

/**
 * Converts channel bar syntax into piped PDQL for the backend:
 * - Commas or pipes between commands (select(a,b), sort(time) keeps inner commas)
 * - where(...) → filter(...)
 * - Bare predicates (e.g. level != "INFO") are wrapped as filter(...)
 */
function buildPipelinePdql(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "sort(time desc)";

  const usePipe = trimmed.includes("|");
  const segments = usePipe ? splitTopLevelDelim(trimmed, "|") : splitTopLevelDelim(trimmed, ",");
  const normalized = segments
    .map((s) => normalizeWhereToFilter(s))
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^filter\s*\(\s*\)\s*$/i.test(s))
    .map((s) => (isPdqlCommand(s) ? s : `filter(${s})`));

  if (!normalized.length) return "sort(time desc)";
  return ensureEventIdInSelect(normalized.join(" | "));
}

function pdqlFieldNameForUiKey(uiKey: string): string {
  if (uiKey === "text") return "message";
  return uiKey;
}

/** PDQL string literal: avoid breaking the bar on quotes/newlines. */
function pdqlStringLiteral(value: string): string {
  const safe = value.replace(/\r?\n/g, " ").replace(/"/g, "'");
  return `"${safe}"`;
}

function buildFilterToken(fieldKey: string, value: string): string {
  const f = pdqlFieldNameForUiKey(fieldKey);
  const raw = value.replace(/\r?\n/g, " ").trim();
  if (["id", "event_id_raw", "record_number"].includes(f) && /^\d+$/.test(raw)) {
    return `${f} = ${raw}`;
  }
  return `${f} = ${pdqlStringLiteral(raw)}`;
}

/** Вставка AND в существующий where/filter с учётом вложенных скобок. */
function mergeIntoWhereOrFilter(pdql: string, token: string): string | null {
  const m = /\b(where|filter)\s*\(/i.exec(pdql);
  if (!m) return null;
  const kw = m[1].toLowerCase() === "filter" ? "filter" : "where";
  const openParen = m.index + m[0].length - 1;
  let depth = 0;
  let i = openParen;
  for (; i < pdql.length; i++) {
    if (pdql[i] === "(") depth++;
    else if (pdql[i] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  const inner = pdql.slice(openParen + 1, i).trim();
  const newInner = inner ? `${inner} AND ${token}` : token;
  const before = pdql.slice(0, m.index);
  const after = pdql.slice(i + 1);
  return `${before}${kw}(${newInner})${after}`;
}

/** Добавляет group | aggregate | sort | limit к запросу канала (если выбраны поля). */
function buildChannelPdql(raw: string, groupFields: string[], aggFuncs: string[] = []): string {
  const base = buildPipelinePdql(raw);
  const fields = groupFields.map((f) => f.trim()).filter(Boolean);
  if (!fields.length) return base;
  if (/\bgroup\s*\(/i.test(raw.trim())) return base;
  const aggs = aggFuncs.length > 0 ? aggFuncs.join(", ") : "count()";
  const sortField = aggFuncs.includes("count()") || aggFuncs.length === 0 ? "count" : aggFuncs[0].replace("()", "");
  return `${base} | group(${fields.join(", ")}) | aggregate(${aggs}) | sort(${sortField} desc) | limit(500)`;
}

export default function Events() {
  const [searchParams] = useSearchParams();

  // Time range
  const [quickRange, setQuickRange]   = useState("1h");
  const [fromDt, setFromDt]           = useState("");
  const [toDt, setToDt]               = useState("");
  const [useCustom, setUseCustom]     = useState(false);

  // PDQL canonical style: filter(...) | sort(...)
  const [pdqlFilter, setPdqlFilter]   = useState("filter() | sort(time desc)");
  const [groupByFields, setGroupByFields] = useState<string[]>([]);
  const [aggFuncs, setAggFuncs] = useState<string[]>(["count()"]);
  const [showPdqlModal, setShowPdqlModal] = useState(false);
  const [showQueryBuilder, setShowQueryBuilder] = useState(false);
  const [showSavedQueries, setShowSavedQueries] = useState(false);

  // Fieldsets
  const [fieldsets, setFieldsets]     = useState<Fieldset[]>(getFieldsets());
  const [currentFsId, setCurrentFsId] = useState(FULL_FIELDSET_ID);
  const [showFsManager, setShowFsManager] = useState(false);

  const PAGE_SIZE = 100;

  // Detail panel
  const [selectedEvent, setSelectedEvent] = useState<LogEvent | null>(null);
  const [linkEvent, setLinkEvent]     = useState<LogEvent | null>(null);

  // History & export
  const [showHistory, setShowHistory] = useState(false);
  const [showExport, setShowExport]   = useState(false);

  // Auto-refresh control
  const [isAutoRefresh, setIsAutoRefresh] = useState(false);

  // Infinite scroll
  const [internalPage, setInternalPage] = useState(1);
  const [allEvents, setAllEvents]       = useState<LogEvent[]>([]);
  const [allGroupedRows, setAllGroupedRows] = useState<Record<string, unknown>[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Client-side sort (applied on top of accumulated events)
  const [sortField, setSortField] = useState<string>("");
  const [sortDir,   setSortDir]   = useState<"asc" | "desc">("desc");

  // Hide columns that have no data in the current result set (without modifying fieldset)
  const [hideEmpty, setHideEmpty] = useState(true);

  // True while new page events are buffering (1 s min display to avoid jank)
  const [appendPending, setAppendPending] = useState(false);

  // Committed PDQL + time window (Apply only)
  const [appliedChannel, setAppliedChannel] = useState(() => {
    const rangeMs = QUICK_RANGES.find((r) => r.value === "1h")?.ms ?? 3600_000;
    return {
      pdql: "sort(time desc)",
      rawFilter: "filter() | sort(time desc)",
      from: nowMinus(rangeMs),
      to: new Date().toISOString(),
      size: PAGE_SIZE,
    };
  });

  const currentFieldset = fieldsets.find((f) => f.id === currentFsId) ?? fieldsets[0];

  useEffect(() => {
    const allFieldKeys = ["criticality", "time", "event_src.host", "text", ...DETAIL_FIELDS.map((f) => f.key)];
    const fullFields = [...new Set(allFieldKeys)];
    const fullFieldset: Fieldset = { id: FULL_FIELDSET_ID, name: "FULL_FLD", fields: fullFields, isDefault: true };
    const existing = getFieldsets();
    const withoutFull = existing.filter((f) => f.id !== FULL_FIELDSET_ID);
    const next = [fullFieldset, ...withoutFull];
    saveFieldsets(next);
    setFieldsets(next);
    setCurrentFsId(FULL_FIELDSET_ID);
    setHideEmpty(true);
  }, []);
  const pdqlAvailableFields = useMemo(() => {
    const normalized = new Set<string>(["event_id", "id", "event_id_raw", "record_number", "time", "message"]);
    for (const fs of fieldsets) {
      for (const f of fs.fields) normalized.add(normalizeFieldForPdql(f));
    }
    return Array.from(normalized).filter(Boolean);
  }, [fieldsets]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["events-channel", appliedChannel, internalPage],
    queryFn: () =>
      api.pdqlSearch(appliedChannel.pdql, internalPage, appliedChannel.size, {
        from: appliedChannel.from,
        to: appliedChannel.to,
      }),
    refetchInterval: isAutoRefresh ? 10_000 : false,
    retry: false,
  });

  // When appliedChannel changes (new search) → reset accumulated data
  useEffect(() => {
    setInternalPage(1);
    setAllEvents([]);
    setAllGroupedRows([]);
    setDrillDownRow(null);
  }, [appliedChannel]);

  // When new page data arrives → replace (page 1) or append with 1 s min buffer (page 2+)
  useEffect(() => {
    if (!data) return;
    const isGroupedData = !!(data && "rows" in data && "columns" in data);
    const rows = (data as any).rows ?? [];
    const logs: LogEvent[] = (data as any).hits ?? (data as any).logs ?? [];
    if (internalPage === 1) {
      if (isGroupedData) setAllGroupedRows(rows);
      else setAllEvents(logs);
      setAppendPending(false);
      return;
    }
    // Page 2+: show spinner for at least 1 s so the list doesn't jank
    setAppendPending(true);
    const timer = setTimeout(() => {
      if (isGroupedData) setAllGroupedRows((p) => [...p, ...rows]);
      else setAllEvents((p) => [...p, ...logs]);
      setAppendPending(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [data, internalPage]);

  // IntersectionObserver: load next page when sentinel is visible
  const total       = (data as any)?.total ?? 0;
  const isGrouped   = !!(data && "rows" in data && "columns" in data);
  const loadedCount = isGrouped ? allGroupedRows.length : allEvents.length;
  const hasMore     = !isGrouped && loadedCount < total;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isFetching && !appendPending) {
          setInternalPage((p) => p + 1);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isFetching, appendPending]);

  // Client-side sort on accumulated events
  const sortedEvents = useMemo(() => {
    if (!sortField) return allEvents;
    return [...allEvents].sort((a, b) => {
      const va = getEventField(a, sortField) ?? "";
      const vb = getEventField(b, sortField) ?? "";
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [allEvents, sortField, sortDir]);

  // Derive visible column list — optionally hiding columns with no data
  const activeFields = useMemo(() => {
    const fields = currentFieldset?.fields ?? ["criticality", "time", "event_src.host", "text"];
    if (!hideEmpty || sortedEvents.length === 0) return fields;
    return fields.filter(
      (f: string) => f === "criticality" || sortedEvents.some((e: LogEvent) => getEventField(e, f) !== ""),
    );
  }, [hideEmpty, currentFieldset, sortedEvents]);

  const handleColumnSort = (field: string) => {
    if (field === "criticality") return; // dot-indicator, not sortable
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  // Restore from search params (e.g. from incidents page) and auto-execute
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setPdqlFilter(q);
      setCurrentFsId(FULL_FIELDSET_ID);
      setHideEmpty(true);
      const pdql = buildChannelPdql(q, []);
      setAppliedChannel({ pdql, rawFilter: q, from: nowMinus(86_400_000), to: new Date().toISOString(), size: PAGE_SIZE });
    }
  }, [searchParams]);

  const handleApply = useCallback(() => {
    const rangeMs = QUICK_RANGES.find((r) => r.value === quickRange)?.ms ?? 3600_000;
    const from = useCustom ? fromDt : nowMinus(rangeMs);
    const to   = useCustom ? toDt   : new Date().toISOString();
    const pdql = buildChannelPdql(pdqlFilter, groupByFields, aggFuncs);
    setSortField("");
    setAppliedChannel({ pdql, rawFilter: pdqlFilter, from, to, size: PAGE_SIZE });
    addQueryHistory({
      pdql: pdqlFilter,
      timeRange: useCustom
        ? { type: "absolute", from: fromDt, to: toDt }
        : { type: "relative", relative: quickRange },
      fieldsetId: currentFsId,
    });
  }, [pdqlFilter, groupByFields, aggFuncs, quickRange, fromDt, toDt, useCustom, currentFsId]);

  const handleAddFilter = (key: string, value: string) => {
    const token = buildFilterToken(key, value);
    const merged = mergeIntoWhereOrFilter(pdqlFilter, token);
    if (merged) {
      setPdqlFilter(merged);
      return;
    }
    const base = buildPipelinePdql(pdqlFilter);
    setPdqlFilter(`filter(${token}) | ${base}`);
  };

  const handleRestoreHistory = (item: QueryHistoryItem) => {
    setPdqlFilter(item.pdql);
    if (item.timeRange.type === "relative" && item.timeRange.relative) {
      setQuickRange(item.timeRange.relative);
      setUseCustom(false);
    } else if (item.timeRange.type === "absolute") {
      setFromDt(item.timeRange.from ?? "");
      setToDt(item.timeRange.to ?? "");
      setUseCustom(true);
    }
    if (item.fieldsetId) {
      setCurrentFsId(item.fieldsetId);
      setFieldsets(getFieldsets());
    }
  };

  const groupedCols = isGrouped ? (data as { columns: string[] }).columns : [];

  // ── Drill-down: click a grouped row to see its raw events ────────────────
  const [drillDownRow, setDrillDownRow] = useState<Record<string, unknown> | null>(null);

  const drillDownPdql = useMemo(() => {
    if (!drillDownRow || !isGrouped) return null;
    const keyFields = groupedCols.filter((c) => c !== "count");
    if (!keyFields.length) return null;
    const conditions = keyFields
      .map((f) => `${f} = ${pdqlStringLiteral(String(drillDownRow[f] ?? ""))}`)
      .join(" AND ");
    const base = buildPipelinePdql(appliedChannel.rawFilter ?? "sort(time desc)");
    return `${base} | filter(${conditions}) | sort(time desc)`;
  }, [drillDownRow, isGrouped, groupedCols, appliedChannel]);

  const { data: drillData, isLoading: drillLoading } = useQuery({
    queryKey: ["events-drilldown", drillDownPdql, appliedChannel.from, appliedChannel.to],
    queryFn: () =>
      drillDownPdql
        ? api.pdqlSearch(drillDownPdql, 1, 300, { from: appliedChannel.from, to: appliedChannel.to })
        : Promise.resolve(null),
    enabled: !!drillDownPdql,
  });

  const drillEvents: LogEvent[] = (drillData as any)?.hits ?? (drillData as any)?.logs ?? [];

  // visibleFields still used for export (full set), activeFields for the table columns
  const visibleFields = currentFieldset?.fields ?? ["criticality", "time", "event_src.host", "text"];

  const handleExportCSV = () => {
    if (isGrouped) exportGroupedCSV(groupedCols, allGroupedRows);
    else exportCSV(sortedEvents, visibleFields);
  };
  const handleExportJSON = () => {
    if (isGrouped) exportGroupedJSON(groupedCols, allGroupedRows);
    else exportJSON(sortedEvents);
  };
  const handleExportXML = () => {
    if (isGrouped) exportGroupedXML(groupedCols, allGroupedRows);
    else exportXML(sortedEvents, visibleFields);
  };

  return (
    <div className="flex h-[calc(100vh-52px)] overflow-hidden">
      {/* ── Left: Event Detail Panel ──────────────────────────────────── */}
      {selectedEvent && (
        <EventDetailPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onAddFilter={handleAddFilter}
          onLinkIncident={(e) => setLinkEvent(e)}
        />
      )}

      {/* ── Right: Main Area ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Control Bar ─────────────────────────────────────────────── */}
        <div className="px-4 pt-3 pb-2 border-b flex-shrink-0 space-y-2" style={{ borderColor: "var(--border)" }}>

          {/* Row 1: Time + Quick ranges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs siem-fg-soft flex-shrink-0">Период:</span>
            <div className="flex gap-0.5 bg-siem-surface2 rounded-lg p-0.5 border" style={{ borderColor: "var(--border)" }}>
              {QUICK_RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => { setQuickRange(r.value); setUseCustom(false); }}
                  className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
                  style={{
                    background: !useCustom && quickRange === r.value ? "var(--accent-secondary)" : "transparent",
                    color: !useCustom && quickRange === r.value ? "#fff" : "var(--text-soft)",
                  }}
                >
                  {r.label}
                </button>
              ))}
              <button
                onClick={() => setUseCustom(true)}
                className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
                style={{
                  background: useCustom ? "var(--accent-secondary)" : "transparent",
                  color: useCustom ? "#fff" : "var(--text-soft)",
                }}
              >
                Свой
              </button>
            </div>

            {useCustom && (
              <>
                <input type="datetime-local" className="siem-input text-xs py-1" value={fromDt} onChange={(e) => setFromDt(e.target.value)} />
                <span className="siem-fg-soft text-xs">→</span>
                <input type="datetime-local" className="siem-input text-xs py-1" value={toDt} onChange={(e) => setToDt(e.target.value)} />
              </>
            )}

            <button onClick={handleApply} className="siem-btn py-1.5 px-4 text-xs flex-shrink-0">
              {isFetching ? "⟳" : "Применить"}
            </button>

            {/* Start / Stop auto-refresh */}
            {!isAutoRefresh ? (
              <button
                onClick={() => { handleApply(); setIsAutoRefresh(true); }}
                className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0 flex items-center gap-1"
                style={{ background: "rgba(0,180,80,0.15)", color: "#00c853", border: "1px solid #00c853" }}
                title="Запустить авто-обновление (10 с)"
              >
                ▶ Старт
              </button>
            ) : (
              <button
                onClick={() => setIsAutoRefresh(false)}
                className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0 flex items-center gap-1"
                style={{ background: "rgba(220,40,40,0.15)", color: "#ff5252", border: "1px solid #ff5252" }}
                title="Остановить авто-обновление"
              >
                ■ Стоп
              </button>
            )}

            {/* History */}
            <button
              onClick={() => setShowHistory(true)}
              className="text-xs px-2.5 py-1.5 rounded-lg flex-shrink-0"
              style={{ background: "color-mix(in srgb, var(--accent-secondary) 26%, var(--surface-inset))", color: "var(--code-accent-2)", border: "1px solid var(--border-strong)" }}
              title="История запросов"
            >
              ↺ История
            </button>
            {/* Saved Queries */}
            <button
              onClick={() => setShowSavedQueries(true)}
              className="text-xs px-2.5 py-1.5 rounded-lg flex-shrink-0"
              style={{ background: "color-mix(in srgb, var(--accent-secondary) 26%, var(--surface-inset))", color: "var(--code-accent-2)", border: "1px solid var(--border-strong)" }}
              title="Сохранённые запросы и шаблоны"
            >
              ☆ Запросы
            </button>
          </div>

          {/* Group by */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs siem-fg-soft flex-shrink-0">Группировка:</span>
            <GroupingConfig fields={groupByFields} onChange={setGroupByFields} availableFields={pdqlAvailableFields} />
            {groupByFields.length > 0 && (
              <AggregateSelector selected={aggFuncs} onChange={setAggFuncs} />
            )}
            {groupByFields.length > 0 && (
              <button
                type="button"
                className="text-[10px] siem-fg-soft hover:text-[color:var(--text-muted)] underline"
                onClick={() => { setGroupByFields([]); setAggFuncs(["count()"]); }}
              >
                сбросить
              </button>
            )}
          </div>

          {/* Row 2: PDQL bar + fieldset */}
          <div className="flex items-center gap-2">
            {/* Full PDQL editor button */}
            <button
              onClick={() => setShowPdqlModal(true)}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-sm"
              style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", color: "var(--accent)", border: "1px solid var(--border-strong)" }}
              title="Открыть полный PDQL редактор"
            >
              ⚡
            </button>

            {/* Visual query builder button */}
            <button
              onClick={() => setShowQueryBuilder(true)}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-sm"
              style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", color: "var(--accent)", border: "1px solid var(--border-strong)" }}
              title="Визуальный конструктор запросов"
            >
              🔧
            </button>

            {/* Inline PDQL filter */}
            <input
              className="pdql-bar flex-1 px-3 py-1.5"
              value={pdqlFilter}
              onChange={(e) => setPdqlFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApply()}
              placeholder='filter(level != "INFO") | sort(time desc) | limit(100)'
              spellCheck={false}
            />

            {/* Fieldset selector */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <select
                className="siem-input text-xs py-1.5"
                value={currentFsId}
                onChange={(e) => { setCurrentFsId(e.target.value); setFieldsets(getFieldsets()); }}
                style={{ minWidth: "120px" }}
              >
                {fieldsets.map((fs) => (
                  <option key={fs.id} value={fs.id}>{fs.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowFsManager(true)}
                className="text-xs px-2 py-1.5 rounded-lg"
                style={{ background: "color-mix(in srgb, var(--accent-secondary) 26%, var(--surface-inset))", color: "var(--code-accent-2)", border: "1px solid var(--border-strong)" }}
                title="Управление филдсетами"
              >
                ⚙
              </button>
            </div>

            {/* Hide empty columns */}
            <button
              onClick={() => setHideEmpty((v: boolean) => !v)}
              className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0 transition-colors"
              style={{
                background: hideEmpty ? "color-mix(in srgb, var(--accent) 22%, transparent)" : "color-mix(in srgb, var(--accent-secondary) 26%, var(--surface-inset))",
                color: hideEmpty ? "var(--accent)" : "var(--code-accent-2)",
                border: hideEmpty ? "1px solid var(--accent)" : "1px solid var(--border-strong)",
              }}
              title={hideEmpty ? "Показать все столбцы" : "Скрыть пустые столбцы"}
            >
              {hideEmpty ? "⊞ Все столбцы" : "⊟ Скрыть пустые"}
            </button>

            {/* Export */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowExport((s) => !s)}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: "color-mix(in srgb, var(--accent-secondary) 26%, var(--surface-inset))", color: "var(--code-accent-2)", border: "1px solid var(--border-strong)" }}
              >
                ↓ Экспорт
              </button>
              {showExport && (
                <div
                  className="absolute right-0 top-8 z-30 rounded-xl border py-1 shadow-xl"
                  style={{ background: "var(--surface-panel)", borderColor: "var(--border-strong)", minWidth: "120px" }}
                >
                  {[
                    { label: "CSV", fn: handleExportCSV },
                    { label: "JSON", fn: handleExportJSON },
                    { label: "XML", fn: handleExportXML },
                  ].map(({ label, fn }) => (
                    <button
                      key={label}
                      onClick={() => { fn(); setShowExport(false); }}
                      className="w-full text-left px-4 py-1.5 text-xs hover:bg-purple-900/20 transition-colors"
                      style={{ color: "var(--accent)" }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Event Table ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {isError ? (
            <div className="flex items-center justify-center h-full p-8">
              <div className="text-center max-w-lg">
                <div className="text-3xl mb-3">⚠</div>
                <div className="text-sm font-medium mb-1" style={{ color: "#f87171" }}>Ошибка выполнения запроса</div>
                <div className="text-xs px-4 py-2 rounded font-mono text-left mt-2"
                  style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
                  {error instanceof Error ? error.message : "Неверный PDQL-запрос или ошибка сервера"}
                </div>
                <div className="text-xs mt-2" style={{ color: "var(--text-soft)" }}>
                  Проверьте синтаксис запроса или используйте конструктор запросов
                </div>
              </div>
            </div>
          ) : isLoading && loadedCount === 0 ? (
            <div className="flex items-center justify-center h-full siem-fg-soft">Загрузка событий...</div>
          ) : (isGrouped ? allGroupedRows.length === 0 : sortedEvents.length === 0) && !isFetching ? (
            <div className="flex items-center justify-center h-full siem-fg-soft">
              <div className="text-center">
                <div className="text-4xl mb-2" style={{ color: "var(--border-strong)" }}>◎</div>
                <div>{isGrouped ? "Нет групп по текущему фильтру" : "Нет событий за выбранный период"}</div>
                <div className="text-xs siem-fg-muted mt-1">Измените фильтр или временной диапазон</div>
              </div>
            </div>
          ) : isGrouped ? (
            <div className="flex flex-col h-full">
              {/* Grouped aggregation table */}
              <div className="overflow-auto" style={{ flex: drillDownRow ? "0 0 40%" : "1 1 0" }}>
                <table className="w-full siem-table text-xs">
                  <thead className="sticky top-0" style={{ background: "var(--surface-panel)" }}>
                    <tr>
                      {groupedCols.map((col) => (
                        <th key={col} className="text-left font-mono">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allGroupedRows.map((row: Record<string, unknown>, i: number) => (
                      <tr
                        key={i}
                        className="cursor-pointer"
                        style={{
                          background: drillDownRow === row ? "color-mix(in srgb, var(--accent) 18%, transparent)" : undefined,
                          borderLeft: drillDownRow === row ? "2px solid var(--accent-secondary)" : "2px solid transparent",
                        }}
                        onClick={() => setDrillDownRow(drillDownRow === row ? null : row)}
                      >
                        {groupedCols.map((col) => (
                          <td key={col} className="siem-fg-muted font-mono truncate max-w-[240px]" title={String(row[col] ?? "")}>
                            {row[col] === null || row[col] === undefined ? "—" : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Drill-down: event stream for the selected group row */}
              {drillDownRow && (
                <div className="flex flex-col border-t overflow-hidden" style={{ flex: "1 1 0", borderColor: "var(--border-strong)" }}>
                  <div
                    className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
                    style={{ borderColor: "var(--border)", background: "var(--surface-inset)" }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold flex-shrink-0" style={{ color: "var(--accent)" }}>
                        ▸ События группы:
                      </span>
                      <span className="text-xs font-mono siem-fg-muted truncate">
                        {groupedCols
                          .filter((c) => c !== "count")
                          .map((f) => `${f} = "${drillDownRow[f] ?? "—"}"`)
                          .join(" · ")}
                      </span>
                    </div>
                    <button
                      onClick={() => setDrillDownRow(null)}
                      className="siem-fg-soft hover:text-[color:var(--text)] text-sm flex-shrink-0 ml-2"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {drillLoading ? (
                      <div className="flex items-center justify-center h-full siem-fg-soft text-sm">Загрузка событий...</div>
                    ) : drillEvents.length === 0 ? (
                      <div className="flex items-center justify-center h-full siem-fg-soft text-sm">Нет событий для этой группы</div>
                    ) : (
                      <table className="w-full siem-table text-xs">
                        <thead className="sticky top-0" style={{ background: "var(--surface-inset)" }}>
                          <tr>
                            {activeFields.map((f: string) => (
                              <th key={f} className="text-left select-none">
                                {f === "criticality" ? "⬤" : f === "text" ? "Сообщение" : f}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {drillEvents.map((event: LogEvent, i: number) => {
                            const crit = deriveCriticality(event);
                            const isCorr = isCorrelationEvent(event);
                            const isSelected = selectedEvent?.event_id === event.event_id;
                            return (
                              <tr
                                key={event.event_id || i}
                                className="cursor-pointer"
                                style={{
                                  background: isSelected ? "color-mix(in srgb, var(--accent) 16%, transparent)" : undefined,
                                  borderLeft: isSelected ? "2px solid var(--accent-secondary)" : "2px solid transparent",
                                }}
                                onClick={() => setSelectedEvent(isSelected ? null : event)}
                              >
                                {activeFields.map((f: string) => (
                                  <td key={f}>
                                    {f === "criticality" ? (
                                      <div className="flex items-center gap-1">
                                        <span className={critDotClass(crit)} />
                                        {isCorr && <span className="corr-star" title="Событие корреляции">★</span>}
                                      </div>
                                    ) : f === "time" ? (
                                      <span className="font-mono siem-fg-muted">{fmtTimeShort(getEventField(event, f))}</span>
                                    ) : f === "text" ? (
                                      <span className="siem-fg truncate block max-w-[500px]" title={getEventField(event, f)}>
                                        {getEventField(event, f) || "(нет сообщения)"}
                                      </span>
                                    ) : (
                                      <span className="siem-fg-muted font-mono truncate block max-w-[200px]" title={getEventField(event, f)}>
                                        {getEventField(event, f) || "—"}
                                      </span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="px-3 py-1 border-t flex-shrink-0 text-xs siem-fg-soft" style={{ borderColor: "var(--border)" }}>
                    {drillEvents.length} событий (первые 300)
                  </div>
                </div>
              )}
            </div>
          ) : (
            <table className="w-full siem-table text-xs">
              <thead className="sticky top-0" style={{ background: "var(--surface-panel)" }}>
                <tr>
                  {activeFields.map((f: string) => (
                    <th
                      key={f}
                      className="text-left select-none"
                      style={{ cursor: f === "criticality" ? "default" : "pointer" }}
                      onClick={() => handleColumnSort(f)}
                    >
                      {f === "criticality" ? "⬤" : f === "text" ? "Сообщение" : f}
                      {sortField === f && f !== "criticality" && (
                        <span className="ml-1" style={{ color: "var(--accent)" }}>
                          {sortDir === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedEvents.map((event: LogEvent, i: number) => {
                  const crit = deriveCriticality(event);
                  const isCorr = isCorrelationEvent(event);
                  const isSelected = selectedEvent?.event_id === event.event_id;
                  return (
                    <tr
                      key={event.event_id || i}
                      onClick={() => setSelectedEvent(isSelected ? null : event)}
                      className="cursor-pointer"
                      style={{
                        background: isSelected ? "color-mix(in srgb, var(--accent) 16%, transparent)" : undefined,
                        borderLeft: isSelected ? "2px solid var(--accent-secondary)" : "2px solid transparent",
                      }}
                    >
                      {activeFields.map((f: string) => (
                        <td key={f}>
                          {f === "criticality" ? (
                            <div className="flex items-center gap-1">
                              <span className={critDotClass(crit)} />
                              {isCorr && <span className="corr-star" title="Событие корреляции">★</span>}
                            </div>
                          ) : f === "time" ? (
                            <span className="font-mono siem-fg-muted">{fmtTimeShort(getEventField(event, f))}</span>
                          ) : f === "text" ? (
                            <span className="siem-fg truncate block max-w-[500px]" title={getEventField(event, f)}>
                              {getEventField(event, f) || "(нет сообщения)"}
                            </span>
                          ) : (
                            <span className="siem-fg-muted font-mono truncate block max-w-[200px]" title={getEventField(event, f)}>
                              {getEventField(event, f) || "—"}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {/* Infinite scroll sentinel — inside scrollable area */}
          {!isGrouped && <div ref={sentinelRef} className="h-4" />}
        </div>

        {/* ── Status bar ──────────────────────────────────────────────── */}
        <div className="px-4 py-2 border-t flex-shrink-0 flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
          <span className="text-xs siem-fg-soft">
            {isGrouped
              ? allGroupedRows.length.toLocaleString() + " групп"
              : "Загружено " + loadedCount.toLocaleString() + " из " + total.toLocaleString() + " событий"}
          </span>
          {(isFetching || appendPending) && (
            <span className="text-xs animate-pulse" style={{ color: "var(--code-accent-2)" }}>загрузка...</span>
          )}
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showPdqlModal && (
        <PDQLModal value={pdqlFilter} onSave={setPdqlFilter} onClose={() => setShowPdqlModal(false)} />
      )}
      {showFsManager && (
        <FieldsetManagerModal
          currentFieldsetId={currentFsId}
          onClose={() => { setFieldsets(getFieldsets()); setShowFsManager(false); }}
          onSelect={(fs) => { setCurrentFsId(fs.id); setFieldsets(getFieldsets()); }}
        />
      )}
      {showHistory && (
        <QueryHistoryModal onClose={() => setShowHistory(false)} onRestore={handleRestoreHistory} />
      )}
      {showQueryBuilder && (
        <QueryBuilder
          availableFields={pdqlAvailableFields}
          onApply={(pdql) => {
            const rangeMs = QUICK_RANGES.find((r) => r.value === quickRange)?.ms ?? 3600_000;
            const from = useCustom ? fromDt : nowMinus(rangeMs);
            const to   = useCustom ? toDt   : new Date().toISOString();
            setPdqlFilter(pdql);
            setAppliedChannel({ pdql, rawFilter: pdql, from, to, size: PAGE_SIZE });
          }}
          onClose={() => setShowQueryBuilder(false)}
        />
      )}
      {showSavedQueries && (
        <SavedQueries
          currentPdql={pdqlFilter}
          onLoad={(pdql, timeRange) => {
            const rangeMs = QUICK_RANGES.find((r) => r.value === timeRange)?.ms ?? 3600_000;
            const from = nowMinus(rangeMs);
            const to = new Date().toISOString();
            setPdqlFilter(pdql);
            setQuickRange(QUICK_RANGES.find((r) => r.value === timeRange) ? timeRange : "1h");
            setAppliedChannel({ pdql, rawFilter: pdql, from, to, size: PAGE_SIZE });
          }}
          onClose={() => setShowSavedQueries(false)}
        />
      )}
      {linkEvent && (
        <LinkIncidentModal event={linkEvent} onClose={() => setLinkEvent(null)} />
      )}
    </div>
  );
}
