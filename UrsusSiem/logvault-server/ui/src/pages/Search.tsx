import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "../hooks/useSearch";
import LogTable from "../components/LogTable";
import ComboBox from "../components/ComboBox";
import PDQLInput from "../components/PDQLInput";
import { api } from "../api/client";
import type { SearchParams } from "../api/client";

type SearchMode = "simple" | "pdql";

export default function Search() {
  const [urlParams] = useSearchParams();
  const urlAgentId = urlParams.get("agent_id") ?? "";
  const urlHost = urlParams.get("host") ?? "";

  const [mode, setMode] = useState<SearchMode>("simple");
  const [params, setParams] = useState<SearchParams>({ q: "", page: 1, size: 50 });
  const [draft, setDraft] = useState({ q: "", level: "", service: "", agent_id: "", host: "", source: "", from: "", to: "" });
  const [submitted, setSubmitted] = useState(false);
  const [pdqlQuery, setPdqlQuery] = useState("");
  const [pdqlResult, setPdqlResult] = useState<any>(null);
  const [pdqlLoading, setPdqlLoading] = useState(false);
  const [pdqlError, setPdqlError] = useState("");

  const { data: hosts } = useQuery({ queryKey: ["hosts"], queryFn: () => api.hosts(), staleTime: 60_000 });
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: () => api.agents(), staleTime: 60_000 });
  const { data: stats } = useQuery({ queryKey: ["stats-meta"], queryFn: () => api.stats(), staleTime: 60_000 });

  const hostOptions = useMemo(() => (hosts ?? []).map((h) => h.host), [hosts]);
  const agentOptions = useMemo(() => (agents ?? []).map((a) => a.agent_id), [agents]);
  const serviceOptions = useMemo(() => (stats?.by_service ?? []).map((s) => s.key).filter(Boolean), [stats]);
  const sourceOptions = useMemo(() => (stats?.by_source ?? []).map((s) => s.key).filter(Boolean), [stats]);

  useEffect(() => {
    if (urlAgentId || urlHost) {
      setDraft((d) => ({ ...d, ...(urlAgentId ? { agent_id: urlAgentId } : {}), ...(urlHost ? { host: urlHost } : {}) }));
      setParams((p) => ({ ...p, ...(urlAgentId ? { agent_id: urlAgentId } : {}), ...(urlHost ? { host: urlHost } : {}), page: 1 }));
      setSubmitted(true);
    }
  }, [urlAgentId, urlHost]);

  const { data, isLoading, error } = useSearch(params, submitted && mode === "simple");

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setParams({ q: draft.q, level: draft.level, agent_id: draft.agent_id, service: draft.service, host: draft.host, source: draft.source, from: draft.from, to: draft.to, page: 1, size: 50 });
    setSubmitted(true);
  }, [draft]);

  const handlePdqlSubmit = useCallback(async () => {
    if (!pdqlQuery.trim()) return;
    setPdqlLoading(true);
    setPdqlError("");
    try {
      const result = await api.pdqlSearch(pdqlQuery, 1, 100);
      setPdqlResult(result);
    } catch (e: any) {
      setPdqlError(e.message ?? "PDQL error");
      setPdqlResult(null);
    } finally {
      setPdqlLoading(false);
    }
  }, [pdqlQuery]);

  const setPage = (p: number) => setParams((prev) => ({ ...prev, page: p }));
  const totalPages = data ? Math.ceil(data.total / (params.size ?? 50)) : 0;

  const isGrouped = pdqlResult && "columns" in pdqlResult;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="siem-page-title">Поиск логов</h2>
        <div className="siem-segment-track flex">
          <button
            type="button"
            onClick={() => setMode("simple")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === "simple" ? "bg-vault-600 text-white" : "text-[color:var(--text-soft)] hover:text-[color:var(--text)]"}`}
          >
            Простой фильтр
          </button>
          <button
            type="button"
            onClick={() => setMode("pdql")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === "pdql" ? "bg-vault-600 text-white" : "text-[color:var(--text-soft)] hover:text-[color:var(--text)]"}`}
          >
            PDQL
          </button>
        </div>
      </div>

      {mode === "simple" && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <input
              placeholder="Полнотекстовый поиск..."
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              className="siem-input flex-1 text-sm py-2.5"
            />
            <button type="submit" className="px-6 py-2.5 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors">
              Поиск
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              value={draft.level}
              onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value }))}
              className="siem-input text-sm min-w-[130px]"
            >
              <option value="">Все уровни</option>
              {["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <ComboBox placeholder="Сервис" value={draft.service} onChange={(v: string) => setDraft((d) => ({ ...d, service: v }))} options={serviceOptions} className="w-36" />
            <ComboBox placeholder="ID агента" value={draft.agent_id} onChange={(v: string) => setDraft((d) => ({ ...d, agent_id: v }))} options={agentOptions} className="w-36" />
            <ComboBox placeholder="Хост" value={draft.host} onChange={(v: string) => setDraft((d) => ({ ...d, host: v }))} options={hostOptions} className="w-36" />
            <ComboBox placeholder="Путь источника" value={draft.source} onChange={(v: string) => setDraft((d) => ({ ...d, source: v }))} options={sourceOptions} className="w-44" />
            <div className="flex items-center gap-1">
              <label className="text-xs siem-fg-soft whitespace-nowrap">От:</label>
              <input type="datetime-local" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} className="siem-input text-sm min-w-[11rem]" />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs siem-fg-soft whitespace-nowrap">До:</label>
              <input type="datetime-local" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className="siem-input text-sm min-w-[11rem]" />
            </div>
          </div>
        </form>
      )}

      {mode === "pdql" && (
        <div className="space-y-2">
          <PDQLInput value={pdqlQuery} onChange={setPdqlQuery} onSubmit={handlePdqlSubmit} />
          <p className="text-xs siem-fg-soft">Enter для запуска · Shift+Enter новая строка · Поддерживаются: filter, select, sort, limit, group, aggregate</p>
        </div>
      )}

      {/* Simple mode results */}
      {mode === "simple" && (
        <>
          {error && <div className="text-red-400 bg-red-500/10 rounded-lg p-3 border border-red-500/30 text-sm">{(error as Error).message}</div>}
          {isLoading && <div className="text-center siem-fg-soft py-12">Загрузка...</div>}
          {data && (
            <>
              <div className="text-sm siem-fg-soft">Найдено <span className="siem-fg font-medium">{data.total.toLocaleString()}</span> логов</div>
              <LogTable logs={data.logs} highlight={params.q} />
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button type="button" disabled={params.page === 1} onClick={() => setPage((params.page ?? 1) - 1)} className="siem-btn-ghost text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                  <span className="text-sm siem-fg-soft">Page {params.page} / {totalPages}</span>
                  <button type="button" disabled={params.page === totalPages} onClick={() => setPage((params.page ?? 1) + 1)} className="siem-btn-ghost text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                </div>
              )}
            </>
          )}
          {submitted && !isLoading && !data?.logs.length && !error && <div className="text-center siem-fg-soft py-12">Ничего не найдено</div>}
        </>
      )}

      {/* PDQL mode results */}
      {mode === "pdql" && (
        <>
          {pdqlError && <div className="text-red-400 bg-red-500/10 rounded-lg p-3 border border-red-500/30 text-sm">{pdqlError}</div>}
          {pdqlLoading && <div className="text-center siem-fg-soft py-12">Выполняется PDQL...</div>}
          {pdqlResult && !pdqlLoading && (
            <>
              <div className="text-sm siem-fg-soft">
                Результатов: <span className="siem-fg font-medium">{pdqlResult.total?.toLocaleString() ?? pdqlResult.rows?.length ?? 0}</span>
              </div>
              {isGrouped ? (
                /* Aggregated table */
                <div className="overflow-auto rounded-lg siem-card p-0">
                  <table className="w-full text-sm siem-table">
                    <thead>
                      <tr>
                        {pdqlResult.columns.map((col: string) => (
                          <th key={col} className="px-4 py-2 text-left">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pdqlResult.rows.map((row: any, i: number) => (
                        <tr key={i}>
                          {pdqlResult.columns.map((col: string) => (
                            <td key={col} className="px-4 py-2 siem-fg-muted font-mono text-xs">{String(row[col] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <LogTable logs={pdqlResult.logs ?? []} highlight="" />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
