import { useState } from "react";
import QueryConditionRow from "./QueryConditionRow";
import type { QueryCondition } from "./QueryConditionRow";

function conditionToPDQL(c: QueryCondition): string {
  const { field, operator, value } = c;
  if (!value.trim()) return "";
  if (operator === "in") {
    const vals = value.split(",").map((v) => `"${v.trim()}"`).join(", ");
    return `${field} in [${vals}]`;
  }
  if (["contains", "startswith", "endswith", "match"].includes(operator)) {
    return `${field} ${operator} "${value}"`;
  }
  if (!isNaN(Number(value))) {
    return `${field} ${operator} ${value}`;
  }
  return `${field} ${operator} "${value}"`;
}

function buildPDQL(conditions: QueryCondition[]): string {
  const parts: string[] = [];
  conditions.forEach((c, i) => {
    const expr = conditionToPDQL(c);
    if (!expr) return;
    if (parts.length === 0) {
      parts.push(expr);
    } else {
      parts.push(`${c.logic} ${expr}`);
    }
  });
  if (!parts.length) return "";
  return `filter(${parts.join(" ")})`;
}

let nextId = 1;
function newCondition(): QueryCondition {
  return { id: `c${nextId++}`, field: "level", operator: "=", value: "ERROR", logic: "AND" };
}

interface QueryBuilderProps {
  onApply: (pdql: string) => void;
  onClose: () => void;
}

export default function QueryBuilder({ onApply, onClose }: QueryBuilderProps) {
  const [conditions, setConditions] = useState<QueryCondition[]>([newCondition()]);
  const [sortField, setSortField] = useState("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [limitVal, setLimitVal] = useState("100");

  const preview = (() => {
    const filter = buildPDQL(conditions);
    const parts = [filter, `sort(${sortField} ${sortDir})`, `limit(${limitVal})`].filter(Boolean);
    return parts.join(" | ");
  })();

  const handleAdd = () => setConditions((c) => [...c, newCondition()]);

  const handleChange = (id: string, updated: QueryCondition) => {
    setConditions((c) => c.map((x) => (x.id === id ? updated : x)));
  };

  const handleRemove = (id: string) => {
    setConditions((c) => c.filter((x) => x.id !== id));
  };

  const inputStyle = {
    background: "#0d1117",
    border: "1px solid #1a0d2e",
    color: "#e2e8f0",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "12px",
    outline: "none",
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="siem-card w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "#1a0d2e" }}>
          <h3 className="text-sm font-semibold text-gray-200">Визуальный конструктор запросов</h3>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-sm">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase">Условия фильтра</span>
              <button
                type="button"
                onClick={handleAdd}
                className="siem-btn text-[11px] px-3 py-1"
              >
                + Добавить условие
              </button>
            </div>
            <div className="space-y-2">
              {conditions.map((c, i) => (
                <QueryConditionRow
                  key={c.id}
                  condition={c}
                  index={i}
                  isFirst={i === 0}
                  onChange={(updated) => handleChange(c.id, updated)}
                  onRemove={() => handleRemove(c.id)}
                />
              ))}
              {conditions.length === 0 && (
                <div className="text-xs text-gray-600 text-center py-4">
                  Нет условий — будут возвращены все события
                </div>
              )}
            </div>
          </div>

          {/* Sort + limit */}
          <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: "#1a0d2e" }}>
            <span className="text-xs text-gray-500 flex-shrink-0">Сортировка:</span>
            <input
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
              style={{ ...inputStyle, width: "120px" }}
              placeholder="time"
            />
            <select
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
              style={{ ...inputStyle, width: "70px" }}
            >
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </select>
            <span className="text-xs text-gray-500 flex-shrink-0 ml-2">Лимит:</span>
            <input
              type="number"
              value={limitVal}
              onChange={(e) => setLimitVal(e.target.value)}
              style={{ ...inputStyle, width: "80px" }}
              min={1}
              max={10000}
            />
          </div>

          {/* Preview */}
          <div className="pt-2 border-t" style={{ borderColor: "#1a0d2e" }}>
            <div className="text-xs text-gray-500 uppercase mb-1">Предпросмотр PDQL:</div>
            <div
              className="font-mono text-[11px] px-3 py-2 rounded break-all"
              style={{ background: "#08090e", color: "#BF40BF", border: "1px solid #1a0d2e" }}
            >
              {preview || "sort(time desc) | limit(100)"}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "#1a0d2e" }}>
          <button onClick={onClose} className="siem-btn-ghost text-xs px-4 py-2">Отмена</button>
          <button
            onClick={() => { onApply(preview || "sort(time desc) | limit(100)"); onClose(); }}
            className="siem-btn text-xs px-4 py-2"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
