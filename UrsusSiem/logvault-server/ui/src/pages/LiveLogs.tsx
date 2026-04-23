import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import type { LogEvent } from "../api/client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import ComboBox from "../components/ComboBox";

const LEVEL_COLORS: Record<string, string> = {
  CRITICAL: "text-red-500 font-bold",
  ERROR: "text-red-400",
  WARN: "text-yellow-400",
  WARNING: "text-yellow-400",
  INFO: "text-blue-400",
  DEBUG: "siem-fg-soft",
};

export default function LiveLogs() {
  const { logs, connected, setPaused, clear } = useWebSocket();
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState({ level: "", service: "", agent: "", host: "", q: "" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api.hosts(),
    refetchInterval: 60_000,
  });

  const knownHosts = useMemo(() => {
    const fromApi = (hosts ?? []).map((h) => h.host);
    const fromLogs = [...new Set(logs.map((l) => l.host).filter(Boolean))];
    return [...new Set([...fromApi, ...fromLogs])].sort();
  }, [hosts, logs]);

  const knownServices = useMemo(
    () => [...new Set(logs.map((l) => l.service).filter(Boolean))].sort(),
    [logs],
  );

  const knownAgents = useMemo(
    () => [...new Set(logs.map((l) => l.agent_id).filter(Boolean))].sort(),
    [logs],
  );

  const togglePause = useCallback(() => {
    const next = !isPaused;
    setIsPaused(next);
    setPaused(next);
  }, [isPaused, setPaused]);

  useEffect(() => {
    if (!isPaused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length, isPaused]);

  const filtered = logs.filter((log) => {
    if (filter.level && log.level.toUpperCase() !== filter.level) return false;
    if (filter.service && !log.service.toLowerCase().includes(filter.service.toLowerCase())) return false;
    if (filter.agent && !log.agent_id.toLowerCase().includes(filter.agent.toLowerCase())) return false;
    if (filter.host && !log.host.toLowerCase().includes(filter.host.toLowerCase())) return false;
    if (filter.q && !log.message.toLowerCase().includes(filter.q.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="siem-page-title">Логи в реальном времени</h2>
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
            connected ? "bg-green-500/15 text-green-800 dark:text-green-300" : "bg-red-500/15 text-red-700 dark:text-red-400"
          }`}>
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
            {connected ? "Подключено" : "Отключено"}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={togglePause}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isPaused
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-yellow-600 hover:bg-yellow-700 text-white"
            }`}
          >
            {isPaused ? "Возобновить" : "Пауза"}
          </button>
          <button
            onClick={clear}
            className="siem-btn-ghost text-sm px-4 py-2"
          >
            Очистить
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          placeholder="Фильтр по тексту..."
          value={filter.q}
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
          className="siem-input flex-1 min-w-[200px]"
        />
        <select
          value={filter.level}
          onChange={(e) => setFilter((f) => ({ ...f, level: e.target.value }))}
          className="siem-input"
        >
          <option value="">Все уровни</option>
          {["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <ComboBox
          placeholder="Сервис..."
          value={filter.service}
          onChange={(v: string) => setFilter((f) => ({ ...f, service: v }))}
          options={knownServices}
          className="w-32"
        />
        <ComboBox
          placeholder="Хост..."
          value={filter.host}
          onChange={(v: string) => setFilter((f) => ({ ...f, host: v }))}
          options={knownHosts}
          className="w-32"
        />
        <ComboBox
          placeholder="Агент..."
          value={filter.agent}
          onChange={(v: string) => setFilter((f) => ({ ...f, agent: v }))}
          options={knownAgents}
          className="w-32"
        />
      </div>

      <div className="siem-card overflow-hidden">
        <div className="overflow-auto font-mono text-xs leading-relaxed" style={{ maxHeight: "70vh" }}>
          {filtered.length === 0 ? (
            <div className="text-center siem-fg-soft py-12">
              {logs.length === 0 ? "Ожидание логов..." : "Нет логов, соответствующих фильтрам"}
            </div>
          ) : (
            <div className="p-3 space-y-0.5">
              {filtered.map((log, i) => (
                <LogLine
                  key={log.event_id || i}
                  log={log}
                  expanded={expandedId === (log.event_id || String(i))}
                  onToggle={() => {
                    const id = log.event_id || String(i);
                    setExpandedId(expandedId === id ? null : id);
                  }}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      <div className="text-xs siem-fg-soft">
        {filtered.length} / {logs.length} логов показаны
      </div>
    </div>
  );
}

function LogLine({ log, expanded, onToggle }: { log: LogEvent; expanded: boolean; onToggle: () => void }) {
  const levelCls = LEVEL_COLORS[log.level.toUpperCase()] ?? "siem-fg-muted";
  const time = formatTs(log.timestamp);
  const hasMeta = log.meta && Object.keys(log.meta).length > 0;

  return (
    <div>
      <div
        className="flex gap-2 px-2 py-0.5 rounded cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"
        onClick={onToggle}
      >
        <span className="siem-fg-soft shrink-0">{time}</span>
        <span className={`w-10 shrink-0 text-right ${levelCls}`}>{log.level}</span>
        <span className="text-cyan-600 shrink-0 w-24 truncate" title={log.host}>{log.host}</span>
        <span className="text-vault-400/90 shrink-0 w-28 truncate font-mono text-[11px]" title={log.agent_id}>
          {log.agent_id || "—"}
        </span>
        <span className="siem-fg-soft shrink-0 w-20 truncate" title={log.service}>{log.service}</span>
        <span className="siem-fg-muted break-all">{log.message}</span>
      </div>
      {expanded && (
        <div
          className="ml-2 mb-1 px-3 py-2 rounded-lg border-l-2"
          style={{
            background: "color-mix(in srgb, var(--surface-panel) 88%, var(--accent) 6%)",
            borderLeftColor: "var(--accent-secondary)",
          }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
            <Field label="ID события" value={log.event_id} />
            <Field label="Время" value={log.timestamp} />
            <Field label="Хост" value={log.host} />
            <Field label="Агент" value={log.agent_id} />
            <Field label="Источник" value={log.source} />
            <Field label="Сервис" value={log.service} />
            <Field label="Уровень" value={log.level} />
          </div>
          {hasMeta && (
            <div className="mt-1.5 pt-1.5 border-t" style={{ borderColor: "color-mix(in srgb, var(--border) 55%, transparent)" }}>
              <pre className="siem-code-block text-[11px] siem-fg-muted whitespace-pre-wrap p-2 max-h-48 overflow-auto">
                {JSON.stringify(log.meta, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <span className="siem-fg-soft">{label}: </span>
      <span className="siem-fg-muted">{value}</span>
    </div>
  );
}

function formatTs(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString("ru-RU", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return ts;
  }
}
