import { useState, useRef, useEffect, useId } from "react";

interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

export default function ComboBox({ value, onChange, options, placeholder, className }: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = value
    ? options.filter((o) => o.toLowerCase().includes(value.toLowerCase()))
    : options;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const showList = open && filtered.length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        className={`siem-input ${className ?? ""}`}
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(""); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 siem-fg-soft hover:text-[color:var(--text-muted)] text-xs leading-none"
          tabIndex={-1}
          aria-label="Clear"
        >
          &times;
        </button>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-auto rounded-lg shadow-xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)" }}
        >
          {filtered.map((opt) => (
            <li
              key={opt}
              role="option"
              aria-selected={opt === value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setOpen(false);
              }}
              className="px-3 py-1.5 text-sm cursor-pointer transition-colors siem-fg"
              style={opt === value ? { background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent-secondary)" } : undefined}
              onMouseEnter={(e) => { if (opt !== value) (e.currentTarget as HTMLLIElement).style.background = "color-mix(in srgb, var(--accent) 8%, var(--surface-2))"; }}
              onMouseLeave={(e) => { if (opt !== value) (e.currentTarget as HTMLLIElement).style.background = ""; }}
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
