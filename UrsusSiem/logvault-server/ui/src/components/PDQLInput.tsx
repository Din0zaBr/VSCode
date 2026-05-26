import { useState, useRef, useCallback, useMemo } from "react";

const PDQL_FUNCTIONS = new Set([
  "filter", "select", "sort", "limit", "group", "aggregate",
  "count", "count_distinct", "sum", "avg", "min", "max", "first", "last",
]);

const FIELD_META: { value: string; type: string; category: string; hint?: string }[] = [
  { value: "level",            type: "enum",   category: "Базовые",   hint: "DEBUG|INFO|WARNING|ERROR|CRITICAL" },
  { value: "host",             type: "string", category: "Базовые" },
  { value: "time",             type: "date",   category: "Базовые" },
  { value: "message",          type: "string", category: "Базовые" },
  { value: "text",             type: "string", category: "Базовые" },
  { value: "agent_id",         type: "string", category: "Базовые" },
  { value: "source",           type: "string", category: "Базовые" },
  { value: "service",          type: "string", category: "Базовые" },
  { value: "msgid",            type: "string", category: "Базовые" },
  { value: "src.ip",           type: "ip",     category: "Сеть" },
  { value: "src.host",         type: "string", category: "Сеть" },
  { value: "src.port",         type: "number", category: "Сеть" },
  { value: "dst.ip",           type: "ip",     category: "Сеть" },
  { value: "dst.host",         type: "string", category: "Сеть" },
  { value: "dst.port",         type: "number", category: "Сеть" },
  { value: "protocol",         type: "string", category: "Сеть",    hint: "tcp|udp|icmp|http" },
  { value: "action",           type: "string", category: "Событие" },
  { value: "status",           type: "string", category: "Событие" },
  { value: "reason",           type: "string", category: "Событие" },
  { value: "duration",         type: "number", category: "Событие" },
  { value: "subject",          type: "string", category: "Субъект" },
  { value: "subject.name",     type: "string", category: "Субъект" },
  { value: "subject.domain",   type: "string", category: "Субъект" },
  { value: "subject.type",     type: "string", category: "Субъект" },
  { value: "object",           type: "string", category: "Объект" },
  { value: "object.name",      type: "string", category: "Объект" },
  { value: "object.path",      type: "string", category: "Объект" },
  { value: "object.type",      type: "string", category: "Объект" },
  { value: "category.generic", type: "string", category: "Категория", hint: "Authentication|Attacks & Recon|..." },
  { value: "category.high",    type: "string", category: "Категория" },
  { value: "category.low",     type: "string", category: "Категория" },
  { value: "event_src.host",   type: "string", category: "Источник" },
  { value: "event_src.ip",     type: "ip",     category: "Источник" },
  { value: "event_src.vendor", type: "string", category: "Источник" },
  { value: "count",            type: "number", category: "Агрегат" },
  { value: "count.bytes",      type: "number", category: "Агрегат" },
];

const OPERATORS_BY_TYPE: Record<string, string[]> = {
  string: ["=", "!=", "contains", "startswith", "endswith", "match", "in"],
  enum:   ["=", "!=", "in"],
  ip:     ["=", "!=", "startswith", "in_subnet"],
  number: ["=", "!=", ">", "<", ">=", "<="],
  date:   ["=", ">", "<", ">=", "<="],
};

const TYPE_COLOR: Record<string, string> = {
  string: "#60a5fa", number: "#34d399", ip: "var(--accent)",
  enum: "#facc15", date: "#fb923c",
};

const EXAMPLES = [
  'filter(level = "ERROR") | sort(time desc) | limit(100)',
  'filter(level = "ERROR" and host contains "prod") | select(time, host, message)',
  'filter(src.ip startswith "10.") | sort(time desc) | limit(50)',
  'filter(message match "Failed password.*ssh") | limit(200)',
  'filter(category.generic = "Attacks & Recon") | sort(time desc)',
  'filter(level = "ERROR") | group(host) | aggregate(count(), min(time), max(time)) | sort(count desc)',
  'filter(level in ["ERROR", "CRITICAL"]) | group(agent_id) | aggregate(count()) | sort(count desc)',
];

