import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "../hooks/useSearch";
import LogTable from "../components/LogTable";
import ComboBox from "../components/ComboBox";
import { api } from "../api/client";
import type { SearchParams } from "../api/client";

export default function Search() {
  const [urlParams] = useSearchParams();
  const urlAgentId = urlParams.get("agent_id") ?? "";
  const urlHost = urlParams.get("host") ?? "";

  const [params, setParams] = useState<SearchParams>({ q: "", page: 1, size: 50 });
  const [draft, setDraft] = useState({ q: "", level: "", service: "", agent_id: "", host: "", source: "", from: "", to: "" });
  const [submitted, setSubmitted] = useState(false);

  const { data: hosts } = useQuery({
    queryKey: ["hosts"],
    queryFn: () => api.hosts(),
    staleTime: 60_000,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents(),
    staleTime: 60_000,
  });

  const { data: stats } = useQuery({
    queryKey: ["stats-meta"],
    queryFn: () => api.stats(),
    staleTime: 60_000,
  });

  const hostOptions = useMemo(() => (hosts ?? []).map((h) => h.host), [hosts]);
  const agentOptions = useMemo(() => (agents ?? []).map((a) => a.agent_id), [agents]);
  const serviceOptions = useMemo(() => (stats?.by_service ?? []).map((s) => s.key).filter(Boolean), [stats]);
  const sourceOptions = useMemo(() => (stats?.by_source ?? []).map((s) => s.key).filter(Boolean), [stats]);

  useEffect(() => {
    if (urlAgentId || urlHost) {
      setDraft((d) => ({
        ...d,
        ...(urlAgentId ? { agent_id: urlAgentId } : {}),
        ...(urlHost ? { host: urlHost } : {}),
      }));
      setParams((p) => ({
        ...p,
        ...(urlAgentId ? { agent_id: urlAgentId } : {}),
        ...(urlHost ? { host: urlHost } : {}),
        page: 1,
      }));
      setSubmitted(true);
    }
  }, [urlAgentId, urlHost]);

  const { data, isLoading, error } = useSearch(params, submitted);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setParams({
        q: draft.q,
        level: draft.level,
        agent_id: draft.agent_id,
        service: draft.service,
        host: draft.host,
        source: draft.source,
        from: draft.from,
        to: draft.to,
        page: 1,
        size: 50,
      });
      setSubmitted(true);
    },
    [draft],
  );

  const setPage = (p: number) => {
    setParams((prev) => ({ ...prev, page: p }));
  };

  const totalPages = data ? Math.ceil(data.total / (params.size ?? 50)) : 0;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-100">Поиск логов</h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <input
            placeholder="Полнотекстовый поиск..."
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-vault-500"
          />
          <button
            type="submit"
            className="px-6 py-2.5 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Поиск
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          <select
            value={draft.level}
            onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value }))}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500"
          >
            <option value="">Все уровни</option>
            {["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          <ComboBox
            placeholder="Сервис"
            value={draft.service}
            onChange={(v: string) => setDraft((d) => ({ ...d, service: v }))}
            options={serviceOptions}
            className="w-36"
          />
          <ComboBox
            placeholder="ID агента"
            value={draft.agent_id}
            onChange={(v: string) => setDraft((d) => ({ ...d, agent_id: v }))}
            options={agentOptions}
            className="w-36"
          />
          <ComboBox
            placeholder="Хост"
            value={draft.host}
            onChange={(v: string) => setDraft((d) => ({ ...d, host: v }))}
            options={hostOptions}
            className="w-36"
          />
          <ComboBox
            placeholder="Путь источника"
            value={draft.source}
            onChange={(v: string) => setDraft((d) => ({ ...d, source: v }))}
            options={sourceOptions}
            className="w-44"
          />

          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">От:</label>
            <input
              type="datetime-local"
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">До:</label>
            <input
              type="datetime-local"
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-vault-500"
            />
          </div>
        </div>
      </form>

      {error && (
        <div className="text-red-400 bg-red-500/10 rounded-lg p-3 border border-red-500/30 text-sm">
          {(error as Error).message}
        </div>
      )}

      {isLoading && (
        <div className="text-center text-gray-500 py-12">Загрузка...</div>
      )}

      {data && (
        <>
          <div className="text-sm text-gray-400">
            Найдено <span className="text-gray-200 font-medium">{data.total.toLocaleString()}</span> логов
          </div>
          <LogTable logs={data.logs} highlight={params.q} />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                disabled={params.page === 1}
                onClick={() => setPage((params.page ?? 1) - 1)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
              >
                Prev
              </button>
              <span className="text-sm text-gray-400">
                Page {params.page} / {totalPages}
              </span>
              <button
                disabled={params.page === totalPages}
                onClick={() => setPage((params.page ?? 1) + 1)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {submitted && !isLoading && !data?.logs.length && !error && (
        <div className="text-center text-gray-500 py-12">No results found</div>
      )}
    </div>
  );
}
