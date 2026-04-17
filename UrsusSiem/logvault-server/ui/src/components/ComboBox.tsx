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
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs leading-none"
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
          style={{ background: "#0d1117", border: "1px solid #1a0d2e" }}
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
              className="px-3 py-1.5 text-sm cursor-pointer transition-colors text-gray-300"
              style={opt === value ? { background: "rgba(106,13,173,0.2)", color: "#BF40BF" } : undefined}
              onMouseEnter={(e) => { if (opt !== value) (e.currentTarget as HTMLLIElement).style.background = "rgba(255,255,255,0.04)"; }}
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