function validatePDQL(query: string): string | null {
  if (!query.trim()) return null;
  let depth = 0, inString = false, strChar = "";
  for (const ch of query) {
    if (inString) { if (ch === strChar) inString = false; }
    else if (ch === '"' || ch === "'") { inString = true; strChar = ch; }
    else if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth < 0) return "Лишняя закрывающая скобка ')'"; }
  }
  if (depth > 0) return `Не закрыто ${depth} скобка(ок) '('`;
  const segs = query.split("|").map((s) => s.trim());
  for (const seg of segs) {
    if (!seg) return "Пустой сегмент в pipe (||)";
    const fn = seg.match(/^(\w+)\s*\(/)?.[1]?.toLowerCase();
    if (fn && !PDQL_FUNCTIONS.has(fn)) {
      const similar = [...PDQL_FUNCTIONS].filter((f) => f.startsWith(fn[0])).slice(0, 3);
      return `Неизвестная функция '${fn}'${similar.length ? `. Похожие: ${similar.join(", ")}` : ""}`;
    }
  }
  return null;
}

type SuggestionItem = {
  text: string;
  label: string;
  type?: string;
  hint?: string;
  category?: string;
};

function getSuggestions(val: string, cursorPos: number): SuggestionItem[] {
  const upToCursor = val.slice(0, cursorPos);
  const tokens = upToCursor.split(/[\s()|,=<>!]+/);
  const lastToken = tokens[tokens.length - 1]?.toLowerCase() || "";

  // Detect context: are we after a field name and operator (in value position)?
  const valueContext = /[\w.]+\s+(?:=|!=|contains|startswith|endswith|match|in)\s+"?$/.test(upToCursor);
  if (valueContext) {
    // In value context, no autocomplete suggestions (user types a value)
    return [];
  }

  // Are we immediately after an operator? Suggest values for known enum fields
  const afterFieldOp = upToCursor.match(/(level|protocol)\s*=\s*"?(\w*)$/i);
  if (afterFieldOp) {
    const field = afterFieldOp[1].toLowerCase();
    const partial = afterFieldOp[2]?.toLowerCase() ?? "";
    const enumValues: Record<string, string[]> = {
      level: ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
      protocol: ["tcp", "udp", "icmp", "http", "https", "dns"],
    };
    const vals = (enumValues[field] ?? []).filter((v) => v.toLowerCase().startsWith(partial));
    return vals.map((v) => ({ text: v, label: v, type: "value", category: "Значения" }));
  }

  const results: SuggestionItem[] = [];

  // Field suggestions
  for (const f of FIELD_META) {
    if (f.value.toLowerCase().startsWith(lastToken) && f.value !== lastToken) {
      results.push({ text: f.value, label: f.value, type: f.type, hint: f.hint, category: f.category });
    }
  }

  // Function/keyword suggestions
  const keywords = ["filter", "select", "sort", "limit", "group", "aggregate",
    "and", "or", "not", "in", "match", "contains", "startswith", "endswith",
    "in_subnet", "asc", "desc", "count", "sum", "avg", "min", "max", "first", "last"];
  for (const kw of keywords) {
    if (kw.startsWith(lastToken) && kw !== lastToken) {
      const isFunc = PDQL_FUNCTIONS.has(kw);
      results.push({ text: kw, label: kw, type: isFunc ? "func" : "kw", category: "Ключевые слова" });
    }
  }

  return results.slice(0, 10);
}

interface PDQLInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}

