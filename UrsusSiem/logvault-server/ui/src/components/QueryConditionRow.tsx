interface QueryCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
  logic: "AND" | "OR";
}

const FIELDS: { value: string; label: string; type: "string" | "number" | "enum" }[] = [
  { value: "level",           label: "level",           type: "enum" },
  { value: "host",            label: "host",            type: "string" },
  { value: "agent_id",        label: "agent_id",        type: "string" },
  { value: "source",          label: "source",          type: "string" },
  { value: "service",         label: "service",         type: "string" },
  { value: "src.ip",          label: "src.ip",          type: "string" },
  { value: "dst.ip",          label: "dst.ip",          type: "string" },
  { value: "src.port",        label: "src.port",        type: "number" },
  { value: "dst.port",        label: "dst.port",        type: "number" },
  { value: "protocol",        label: "protocol",        type: "string" },
  { value: "action",          label: "action",          type: "string" },
  { value: "status",          label: "status",          type: "string" },
  { value: "category.generic",label: "category.generic",type: "string" },
  { value: "category.high",   label: "category.high",   type: "string" },
  { value: "message",         label: "message",         type: "string" },
  { value: "subject.name",    label: "subject.name",    type: "string" },
  { value: "object.name",     label: "object.name",     type: "string" },
];

const LEVEL_OPTIONS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

const OPERATORS_FOR: Record<string, string[]> = {
  string: ["=", "!=", "contains", "startswith", "endswith", "match"],
  number: ["=", "!=", ">", "<", ">=", "<="],
  enum:   ["=", "!=", "in"],
};

interface QueryConditionRowProps {
  condition: QueryCondition;
  index: number;
  isFirst: boolean;
  onChange: (updated: QueryCondition) => void;
  onRemove: () => void;
}

export type { QueryCondition };

export default function QueryConditionRow({
  condition, index, isFirst, onChange, onRemove,
}: QueryConditionRowProps) {
  const fieldMeta = FIELDS.find((f) => f.value === condition.field) ?? FIELDS[0];
  const operators = OPERATORS_FOR[fieldMeta.type] ?? OPERATORS_FOR.string;

  const inputStyle = {
    background: "#0d1117",
    border: "1px solid #1a0d2e",
    color: "#e2e8f0",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "12px",
    outline: "none",
    width: "100%",
  };

  return (
    <div className="flex items-center gap-2">
      {/* AND / OR */}
      {!isFirst && (
        <select
          value={condition.logic}
          onChange={(e) => onChange({ ...condition, logic: e.target.value as "AND" | "OR" })}
          style={{ ...inputStyle, width: "60px", flexShrink: 0 }}
        >
          <option>AND</option>
          <option>OR</option>
        </select>
      )}
      {isFirst && <div style={{ width: "60px", flexShrink: 0 }} />}

      {/* Field */}
      <select
        value={condition.field}
        onChange={(e) => onChange({ ...condition, field: e.target.value, operator: "=", value: "" })}
        style={{ ...inputStyle, width: "160px", flexShrink: 0 }}
      >
        {FIELDS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {/* Operator */}
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value })}
        style={{ ...inputStyle, width: "110px", flexShrink: 0 }}
      >
        {operators.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>

      {/* Value */}
      {fieldMeta.type === "enum" && condition.operator !== "in" ? (
        <select
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          style={{ ...inputStyle, flexShrink: 0, width: "120px" }}
        >
          {LEVEL_OPTIONS.map((v) => <option key={v}>{v}</option>)}
        </select>
      ) : (
        <input
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          placeholder={condition.operator === "in" ? "VAL1, VAL2" : "значение"}
          style={{ ...inputStyle, flex: 1, minWidth: "100px" }}
        />
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-red-400 transition-colors"
        style={{ background: "rgba(239,68,68,0.08)" }}
        title="Удалить условие"
      >
        ✕
      </button>
    </div>
  );
}
