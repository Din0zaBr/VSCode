import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CorrelationAlert } from "../api/client";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "text-red-400",
  HIGH: "text-orange-400",
  MEDIUM: "text-yellow-400",
  LOW: "text-blue-400",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-red-500/10 text-red-400 border-red-500/30",
  INVESTIGATING: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  RESOLVED: "bg-green-500/10 text-green-400 border-green-500/30",
  FALSE_POSITIVE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

export default function CorrelationAlerts() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [page, setPage] = useState(1);
  const size = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["corr-alerts", statusFilter, severityFilter, page],
    queryFn: () => api.correlationAlerts({ limit: size, offset: (page - 1) * size, status: statusFilter, severity: severityFilter }),
    refetchInterval: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes?: string }) =>
      api.updateCorrelationAlertStatus(id, status, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corr-alerts"] }),
  });

  const totalPages = data ? Math.ceil(data.total / size) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-100">Алерты корреляции</h2>
        <span className="text-sm text-gray-400">Всего: {data?.total ?? 0}</span>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
          <option value="">Все статусы</option>
          {["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={severityFilter} onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200">
          <option value="">Все severity</option>
          {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {isLoading && <div className="text-center text-gray-500 py-12">Загрузка...</div>}

      <div className="space-y-2">
        {(data?.alerts ?? []).map((alert: CorrelationAlert) => (
          <div key={alert.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium ${SEVERITY_COLORS[alert.severity] ?? "text-gray-300"}`}>[{alert.severity}]</span>
                  <span className="text-sm font-medium text-gray-100">{alert.rule_name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_COLORS[alert.status] ?? ""}`}>{alert.status}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1">{alert.description}</div>
                {alert.source_ip && <div className="text-xs text-gray-500">IP: {alert.source_ip}</div>}
                <div className="text-xs text-gray-600">{new Date(alert.created_at).toLocaleString("ru")}</div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {alert.status === "OPEN" && (
                  <button onClick={() => updateMutation.mutate({ id: alert.id, status: "INVESTIGATING" })} className="px-3 py-1.5 text-xs bg-yellow-900/40 hover:bg-yellow-800/40 text-yellow-400 rounded-lg transition-colors">Расследую</button>
                )}
                {alert.status !== "RESOLVED" && (
                  <button onClick={() => updateMutation.mutate({ id: alert.id, status: "RESOLVED" })} className="px-3 py-1.5 text-xs bg-green-900/40 hover:bg-green-800/40 text-green-400 rounded-lg transition-colors">Закрыть</button>
                )}
                {alert.status !== "FALSE_POSITIVE" && (
                  <button onClick={() => updateMutation.mutate({ id: alert.id, status: "FALSE_POSITIVE" })} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg transition-colors">Ложный</button>
                )}
              </div>
            </div>
          </div>
        ))}
        {!isLoading && !data?.alerts?.length && <div className="text-center text-gray-500 py-8">Нет алертов</div>}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-sm transition-colors">Prev</button>
          <span className="text-sm text-gray-400">Стр. {page} / {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-sm transition-colors">Next</button>
        </div>
      )}
    </div>
  );
}
