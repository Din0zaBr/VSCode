import { useState } from "react";
import type { LogEvent } from "../api/client";

const LEVEL_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  ERROR: "bg-red-500/20 text-red-400",
  WARN: "bg-yellow-500/20 text-yellow-400",
  WARNING: "bg-yellow-500/20 text-yellow-400",
  INFO: "bg-blue-500/20 text-blue-400",
  DEBUG: "bg-gray-500/20 text-gray-400",
};

function LevelBadge({ level }: { level: string }) {
  const cls = LEVEL_COLORS[level.toUpperCase()] ?? "bg-gray-700 text-gray-300";
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
        <mark className="bg-yellow-500/40 text-yellow-200 rounded px-0.5">
          {text.slice(idx, idx + highlight.length)}
        </mark>
        {text.slice(idx + highlight.length)}
      </>
    );
  }

  if (!logs.length) {
    return (
      <div className="text-center text-gray-500 py-12">
        Нет логов для отображения
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-gray-800" style={{ maxHeight }}>
      <table className="w-full text-sm">
        <thead className="bg-gray-900/80 sticky top-0 z-10">
          <tr className="text-left text-gray-400 text-xs uppercase tracking-wider">
            <th className="px-3 py-2 w-40">Время</th>
            <th className="px-3 py-2 w-20">Уровень</th>
            <th className="px-3 py-2 w-24">Сервис</th>
            <th className="px-3 py-2 w-28">Хост</th>
            <th className="px-3 py-2 w-28">Агент</th>
            <th className="px-3 py-2">Сообщение</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {logs.map((log, i) => {
            const key = log.event_id || String(i);
            const isExpanded = expanded === key;
            const hasMeta = log.meta && Object.keys(log.meta).length > 0;

            return (
              <>
                <tr
                  key={key}
                  onClick={() => setExpanded(isExpanded ? null : key)}
                  className={`hover:bg-gray-800/40 transition-colors cursor-pointer ${
                    isExpanded ? "bg-gray-800/30" : ""
                  }`}
                >
                  <td className="px-3 py-1.5 text-gray-400 font-mono text-xs whitespace-nowrap">
                    {formatTime(log.timestamp)}
                  </td>
                  <td className="px-3 py-1.5">
                    <LevelBadge level={log.level} />
                  </td>
                  <td className="px-3 py-1.5 text-gray-300 text-xs">{log.service}</td>
                  <td className="px-3 py-1.5 text-gray-400 text-xs font-mono truncate" title={log.host}>
                    {log.host}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 text-xs font-mono truncate" title={log.agent_id}>
                    {log.agent_id}
                  </td>
                  <td className="px-3 py-1.5 text-gray-200 font-mono text-xs break-all">
                    {highlightText(log.message)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${key}-detail`}>
                    <td colSpan={6} className="px-4 py-3 bg-gray-900/60">
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
                        <div className="mt-2 pt-2 border-t border-gray-800">
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Метаданные</span>
                          <pre className="mt-1 text-xs text-gray-300 whitespace-pre-wrap font-mono bg-gray-950/50 rounded p-2 max-h-60 overflow-auto">
                            {JSON.stringify(log.meta, null, 2)}
                          </pre>
                        </div>
                      )}
                      <div className="mt-2 pt-2 border-t border-gray-800">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Полное сообщение</span>
                        <pre className="mt-1 text-xs text-gray-300 whitespace-pre-wrap font-mono bg-gray-950/50 rounded p-2 max-h-40 overflow-auto">
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
      <span className="text-gray-500">{label}: </span>
      <span className="text-gray-300 font-mono">{value}</span>
    </div>
  );
}
