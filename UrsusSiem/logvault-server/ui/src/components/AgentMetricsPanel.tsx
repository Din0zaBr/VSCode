import type { AgentMetrics } from "../api/client";

interface Props {
  data: AgentMetrics[];
}

function gaugeColor(pct: number): string {
  if (pct >= 85) return "bg-red-500";
  if (pct >= 60) return "bg-yellow-500";
  return "bg-green-500";
}

function gaugeTextColor(pct: number): string {
  if (pct >= 85) return "text-red-400";
  if (pct >= 60) return "text-yellow-400";
  return "text-purple-300";
}

function GaugeBar({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span className="text-gray-400">{label}</span>
        <span className={gaugeTextColor(clamped)}>
          {clamped.toFixed(1)}%
          <span className="text-gray-600 ml-1">({detail})</span>
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${gaugeColor(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function AgentCard({ m }: { m: AgentMetrics }) {
  const cpuPct = m.cpu?.usage_percent ?? 0;
  const memPct = m.memory?.usage_percent ?? 0;
  const memUsed = m.memory?.used_mb ?? 0;
  const memTotal = m.memory?.total_mb ?? 0;

  const mainDisk = m.disk?.find((d) => d.mount === "/") ?? m.disk?.[0];
  const diskPct = mainDisk?.usage_percent ?? 0;
  const diskUsed = mainDisk?.used_gb ?? 0;
  const diskTotal = mainDisk?.total_gb ?? 0;

  const load = m.load_average;
  const loadTitle = load
    ? `Load Average: ${load["1m"]} / ${load["5m"]} / ${load["15m"]}`
    : "";

  const distroLabel = m.distro?.name
    ? `${m.distro.name}${m.distro.version ? " " + m.distro.version : ""}`
    : "";

  const ago = timeSince(m.timestamp);

  return (
    <div
      className="border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors"
      title={loadTitle}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <div className="text-xs font-mono text-vault-300 truncate" title={m.agent_id}>
            {m.agent_id}
          </div>
          <div className="text-[10px] text-gray-600 truncate">
            {m.host}
            {distroLabel && <span className="ml-1.5 text-gray-700">{distroLabel}</span>}
          </div>
        </div>
        <div className="shrink-0 ml-2 text-right">
          {m.uptime?.human && (
            <div className="text-[10px] text-gray-600" title="Uptime">
              {m.uptime.human}
            </div>
          )}
          <div className="text-[10px] text-gray-700">{ago}</div>
        </div>
      </div>

      <div className="space-y-2">
        <GaugeBar
          label="CPU"
          percent={cpuPct}
          detail={`${m.cpu?.cores ?? "?"} cores`}
        />
        <GaugeBar
          label="RAM"
          percent={memPct}
          detail={`${formatMb(memUsed)} / ${formatMb(memTotal)}`}
        />
        <GaugeBar
          label="Disk"
          percent={diskPct}
          detail={`${diskUsed} / ${diskTotal} GB`}
        />
      </div>
    </div>
  );
}

function formatMb(mb: number): string {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + " GB";
  return Math.round(mb) + " MB";
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "только что";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}с назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}м назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}ч назад`;
  return `${Math.floor(hr / 24)}д назад`;
}

export default function AgentMetricsPanel({ data }: Props) {
  if (!data.length) {
    return (
      <div className="text-center text-gray-500 py-8">
        Нет данных о метриках
      </div>
    );
  }

  return (
    <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
      {data.map((m) => (
        <AgentCard key={m.agent_id} m={m} />
      ))}
    </div>
  );
}
