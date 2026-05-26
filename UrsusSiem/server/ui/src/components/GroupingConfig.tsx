import { useState, useRef, useEffect } from "react";

interface GroupingConfigProps {
  fields: string[];
  onChange: (fields: string[]) => void;
  availableFields: string[];
}

export default function GroupingConfig({ fields, onChange, availableFields }: GroupingConfigProps) {
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
    const unused = availableFields.find((f) => !draft.includes(f));
    if (!unused && !availableFields.length) return;
    setDraft([...draft, unused ?? availableFields[0]]);
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
          background: isActive
            ? "color-mix(in srgb, var(--accent) 18%, transparent)"
            : "color-mix(in srgb, var(--accent-secondary) 12%, var(--surface-inset))",
          borderColor: isActive ? "var(--accent-secondary)" : "var(--border-strong)",
          color: isActive ? "var(--accent)" : "var(--text-soft)",
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
            style={{ background: "var(--accent-secondary)", color: "#fff" }}
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
            background: "var(--surface-panel)",
            borderColor: "var(--border-strong)",
            minWidth: "260px",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div className="px-3 py-2 flex items-center justify-between border-b" style={{ borderColor: "var(--border)" }}>
            <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--code-accent-2)" }}>
              Поля группировки
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-soft)" }}>
              {draft.length} / {availableFields.length}
            </span>
          </div>

          <div className="p-2 space-y-1.5">
            {draft.length === 0 && (
              <div className="text-center py-3 text-xs" style={{ color: "var(--text-soft)" }}>
                Нет полей — нажмите +
              </div>
            )}
            {draft.map((field, idx) => {
              const taken = new Set(draft.filter((_, i) => i !== idx));
              const options = availableFields.filter((f) => !taken.has(f));
              return (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="text-[10px] w-4 text-right flex-shrink-0 select-none" style={{ color: "var(--text-soft)" }}>
                    {idx + 1}
                  </span>
                  <select
                    value={field}
                    onChange={(e) => handleFieldChange(idx, e.target.value)}
                    className="flex-1 rounded-md px-2 py-1 text-xs font-mono appearance-none focus:outline-none transition-colors cursor-pointer"
                    style={{ background: "var(--surface-inset)", border: "1px solid var(--border-strong)", color: "var(--accent)" }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent-secondary)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; }}
                  >
                    {options.map((opt) => (
                      <option key={opt} value={opt} style={{ background: "var(--surface-panel)", color: "var(--accent)" }}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleRemove(idx)}
                    title="Удалить поле"
                    className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors text-xs"
                    style={{ color: "var(--text-soft)", background: "transparent" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-soft)"; e.currentTarget.style.background = "transparent"; }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {draft.length < availableFields.length && (
            <div className="px-2 pb-2">
              <button
                onClick={handleAdd}
                className="w-full flex items-center justify-center gap-1.5 py-1 rounded-md text-xs transition-colors border border-dashed"
                style={{ borderColor: "var(--border-strong)", color: "var(--text-soft)", background: "transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent-secondary)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 10%, transparent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.color = "var(--text-soft)"; e.currentTarget.style.background = "transparent"; }}
              >
                <span className="text-base leading-none mb-px">+</span>
                Добавить поле
              </button>
            </div>
          )}

          <div className="px-3 py-2 flex items-center justify-end gap-2 border-t" style={{ borderColor: "var(--border)" }}>
            <button
              onClick={handleReset}
              className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{ background: "rgba(45,24,96,0.2)", border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.borderColor = "#7f1d1d"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-soft)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
            >
              Сбросить
            </button>
            <button
              onClick={handleApply}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all"
              style={{ background: "linear-gradient(135deg, var(--accent-secondary), var(--code-accent-2))", color: "#fff" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, var(--code-accent-2), var(--accent))"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, var(--accent-secondary), var(--code-accent-2))"; }}
            >
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
