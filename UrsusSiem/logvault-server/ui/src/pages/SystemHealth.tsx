import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

const STATUS_COLORS: Record<string, string> = {
  healthy: "bg-green-500",
  running: "bg-green-500",
  ok: "bg-green-500",
  stub: "bg-yellow-500",
  unhealthy: "bg-red-500",
  not_implemented: "bg-neutral-400 dark:bg-neutral-600",
};

function StatusDot({ status }: { status: string }) {
  return <div className={`w-3 h-3 rounded-full flex-shrink-0 ${STATUS_COLORS[status] ?? "bg-neutral-400 dark:bg-neutral-600"}`} />;
}

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="siem-card rounded-xl p-4 space-y-3">
      <h3 className="siem-section-title">{title}</h3>
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
        <h2 className="siem-page-title">System Health</h2>
        {dataUpdatedAt > 0 && (
          <span className="text-xs siem-fg-soft">
            Обновлено: {new Date(dataUpdatedAt).toLocaleTimeString("ru")}
          </span>
        )}
      </div>

      {isLoading && <div className="text-center siem-fg-soft py-12">Загрузка...</div>}

      {health && (
        <>
          {/* Components */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Object.entries(components).map(([name, info]: [string, any]) => (
              <div key={name} className="siem-card rounded-xl p-4 flex items-center gap-3">
                <StatusDot status={info?.status ?? "unknown"} />
                <div>
                  <div className="text-xs font-medium siem-fg capitalize">{name.replace(/_/g, " ")}</div>
                  <div className="text-xs siem-fg-soft">{info?.status ?? "?"}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <MetricCard title="События за 24ч">
              <div className="text-3xl font-bold siem-fg">{(stats.events_24h ?? 0).toLocaleString()}</div>
              <div className="text-xs siem-fg-soft">EPS: {stats.eps ?? 0}</div>
            </MetricCard>
            <MetricCard title="Ошибки / Критические">
              <div className="text-3xl font-bold text-orange-400">{(stats.errors_24h ?? 0).toLocaleString()}</div>
              <div className="text-xs text-red-400">Критических: {stats.critical_24h ?? 0}</div>
            </MetricCard>
            <MetricCard title="Активные агенты">
              <div className="text-3xl font-bold" style={{ color: "var(--accent)" }}>{agents.active ?? 0}</div>
              <div className="text-xs siem-fg-soft">Неактивных: {agents.inactive ?? 0} · Всего: {agents.total ?? 0}</div>
            </MetricCard>
            <MetricCard title="База данных">
              <div className="text-3xl font-bold text-vault-400">
                {components.database?.db_size_human ?? "—"}
              </div>
              <div className="text-xs siem-fg-soft">
                Всего логов: {(components.database?.total_logs ?? 0).toLocaleString()}
              </div>
            </MetricCard>
          </div>

          {/* Correlation stats */}
          {components.correlation_engine && (
            <MetricCard title="Корреляционный движок">
              <div className="flex gap-8">
                <div>
                  <div className="text-2xl font-bold siem-fg">{components.correlation_engine.rules_count ?? 0}</div>
                  <div className="text-xs siem-fg-soft">Правил</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-orange-400">{components.correlation_engine.alerts_total ?? 0}</div>
                  <div className="text-xs siem-fg-soft">Алертов</div>
                </div>
              </div>
            </MetricCard>
          )}
        </>
      )}
    </div>
  );
}
