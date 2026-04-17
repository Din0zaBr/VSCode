interface AggregateSelectorProps {
  selected: string[];
  onChange: (selected: string[]) => void;
}

interface AggOption {
  id: string;
  label: string;
  description: string;
}

const AGG_OPTIONS: AggOption[] = [
  {
    id: "count()",
    label: "count()",
    description: "Количество событий в группе",
  },
  {
    id: "first()",
    label: "first()",
    description: "Значение первого события",
  },
  {
    id: "last()",
    label: "last()",
    description: "Значение последнего события",
  },
  {
    id: "last_time()",
    label: "last_time()",
    description: "Время последнего события",
  },
];

export default function AggregateSelector({ selected, onChange }: AggregateSelectorProps) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      // Preserve canonical order
      const next = AGG_OPTIONS.map((o) => o.id).filter((o) => selected.includes(o) || o === id);
      onChange(next);
    }
  };

  const allChecked = AGG_OPTIONS.every((o) => selected.includes(o.id));
  const noneChecked = selected.length === 0;

  const handleToggleAll = () => {
    if (allChecked) {
      onChange([]);
    } else {
      onChange(AGG_OPTIONS.map((o) => o.id));
    }
  };

  return (
    <div
      className="rounded-xl border"
      style={{
        background: "#0d0f18",
        borderColor: "#2d1860",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "#1a0d2e" }}
      >
        <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "#8b20d1" }}>
          Агрегаты
        </span>
        <button
          onClick={handleToggleAll}
          className="text-[10px] transition-colors"
          style={{ color: noneChecked ? "#6A0DAD" : "#64748b" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#BF40BF"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = noneChecked ? "#6A0DAD" : "#64748b"; }}
        >
          {allChecked ? "Снять все" : "Выбрать все"}
        </button>
      </div>

      {/* Options */}
      <div className="p-2 space-y-0.5">
        {AGG_OPTIONS.map((opt) => {
          const checked = selected.includes(opt.id);
          return (
            <label
              key={opt.id}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer
                         select-none transition-colors"
              style={{ userSelect: "none" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(106,13,173,0.08)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {/* Custom checkbox */}
              <span
                className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded transition-all"
                style={{
                  background: checked ? "rgba(106,13,173,0.25)" : "transparent",
                  border: checked ? "1.5px solid #BF40BF" : "1.5px solid #2d1860",
                }}
                onClick={() => toggle(opt.id)}
              >
                {checked && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path
                      d="M1 3.5L3.5 6L8 1"
                      stroke="#BF40BF"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>

              {/* Hidden native checkbox for accessibility */}
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => toggle(opt.id)}
                aria-label={opt.label}
              />

              {/* Label text */}
              <div className="flex-1 min-w-0">
                <span
                  className="font-mono text-xs font-medium"
                  style={{ color: checked ? "#BF40BF" : "#94a3b8" }}
                >
                  {opt.label}
                </span>
                <span
                  className="block text-[10px] leading-tight mt-0.5"
                  style={{ color: "#4a3670" }}
                >
                  {opt.description}
                </span>
              </div>

              {/* Active indicator dot */}
              {checked && (
                <span
                  className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ background: "#8b20d1" }}
                />
              )}
            </label>
          );
        })}
      </div>

      {/* Footer: selected summary */}
      {selected.length > 0 && (
        <div
          className="px-3 py-2 border-t flex items-center gap-1.5 flex-wrap"
          style={{ borderColor: "#1a0d2e" }}
        >
          <span className="text-[10px]" style={{ color: "#4a3670" }}>
            Выбрано:
          </span>
          {selected.map((id) => (
            <span
              key={id}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(106,13,173,0.15)",
                color: "#b266ff",
                border: "1px solid rgba(106,13,173,0.3)",
              }}
            >
              {id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
