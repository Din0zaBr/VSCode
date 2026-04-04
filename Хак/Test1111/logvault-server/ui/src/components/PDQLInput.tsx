import { useState, useRef, useCallback } from "react";

const PDQL_KEYWORDS = [
  "filter", "select", "sort", "limit", "group", "aggregate",
  "and", "or", "not", "in", "match", "contains", "startswith", "endswith",
  "in_subnet", "in_list", "asc", "desc",
  "count", "count_distinct", "sum", "avg", "min", "max", "first", "last",
];

const PDQL_FIELDS = [
  "time", "message", "text", "level", "agent_id", "source", "service", "host",
  "src.ip", "src.host", "src.port", "dst.ip", "dst.host", "dst.port",
  "subject", "subject.name", "subject.domain", "subject.type",
  "object", "object.name", "object.path", "object.type",
  "category.generic", "category.high", "category.low",
  "event_src.host", "event_src.ip", "event_src.vendor",
  "protocol", "action", "status", "reason", "duration",
  "count", "count.bytes", "count.bytes_in", "count.bytes_out",
  "msgid",
];

const EXAMPLES = [
  'filter(level = "ERROR") | sort(time desc) | limit(100)',
  'filter(level = "ERROR" and host contains "prod") | select(time, host, message)',
  'filter(src.ip startswith "10.") | sort(time desc) | limit(50)',
  'filter(message match "Failed password.*ssh") | limit(200)',
  'filter(category.generic = "Attacks & Recon") | sort(time desc)',
  'filter(level = "ERROR") | group(host) | aggregate(count(), min(time), max(time)) | sort(count desc)',
  'filter(level in ["ERROR", "CRITICAL"]) | group(agent_id) | aggregate(count()) | sort(count desc)',
];

interface PDQLInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}

export default function PDQLInput({ value, onChange, onSubmit }: PDQLInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      onChange(val);

      // Autocomplete
      const words = val.split(/[\s()|,=<>!]+/);
      const lastWord = words[words.length - 1]?.toLowerCase() || "";
      if (lastWord.length >= 1) {
        const allOptions = [...PDQL_KEYWORDS, ...PDQL_FIELDS];
        const matches = allOptions.filter((o) => o.startsWith(lastWord) && o !== lastWord);
        setSuggestions(matches.slice(0, 8));
        setShowSuggestions(matches.length > 0);
      } else {
        setShowSuggestions(false);
      }
    },
    [onChange],
  );

  const applySuggestion = (s: string) => {
    const words = value.split(/(\s+|[()|,=<>!]+)/);
    words[words.length - 1] = s;
    onChange(words.join(""));
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
      setShowExamples(false);
    }
  };

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
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm
                       text-green-300 font-mono placeholder-gray-600 focus:outline-none focus:border-vault-500
                       resize-none"
          />
          {/* Suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-gray-800 border border-gray-700
                            rounded-lg shadow-xl max-h-48 overflow-auto">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onMouseDown={() => applySuggestion(s)}
                  className="w-full text-left px-4 py-2 text-sm font-mono text-gray-200
                             hover:bg-gray-700 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {/* Examples dropdown */}
          {showExamples && !value && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-gray-800 border border-gray-700
                            rounded-lg shadow-xl max-h-64 overflow-auto">
              <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-700">
                Примеры PDQL-запросов
              </div>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onMouseDown={() => { onChange(ex); setShowExamples(false); }}
                  className="w-full text-left px-4 py-2 text-sm font-mono text-green-400
                             hover:bg-gray-700 transition-colors"
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
