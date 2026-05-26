import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { AgentInfo } from "../api/client";
import TimeChart from "../components/TimeChart";
import LevelPieChart from "../components/LevelPieChart";
import HeatMap from "../components/HeatMap";
import AgentMetricsPanel from "../components/AgentMetricsPanel";
import { useState } from "react";

const INTERVALS = [
  { label: "5м", value: "5m" },
  { label: "15м", value: "15m" },
  { label: "1ч", value: "1h" },
  { label: "6ч", value: "6h" },
  { label: "1д", value: "1d" },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [interval, setInterval] = useState("1h");

  const { data, isLoading, error } = useQuery({
    queryKey: ["stats", interval],
    queryFn: () => api.stats({ interval }),
    refetchInterval: 30_000,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents(),
    refetchInterval: 15_000,
  });

  const { data: metrics } = useQuery({
    queryKey: ["latestMetrics"],
    queryFn: () => api.latestMetrics(),
    refetchInterval: 15_000,
  });

  if (error) {
    return (
      <div className="text-red-400 bg-red-500/10 rounded-lg p-4 border border-red-500/30">
        Failed to load stats: {(error as Error).message}
      </div>
    );
  }

  const totalLogs = data?.by_level.reduce((s, b) => s + b.doc_count, 0) ?? 0;
  const errorCount = data?.by_level.find((b) => b.key === "ERROR")?.doc_count ?? 0;
  const warnCount =
    (data?.by_level.find((b) => b.key === "WARN")?.doc_count ?? 0) +
    (data?.by_level.find((b) => b.key === "WARNING")?.doc_count ?? 0);

  const activeAgents = agents?.filter((a) => a.active) ?? [];
  const totalAgents = agents?.length ?? 0;

  const hostGroups = new Map<string, AgentInfo[]>();
  for (const a of agents ?? []) {
    const key = a.host || "Без хоста";
    if (!hostGroups.has(key)) hostGroups.set(key, []);
    hostGroups.get(key)!.push(a);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-100">Панель управления</h2>
        <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv.value}
              onClick={() => setInterval(iv.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                interval === iv.value
                  ? "bg-vault-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {iv.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <StatCard label="Всего логов" value={totalLogs} loading={isLoading} />
        <StatCard label="Ошибки" value={errorCount} loading={isLoading} color="text-red-400" />
        <StatCard label="Предупреждения" value={warnCount} loading={isLoading} color="text-yellow-400" />
        <StatCard label="Активные агенты" value={activeAgents.length} loading={isLoading} color="text-green-400" subtitle="за 5 мин" />
        <StatCard label="Всего агентов" value={totalAgents} loading={isLoading} color="text-vault-400" subtitle="за всё время" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Частота логов" className="col-span-2">
          {data ? <TimeChart data={data.over_time} interval={interval} /> : <Skeleton />}
        </Card>
        <Card title="Распределение по уровням">
          {data ? <LevelPieChart data={data.by_level} /> : <Skeleton />}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Тепловая карта ошибок (день / час)">
          {data ? <HeatMap data={data.heatmap} /> : <Skeleton />}
        </Card>
        <Card title="Состояние систем">
          {metrics ? <AgentMetricsPanel data={metrics} /> : <Skeleton />}
        </Card>
      </div>

      {agents && agents.length > 0 && (
        <Card title="Агенты по хостам">
          <div className="space-y-4">
            {[...hostGroups.entries()].map(([host, hostAgents]) => {
              const hostActive = hostAgents.filter((a) => a.active).length;
              const hostLogs = hostAgents.reduce((s, a) => s + a.doc_count, 0);
              return (
                <div key={host} className="border border-gray-800 rounded-lg overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-2.5 bg-gray-800/40 cursor-pointer hover:bg-gray-800/70 transition-colors"
                    onClick={() => navigate(`/search?host=${encodeURIComponent(host === "Без хоста" ? "" : host)}`)}
                    title="Перейти к поиску по хосту"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-vault-300 font-semibold text-sm">{host}</span>
                      <span className="text-[11px] text-gray-500">
                        {hostAgents.length} {agentWord(hostAgents.length)}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className={hostActive > 0 ? "text-green-400" : "text-gray-600"}>
                        {hostActive > 0 ? `${hostActive} активн.` : "нет активных"}
                      </span>
                      <span className="text-gray-500">{hostLogs.toLocaleString()} логов</span>
                    </div>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800/50">
                          <th className="px-4 py-1.5">Статус</th>
                          <th className="px-4 py-1.5">ID агента</th>
                          <th className="px-4 py-1.5">Логи</th>
                          <th className="px-4 py-1.5">Последнее обновление</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/30">
                        {hostAgents.map((a) => (
                          <tr
                            key={a.agent_id}
                            className="hover:bg-gray-800/30 cursor-pointer group"
                            onClick={() => navigate(`/search?agent_id=${encodeURIComponent(a.agent_id)}`)}
                          >
                            <td className="px-4 py-1.5">
                              <span className={`inline-block w-2 h-2 rounded-full ${a.active ? "bg-green-400" : "bg-gray-600"}`}
                                    title={a.active ? "Активен (< 5 мин)" : "Неактивен"} />
                            </td>
                            <td className="px-4 py-1.5 font-mono text-vault-300 group-hover:text-vault-200 transition-colors text-xs">
                              {a.agent_id}
                            </td>
                            <td className="px-4 py-1.5 text-gray-400 text-xs">{a.doc_count.toLocaleString()}</td>
                            <td className="px-4 py-1.5 text-gray-500 text-xs">
                              {a.last_seen ? new Date(a.last_seen).toLocaleString("ru-RU") : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function agentWord(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "агентов";
  if (last === 1) return "агент";
  if (last >= 2 && last <= 4) return "агента";
  return "агентов";
}

function StatCard({ label, value, loading, color, subtitle }: {
  label: string;
  value: number;
  loading: boolean;
  color?: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
        {label}
        {subtitle && <span className="ml-1 normal-case text-gray-600">({subtitle})</span>}
      </div>
      <div className={`text-3xl font-bold ${color ?? "text-gray-100"}`}>
        {loading ? "—" : value.toLocaleString()}
      </div>
    </div>
  );
}

function Card({ title, children, className = "" }: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-gray-900 rounded-xl border border-gray-800 p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-300 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Skeleton() {
  return <div className="h-64 bg-gray-800/50 animate-pulse rounded-lg" />;
}
