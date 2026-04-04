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
  DEBUG: "text-gray-500",
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
          <h2 className="text-2xl font-bold text-gray-100">Логи в реальном времени</h2>
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
            connected ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
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
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
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
          className="flex-1 min-w-[200px] bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-vault-500"
        />
        <select
          value={filter.level}
          onChange={(e) => setFilter((f) => ({ ...f, level: e.target.value }))}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500"
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

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-auto font-mono text-xs leading-relaxed" style={{ maxHeight: "70vh" }}>
          {filtered.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
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

      <div className="text-xs text-gray-500">
        {filtered.length} / {logs.length} логов показаны
      </div>
    </div>
  );
}

function LogLine({ log, expanded, onToggle }: { log: LogEvent; expanded: boolean; onToggle: () => void }) {
  const levelCls = LEVEL_COLORS[log.level.toUpperCase()] ?? "text-gray-400";
  const time = formatTs(log.timestamp);
  const hasMeta = log.meta && Object.keys(log.meta).length > 0;

  return (
    <div>
      <div className="flex gap-2 hover:bg-gray-800/50 px-2 py-0.5 rounded cursor-pointer" onClick={onToggle}>
        <span className="text-gray-600 shrink-0">{time}</span>
        <span className={`w-10 shrink-0 text-right ${levelCls}`}>{log.level}</span>
        <span className="text-cyan-600 shrink-0 w-24 truncate" title={log.host}>{log.host}</span>
        <span className="text-vault-400/90 shrink-0 w-28 truncate font-mono text-[11px]" title={log.agent_id}>
          {log.agent_id || "—"}
        </span>
        <span className="text-gray-500 shrink-0 w-20 truncate" title={log.service}>{log.service}</span>
        <span className="text-gray-300 break-all">{log.message}</span>
      </div>
      {expanded && (
        <div className="ml-2 mb-1 px-3 py-2 bg-gray-800/40 rounded-lg border-l-2 border-vault-500/50">
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
            <div className="mt-1.5 pt-1.5 border-t border-gray-700/50">
              <pre className="text-[11px] text-gray-300 whitespace-pre-wrap font-mono bg-gray-950/50 rounded p-2 max-h-48 overflow-auto">
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
      <span className="text-gray-500">{label}: </span>
      <span className="text-gray-300">{value}</span>
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
