import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import type { TermBucket } from "../api/client";

const COLORS: Record<string, string> = {
  CRITICAL: "#dc2626",
  ERROR: "#ef4444",
  WARN: "#eab308",
  WARNING: "#eab308",
  INFO: "#3b82f6",
  DEBUG: "#6b7280",
};

const FALLBACK = ["#8b5cf6", "#06b6d4", "#10b981", "#f97316", "#ec4899"];

interface Props {
  data: TermBucket[];
}

export default function LevelPieChart({ data }: Props) {
  if (!data.length) {
    return <div className="text-center siem-fg-soft py-8">Нет данных еще</div>;
  }

  const chartData = data.map((b) => ({
    name: b.key,
    value: b.doc_count,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
          fontSize={11}
        >
          {chartData.map((entry, i) => (
            <Cell
              key={entry.name}
              fill={COLORS[entry.name] ?? FALLBACK[i % FALLBACK.length]}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
