import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { TermBucket } from "../api/client";

interface Props {
  data: TermBucket[];
}

export default function ServiceBarChart({ data }: Props) {
  if (!data.length) {
    return <div className="text-center text-gray-500 py-8">Нет данных еще</div>;
  }

  const chartData = data.slice(0, 10).map((b) => ({
    name: b.key,
    count: b.doc_count,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis type="number" stroke="#9ca3af" fontSize={11} />
        <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={11} width={100} />
        <Tooltip
          contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="count" fill="#4c6ef5" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
