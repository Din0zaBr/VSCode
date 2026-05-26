import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { TimeBucket } from "../api/client";

const LEVEL_COLOR: Record<string, string> = {
  ERROR: "#ef4444",
  WARN: "#eab308",
  WARNING: "#eab308",
  INFO: "#3b82f6",
  DEBUG: "#6b7280",
  CRITICAL: "#dc2626",
};

const INTERVAL_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function formatTick(ts: number, interval: string): string {
  const d = new Date(ts);
  if (interval === "1d") {
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  }
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function generateTicks(data: { ts: number }[], interval: string): number[] {
  if (data.length < 2) return data.map((d) => d.ts);

  const step = INTERVAL_MS[interval];
  if (!step) return data.map((d) => d.ts);

  const min = data[0].ts;
  const max = data[data.length - 1].ts;

  const maxTicks = 12;
  let tickStep = step;
  while ((max - min) / tickStep > maxTicks) {
    tickStep *= 2;
  }

  const ticks: number[] = [];
  const start = Math.ceil(min / tickStep) * tickStep;
  for (let t = start; t <= max; t += tickStep) {
    ticks.push(t);
  }
  return ticks;
}

interface Props {
  data: TimeBucket[];
  interval?: string;
}

export default function TimeChart({ data, interval = "1h" }: Props) {
  const allLevels = new Set<string>();
  data.forEach((b) =>
    b.by_level?.buckets.forEach((lb) => allLevels.add(lb.key)),
  );

  const chartData = data.map((b) => {
    const row: Record<string, number> = {
      ts: b.key,
      total: b.doc_count,
    };
    allLevels.forEach((lv) => {
      const found = b.by_level?.buckets.find((lb) => lb.key === lv);
      row[lv] = found?.doc_count ?? 0;
    });
    return row;
  });

  const levels = Array.from(allLevels);

  if (!chartData.length) {
    return <div className="text-center text-gray-500 py-8">No data yet</div>;
  }

  const ticks = generateTicks(chartData as { ts: number }[], interval);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          ticks={ticks}
          tickFormatter={(v) => formatTick(v, interval)}
          stroke="#9ca3af"
          fontSize={11}
        />
        <YAxis stroke="#9ca3af" fontSize={11} />
        <Tooltip
          labelFormatter={(v) => {
            const d = new Date(v as number);
            return d.toLocaleString("ru-RU", {
              day: "2-digit", month: "2-digit",
              hour: "2-digit", minute: "2-digit",
            });
          }}
          contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#d1d5db" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {levels.map((lv) => (
          <Area
            key={lv}
            type="monotone"
            dataKey={lv}
            stackId="1"
            stroke={LEVEL_COLOR[lv] ?? "#8b5cf6"}
            fill={LEVEL_COLOR[lv] ?? "#8b5cf6"}
            fillOpacity={0.3}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
