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
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border"
        style={{
          background: isActive ? "rgba(56,139,253,0.12)" : "transparent",
          borderColor: isActive ? "#388bfd" : "#30363d",
          color: isActive ? "#58a6ff" : "#8b949e",
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
            style={{ background: "#1f6feb", color: "#fff" }}
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
          className="absolute left-0 top-full mt-1.5 z-50 rounded-lg border shadow-2xl"
          style={{
            background: "#161b22",
            borderColor: "#30363d",
            minWidth: "260px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          <div className="px-3 py-2 flex items-center justify-between border-b" style={{ borderColor: "#21262d" }}>
            <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "#8b949e" }}>
              Поля группировки
            </span>
            <span className="text-[10px]" style={{ color: "#484f58" }}>
              {draft.length} / {AVAILABLE_FIELDS.length}
            </span>
          </div>

          <div className="p-2 space-y-1.5">
            {draft.length === 0 && (
              <div className="text-center py-3 text-xs" style={{ color: "#484f58" }}>
                Нет полей — нажмите +
              </div>
            )}
            {draft.map((field, idx) => {
              const taken = new Set(draft.filter((_, i) => i !== idx));
              const options = AVAILABLE_FIELDS.filter((f) => !taken.has(f));
              return (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="text-[10px] w-4 text-right flex-shrink-0 select-none" style={{ color: "#484f58" }}>
                    {idx + 1}
                  </span>
                  <select
                    value={field}
                    onChange={(e) => handleFieldChange(idx, e.target.value)}
                    className="flex-1 rounded-md px-2 py-1 text-xs font-mono appearance-none focus:outline-none transition-colors cursor-pointer"
                    style={{ background: "#1c2128", border: "1px solid #30363d", color: "#79c0ff" }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "#388bfd"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "#30363d"; }}
                  >
                    {options.map((opt) => (
                      <option key={opt} value={opt} style={{ background: "#161b22", color: "#e6edf3" }}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleRemove(idx)}
                    title="Удалить поле"
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors text-xs"
                    style={{ color: "#6e7681", background: "transparent" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#f85149"; e.currentTarget.style.background = "rgba(248,81,73,0.1)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "#6e7681"; e.currentTarget.style.background = "transparent"; }}
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
                style={{ borderColor: "#30363d", color: "#6e7681", background: "transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#388bfd"; e.currentTarget.style.color = "#58a6ff"; e.currentTarget.style.background = "rgba(56,139,253,0.06)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#30363d"; e.currentTarget.style.color = "#6e7681"; e.currentTarget.style.background = "transparent"; }}
              >
                <span className="text-base leading-none mb-px">+</span>
                Добавить поле
              </button>
            </div>
          )}

          <div className="px-3 py-2 flex items-center justify-end gap-2 border-t" style={{ borderColor: "#21262d" }}>
            <button
              onClick={handleReset}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{ background: "transparent", border: "1px solid #30363d", color: "#8b949e" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#f85149"; e.currentTarget.style.borderColor = "#6e1c19"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#8b949e"; e.currentTarget.style.borderColor = "#30363d"; }}
            >
              Сбросить
            </button>
            <button
              onClick={handleApply}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{ background: "#1f6feb", color: "#fff" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#388bfd"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#1f6feb"; }}
            >
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
