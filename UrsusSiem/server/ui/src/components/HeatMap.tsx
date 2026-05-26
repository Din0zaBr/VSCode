import type { TimeBucket } from "../api/client";

interface Props {
  data: TimeBucket[];
}

function getColor(count: number, max: number): string {
  if (max === 0 || count === 0) return "bg-[var(--surface-2)]";
  const ratio = count / max;
  if (ratio > 0.8) return "bg-red-500";
  if (ratio > 0.6) return "bg-orange-500";
  if (ratio > 0.4) return "bg-yellow-500";
  if (ratio > 0.2) return "bg-blue-500";
  return "bg-blue-900";
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export default function HeatMap({ data }: Props) {
  const grid: Record<string, number> = {};
  let maxCount = 0;

  data.forEach((b) => {
    const d = new Date(b.key);
    const day = (d.getDay() + 6) % 7;
    const hour = d.getHours();
    const key = `${day}-${hour}`;
    grid[key] = (grid[key] || 0) + b.doc_count;
    if (grid[key] > maxCount) maxCount = grid[key];
  });

  if (!data.length) {
    return <div className="text-center siem-fg-soft py-8">No data yet</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        <div className="flex gap-0.5 mb-1 ml-10">
          {HOURS.map((h) => (
            <div key={h} className="w-6 text-center text-[10px] siem-fg-soft">
              {h}
            </div>
          ))}
        </div>
        {DAYS.map((day, di) => (
          <div key={day} className="flex items-center gap-0.5 mb-0.5">
            <div className="w-9 text-right text-[10px] siem-fg-soft pr-1">{day}</div>
            {HOURS.map((h) => {
              const count = grid[`${di}-${h}`] || 0;
              return (
                <div
                  key={h}
                  title={`${day} ${h}:00 — ${count} logs`}
                  className={`w-6 h-6 rounded-sm ${getColor(count, maxCount)} transition-colors cursor-default`}
                />
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-3 ml-10">
          <span className="text-[10px] siem-fg-soft">Less</span>
          {["bg-[var(--surface-2)]", "bg-blue-900", "bg-blue-500", "bg-yellow-500", "bg-orange-500", "bg-red-500"].map((c) => (
            <div key={c} className={`w-4 h-4 rounded-sm ${c}`} />
          ))}
          <span className="text-[10px] siem-fg-soft">More</span>
        </div>
      </div>
    </div>
  );
}