export default function PDQLInput({ value, onChange, onSubmit }: PDQLInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const validationError = useMemo(() => validatePDQL(value), [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      onChange(val);
      const pos = e.target.selectionStart ?? val.length;
      const sug = getSuggestions(val, pos);
      setSuggestions(sug);
      setSelectedIdx(0);
      setShowSuggestions(sug.length > 0);
    },
    [onChange],
  );

  const applySuggestion = (item: SuggestionItem) => {
    const pos = inputRef.current?.selectionStart ?? value.length;
    const upTo = value.slice(0, pos);
    const after = value.slice(pos);
    const tokens = upTo.split(/(\s+|[()|,=<>!]+)/);
    tokens[tokens.length - 1] = item.text;
    const newVal = tokens.join("") + after;
    onChange(newVal);
    setShowSuggestions(false);
    setSelectedIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && suggestions.length > 0)) {
        e.preventDefault();
        applySuggestion(suggestions[selectedIdx]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      setShowSuggestions(false);
      onSubmit();
    }
    if (e.key === "Escape") { setShowSuggestions(false); setShowExamples(false); }
  };

  const grouped = suggestions.reduce<Record<string, SuggestionItem[]>>((acc, s) => {
    const cat = s.category ?? "Прочее";
    (acc[cat] = acc[cat] ?? []).push(s);
    return acc;
  }, {});

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => !value && setShowExamples(true)}
            onBlur={() => setTimeout(() => { setShowSuggestions(false); setShowExamples(false); }, 200)}
            placeholder='filter(level = "ERROR") | sort(time desc) | limit(100)'
            rows={2}
            className="siem-input w-full font-mono text-sm focus:outline-none
                       resize-none transition-colors"
            style={{ borderColor: validationError ? "rgba(239,68,68,0.6)" : undefined }}
          />

          {/* Validation error */}
          {validationError && (
            <div
              className="flex items-center gap-1.5 mt-1 px-2 py-1 rounded text-xs"
              style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <span>⚠</span>
              <span>{validationError}</span>
            </div>
          )}

          {/* Enhanced suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              className="absolute z-20 left-0 right-0 mt-1 rounded-lg shadow-lg overflow-hidden border"
              style={{ background: "var(--surface)", borderColor: "var(--border)", maxHeight: "260px", overflowY: "auto" }}
            >
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <div
                    className="px-3 py-1 text-[9px] uppercase tracking-widest font-medium"
                    style={{ color: "var(--text-soft)", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}
                  >
                    {cat}
                  </div>
                  {items.map((s) => {
                    const globalIdx = suggestions.indexOf(s);
                    return (
                      <button
                        key={s.text}
                        onMouseDown={() => applySuggestion(s)}
                        onMouseEnter={() => setSelectedIdx(globalIdx)}
                        className="w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors"
                        style={{
                          background: globalIdx === selectedIdx ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                        }}
                      >
                        <span className="font-mono text-sm text-current flex-1 truncate">{s.label}</span>
                        {s.type && s.type !== "func" && s.type !== "kw" && s.type !== "value" && (
                          <span
                            className="text-[9px] px-1 py-0.5 rounded flex-shrink-0"
                            style={{
                              background: `${TYPE_COLOR[s.type] ?? "#94a3b8"}22`,
                              color: TYPE_COLOR[s.type] ?? "#94a3b8",
                            }}
                          >
                            {s.type}
                          </span>
                        )}
                        {s.type === "func" && (
                          <span className="text-[9px] px-1 py-0.5 rounded flex-shrink-0" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>fn</span>
                        )}
                        {s.hint && (
                          <span className="text-[9px] siem-fg-soft truncate max-w-[120px] flex-shrink-0">{s.hint}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="px-3 py-1 text-[9px]" style={{ borderTop: "1px solid var(--border)", color: "var(--text-soft)" }}>
                ↑↓ выбор · Tab/Enter применить · Esc закрыть
              </div>
            </div>
          )}

          {/* Examples dropdown */}
          {showExamples && !value && (
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg shadow-lg overflow-hidden border"
              style={{ background: "var(--surface)", borderColor: "var(--border)", maxHeight: "260px", overflowY: "auto" }}>
              <div className="px-4 py-2 text-[9px] uppercase tracking-widest" style={{ borderBottom: "1px solid var(--border)", color: "var(--text-soft)" }}>
                Примеры PDQL-запросов
              </div>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onMouseDown={() => { onChange(ex); setShowExamples(false); }}
                  className="w-full text-left px-4 py-2 text-sm font-mono hover:bg-siem-surface2 transition-colors"
                  style={{ color: "var(--accent)" }}
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onSubmit}
          className="px-6 py-2.5 bg-vault-600 hover:bg-vault-700 text-white rounded-lg
                     text-sm font-medium transition-colors self-start"
        >
          PDQL
        </button>
      </div>
    </div>
  );
}
