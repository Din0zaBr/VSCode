import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

const STATUS_COLORS: Record<string, string> = {
  healthy: "bg-green-500",
  running: "bg-green-500",
  ok: "bg-green-500",
  stub: "bg-yellow-500",
  unhealthy: "bg-red-500",
  not_implemented: "bg-gray-600",
};

function StatusDot({ status }: { status: string }) {
  return <div className={`w-3 h-3 rounded-full flex-shrink-0 ${STATUS_COLORS[status] ?? "bg-gray-600"}`} />;
}

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

export default function SystemHealth() {
  const { data: health, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["system-health"],
    queryFn: api.systemHealth,
    refetchInterval: 30_000,
  });

  const components = health?.components ?? {};
  const stats = health?.statistics ?? {};
  const agents = health?.agents ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-100">System Health</h2>
        {dataUpdatedAt > 0 && (
          <span className="text-xs text-gray-600">
            Обновлено: {new Date(dataUpdatedAt).toLocaleTimeString("ru")}
          </span>
        )}
      </div>

      {isLoading && <div className="text-center text-gray-500 py-12">Загрузка...</div>}

      {health && (
        <>
          {/* Components */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Object.entries(components).map(([name, info]: [string, any]) => (
              <div key={name} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-3">
                <StatusDot status={info?.status ?? "unknown"} />
                <div>
                  <div className="text-xs font-medium text-gray-200 capitalize">{name.replace(/_/g, " ")}</div>
                  <div className="text-xs text-gray-500">{info?.status ?? "?"}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <MetricCard title="События за 24ч">
              <div className="text-3xl font-bold text-gray-100">{(stats.events_24h ?? 0).toLocaleString()}</div>
              <div className="text-xs text-gray-500">EPS: {stats.eps ?? 0}</div>
            </MetricCard>
            <MetricCard title="Ошибки / Критические">
              <div className="text-3xl font-bold text-orange-400">{(stats.errors_24h ?? 0).toLocaleString()}</div>
              <div className="text-xs text-red-400">Критических: {stats.critical_24h ?? 0}</div>
            </MetricCard>
            <MetricCard title="Активные агенты">
              <div className="text-3xl font-bold text-green-400">{agents.active ?? 0}</div>
              <div className="text-xs text-gray-500">Неактивных: {agents.inactive ?? 0} · Всего: {agents.total ?? 0}</div>
            </MetricCard>
            <MetricCard title="База данных">
              <div className="text-3xl font-bold text-vault-400">
                {components.database?.db_size_human ?? "—"}
              </div>
              <div className="text-xs text-gray-500">
                Всего логов: {(components.database?.total_logs ?? 0).toLocaleString()}
              </div>
            </MetricCard>
          </div>

          {/* Correlation stats */}
          {components.correlation_engine && (
            <MetricCard title="Корреляционный движок">
              <div className="flex gap-8">
                <div>
                  <div className="text-2xl font-bold text-gray-100">{components.correlation_engine.rules_count ?? 0}</div>
                  <div className="text-xs text-gray-500">Правил</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-orange-400">{components.correlation_engine.alerts_total ?? 0}</div>
                  <div className="text-xs text-gray-500">Алертов</div>
                </div>
              </div>
            </MetricCard>
          )}
        </>
      )}
    </div>
  );
}
