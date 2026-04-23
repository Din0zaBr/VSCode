import { useState } from "react";
import type { LogEvent } from "../api/client";

const LEVEL_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  ERROR: "bg-red-500/15 text-red-800 dark:bg-red-500/20 dark:text-red-400",
  WARN: "bg-amber-500/15 text-amber-900 dark:bg-yellow-500/20 dark:text-yellow-400",
  WARNING: "bg-amber-500/15 text-amber-900 dark:bg-yellow-500/20 dark:text-yellow-400",
  INFO: "bg-blue-500/12 text-blue-900 dark:bg-blue-500/20 dark:text-blue-400",
  DEBUG: "bg-[color-mix(in_srgb,var(--text-soft)_18%,transparent)] text-slate-700 dark:text-slate-300 border border-[var(--border)]",
};

function LevelBadge({ level }: { level: string }) {
  const cls = LEVEL_COLORS[level.toUpperCase()] ?? "border border-[var(--border)] siem-fg-muted bg-[var(--surface-2)]";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${cls}`}>
      {level}
    </span>
  );
}

function formatTime(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return ts;
  }
}

interface Props {
  logs: LogEvent[];
  highlight?: string;
  maxHeight?: string;
}

export default function LogTable({ logs, highlight, maxHeight = "70vh" }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  function highlightText(text: string) {
    if (!highlight) return text;
    const idx = text.toLowerCase().indexOf(highlight.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-amber-200/90 text-amber-950 dark:bg-yellow-500/40 dark:text-yellow-100 rounded px-0.5">
          {text.slice(idx, idx + highlight.length)}
        </mark>
        {text.slice(idx + highlight.length)}
      </>
    );
  }

  if (!logs.length) {
    return (
      <div className="text-center siem-fg-soft py-12">
        Нет логов для отображения
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg siem-card p-0" style={{ maxHeight }}>
      <table className="w-full text-sm siem-table">
        <thead className="sticky top-0 z-10" style={{ background: "var(--surface-inset)" }}>
          <tr className="text-left">
            <th className="w-40">Время</th>
            <th className="w-20">Уровень</th>
            <th className="w-24">Сервис</th>
            <th className="w-28">Хост</th>
            <th className="w-28">Агент</th>
            <th>Сообщение</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => {
            const key = log.event_id || String(i);
            const isExpanded = expanded === key;
            const hasMeta = log.meta && Object.keys(log.meta).length > 0;

            return (
              <>
                <tr
                  key={key}
                  onClick={() => setExpanded(isExpanded ? null : key)}
                  className="transition-colors cursor-pointer"
                  style={isExpanded ? { background: "color-mix(in srgb, var(--accent) 10%, transparent)" } : undefined}
                >
                  <td className="px-3 py-1.5 siem-fg-muted font-mono text-xs whitespace-nowrap">
                    {formatTime(log.timestamp)}
                  </td>
                  <td className="px-3 py-1.5">
                    <LevelBadge level={log.level} />
                  </td>
                  <td className="px-3 py-1.5 siem-fg-muted text-xs">{log.service}</td>
                  <td className="px-3 py-1.5 siem-fg-muted text-xs font-mono truncate" title={log.host}>
                    {log.host}
                  </td>
                  <td className="px-3 py-1.5 siem-fg-soft text-xs font-mono truncate" title={log.agent_id}>
                    {log.agent_id}
                  </td>
                  <td className="px-3 py-1.5 siem-fg font-mono text-xs break-all">
                    {highlightText(log.message)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${key}-detail`}>
                    <td colSpan={6} className="px-4 py-3" style={{ background: "var(--surface-inset)" }}>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs mb-2">
                        <DetailField label="ID события" value={log.event_id} />
                        <DetailField label="Время" value={log.timestamp} />
                        <DetailField label="Хост" value={log.host} />
                        <DetailField label="Агент" value={log.agent_id} />
                        <DetailField label="Источник" value={log.source} />
                        <DetailField label="Сервис" value={log.service} />
                        <DetailField label="Уровень" value={log.level} />
                      </div>
                      {hasMeta && (
                        <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-soft)" }}>Метаданные</span>
                          <pre className="siem-code-block mt-1 text-xs siem-fg-muted whitespace-pre-wrap p-2 max-h-60 overflow-auto">
                            {JSON.stringify(log.meta, null, 2)}
                          </pre>
                        </div>
                      )}
                      <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-soft)" }}>Полное сообщение</span>
                        <pre className="siem-code-block mt-1 text-xs siem-fg-muted whitespace-pre-wrap p-2 max-h-40 overflow-auto">
                          {log.message}
                        </pre>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <span className="siem-fg-soft">{label}: </span>
      <span className="siem-fg font-mono">{value}</span>
    </div>
  );
}
