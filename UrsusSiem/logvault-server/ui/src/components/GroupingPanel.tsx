import { useState } from "react";

interface GroupingPanelProps {
  columns: string[];
  rows: Record<string, unknown>[];
  onDrillDown: (row: Record<string, unknown>) => void;
  onClose: () => void;
}

/** Format a raw cell value for display. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "да" : "нет";
  return JSON.stringify(value);
}

/** Shorten long strings in table cells. */
function truncate(str: string, max = 28): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

const SPECIAL_COLS = new Set(["count", "first", "last", "last_time", "count()", "first()", "last()", "last_time()"]);

function isAggregateCol(col: string): boolean {
  return SPECIAL_COLS.has(col) || /^(count|first|last|last_time)\b/.test(col);
}

export default function GroupingPanel({ columns, rows, onDrillDown, onClose }: GroupingPanelProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    if (!sortCol) return 0;
    const av = a[sortCol];
    const bv = b[sortCol];
    const an = typeof av === "number" ? av : parseFloat(String(av ?? ""));
    const bn = typeof bv === "number" ? bv : parseFloat(String(bv ?? ""));
    const numericCmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
    return sortDir === "asc" ? numericCmp : -numericCmp;
  });

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) {
      return (
        <svg width="8" height="10" viewBox="0 0 8 10" fill="none" className="inline ml-1 opacity-30">
          <path d="M4 1v8M1.5 3.5L4 1l2.5 2.5M1.5 6.5L4 9l2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="inline ml-1 opacity-80">
        {sortDir === "desc"
          ? <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="M1 5.5L4 2.5L7 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        }
      </svg>
    );
  };

  return (
    <div
      className="flex flex-col rounded-xl border overflow-hidden"
      style={{
        background: "#1f2937",
        borderColor: "#4b5563",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)",
        minWidth: "360px",
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 border-b"
        style={{
          background: "linear-gradient(90deg, #1f2937 0%, #12101e 100%)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex items-center gap-2">
          {/* Grid icon */}
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
            <rect x="0.5" y="0.5" width="4" height="4" rx="0.5" stroke="#8b20d1" strokeWidth="1.2" />
            <rect x="7.5" y="0.5" width="4" height="4" rx="0.5" stroke="#8b20d1" strokeWidth="1.2" />
            <rect x="0.5" y="7.5" width="4" height="4" rx="0.5" stroke="#8b20d1" strokeWidth="1.2" />
            <rect x="7.5" y="7.5" width="4" height="4" rx="0.5" stroke="#8b20d1" strokeWidth="1.2" />
          </svg>
          <span className="text-xs font-medium" style={{ color: "#a78bfa" }}>
            Результаты группировки
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "rgba(167,139,250,0.2)", color: "#8b20d1", border: "1px solid #4b5563" }}
          >
            {rows.length}
          </span>
        </div>
        <button
          onClick={onClose}
          title="Закрыть панель"
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors"
          style={{ color: "var(--text-soft)", border: "1px solid transparent" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#f87171";
            e.currentTarget.style.borderColor = "#7f1d1d";
            e.currentTarget.style.background = "rgba(239,68,68,0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#64748b";
            e.currentTarget.style.borderColor = "transparent";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Закрыть
        </button>
      </div>

      {/* Table area */}
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-12 text-sm" style={{ color: "#4a3670" }}>
          Нет данных для отображения
        </div>
      ) : (
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs border-collapse">
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr style={{ background: "#111827", borderBottom: "1px solid #374151" }}>
                {columns.map((col) => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className="px-3 py-2 text-left font-medium uppercase tracking-wider
                               cursor-pointer select-none transition-colors whitespace-nowrap"
                    style={{
                      color: sortCol === col ? "#a78bfa" : "#64748b",
                      borderRight: "1px solid rgba(26,13,46,0.5)",
                    }}
                    onMouseEnter={(e) => { if (sortCol !== col) (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}
                    onMouseLeave={(e) => { if (sortCol !== col) (e.currentTarget as HTMLElement).style.color = "#64748b"; }}
                  >
                    {col}
                    <SortIcon col={col} />
                  </th>
                ))}
                {/* Drill-down spacer */}
                <th
                  className="px-2 py-2"
                  style={{ color: "#4a3670", borderRight: "none", width: "28px" }}
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => onDrillDown(row)}
                  className="cursor-pointer transition-colors"
                  style={{ borderBottom: "1px solid rgba(26,13,46,0.4)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(167,139,250,0.08)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  {columns.map((col) => {
                    const raw = row[col];
                    const text = formatCell(raw);
                    const isAgg = isAggregateCol(col);
                    return (
                      <td
                        key={col}
                        title={text}
                        className="px-3 py-1.5 font-mono whitespace-nowrap"
                        style={{
                          color: isAgg ? "#60a5fa" : "#cbd5e1",
                          borderRight: "1px solid rgba(26,13,46,0.3)",
                          maxWidth: "180px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {isAgg && col.startsWith("count")
                          ? <span className="font-semibold" style={{ color: "#a78bfa" }}>{text}</span>
                          : truncate(text)
                        }
                      </td>
                    );
                  })}
                  {/* Drill-down arrow */}
                  <td className="px-2 py-1.5 text-center" style={{ color: "#4a3670" }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M3.5 2L7 5l-3.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer hint */}
      <div
        className="px-4 py-1.5 flex-shrink-0 border-t flex items-center gap-1.5"
        style={{ borderColor: "var(--border)", background: "#111827" }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="4" stroke="#4a3670" strokeWidth="1.2" />
          <path d="M5 4.5v3M5 3v.5" stroke="#4a3670" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="text-[10px]" style={{ color: "#4a3670" }}>
          Кликните по строке для детального просмотра
        </span>
      </div>
    </div>
  );
}
