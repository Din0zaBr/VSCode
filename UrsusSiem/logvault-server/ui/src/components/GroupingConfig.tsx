import { useState, useRef, useEffect } from "react";

const AVAILABLE_FIELDS = [
  "host", "level", "service", "src_ip", "dst_ip",
  "user", "action", "status", "protocol", "category",
];

interface GroupingConfigProps {
  fields: string[];
  onChange: (fields: string[]) => void;
}

export default function GroupingConfig({ fields, onChange }: GroupingConfigProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(fields);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) setDraft(fields);
  }, [fields, open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (!open) setDraft(fields);
    setOpen((v) => !v);
  };

  const handleFieldChange = (index: number, value: string) => {
    const next = draft.slice();
    next[index] = value;
    setDraft(next);
  };

  const handleRemove = (index: number) => {
    setDraft(draft.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    const unused = AVAILABLE_FIELDS.find((f) => !draft.includes(f));
    setDraft([...draft, unused ?? AVAILABLE_FIELDS[0]]);
  };

  const handleApply = () => {
    const unique: string[] = [];
    for (const f of draft) {
      if (f && !unique.includes(f)) unique.push(f);
    }
    onChange(unique);
    setOpen(false);
  };

  const handleReset = () => {
    setDraft([]);
    onChange([]);
    setOpen(false);
  };

  const isActive = fields.length > 0;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border"
        style={{
          background: isActive ? "rgba(106,13,173,0.18)" : "rgba(45,24,96,0.18)",
          borderColor: isActive ? "#6A0DAD" : "#2d1860",
          color: isActive ? "#BF40BF" : "#94a3b8",
        }}
        title="Настройка группировки"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="0.5" y="0.5" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="7.5" y="0.5" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="0.5" y="7.5" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="7.5" y="7.5" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Группировка
        {isActive && (
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold"
            style={{ background: "#6A0DAD", color: "#fff" }}
          >
            {fields.length}
          </span>
        )}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
        >
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 top-full mt-1.5 z-50 rounded-xl border shadow-2xl"
          style={{
            background: "#0d0f18",
            borderColor: "#2d1860",
            minWidth: "260px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(45,24,96,0.4)",
          }}
        >
          <div className="px-3 py-2 flex items-center justify-between border-b" style={{ borderColor: "#1a0d2e" }}>
            <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "#8b20d1" }}>
              Поля группировки
            </span>
            <span className="text-[10px]" style={{ color: "#4a3670" }}>
              {draft.length} / {AVAILABLE_FIELDS.length}
            </span>
          </div>

          <div className="p-2 space-y-1.5">
            {draft.length === 0 && (
              <div className="text-center py-3 text-xs" style={{ color: "#4a3670" }}>
                Нет полей — нажмите +
              </div>
            )}
            {draft.map((field, idx) => {
              const taken = new Set(draft.filter((_, i) => i !== idx));
              const options = AVAILABLE_FIELDS.filter((f) => !taken.has(f));
              return (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="text-[10px] w-4 text-right flex-shrink-0 select-none" style={{ color: "#4a3670" }}>
                    {idx + 1}
                  </span>
                  <select
                    value={field}
                    onChange={(e) => handleFieldChange(idx, e.target.value)}
                    className="flex-1 rounded-md px-2 py-1 text-xs font-mono appearance-none focus:outline-none transition-colors cursor-pointer"
                    style={{ background: "#161622", border: "1px solid #2d1860", color: "#BF40BF" }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "#6A0DAD"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "#2d1860"; }}
                  >
                    {options.map((opt) => (
                      <option key={opt} value={opt} style={{ background: "#0d0f18", color: "#BF40BF" }}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleRemove(idx)}
                    title="Удалить поле"
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors text-xs"
                    style={{ color: "#64748b", background: "transparent" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "#64748b"; e.currentTarget.style.background = "transparent"; }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {draft.length < AVAILABLE_FIELDS.length && (
            <div className="px-2 pb-2">
              <button
                onClick={handleAdd}
                className="w-full flex items-center justify-center gap-1.5 py-1 rounded-md text-xs transition-colors border border-dashed"
                style={{ borderColor: "#2d1860", color: "#64748b", background: "transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#6A0DAD"; e.currentTarget.style.color = "#BF40BF"; e.currentTarget.style.background = "rgba(106,13,173,0.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2d1860"; e.currentTarget.style.color = "#64748b"; e.currentTarget.style.background = "transparent"; }}
              >
                <span className="text-base leading-none mb-px">+</span>
                Добавить поле
              </button>
            </div>
          )}

          <div className="px-3 py-2 flex items-center justify-end gap-2 border-t" style={{ borderColor: "#1a0d2e" }}>
            <button
              onClick={handleReset}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{ background: "rgba(45,24,96,0.2)", border: "1px solid #2d1860", color: "#94a3b8" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.borderColor = "#7f1d1d"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.borderColor = "#2d1860"; }}
            >
              Сбросить
            </button>
            <button
              onClick={handleApply}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all"
              style={{ background: "linear-gradient(135deg, #6A0DAD, #8b20d1)", color: "#fff" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, #8b20d1, #BF40BF)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, #6A0DAD, #8b20d1)"; }}
            >
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
