const PDQL_FUNCTIONS = new Set([
  "filter", "select", "sort", "limit", "group", "aggregate",
  "count", "count_distinct", "sum", "avg", "min", "max", "first", "last",
]);

const KNOWN_FIELDS = new Set([
  "level", "host", "time", "message", "text", "agent_id", "source", "service", "msgid",
  "src.ip", "src.host", "src.port", "dst.ip", "dst.host", "dst.port", "protocol",
  "action", "status", "reason", "duration",
  "subject", "subject.name", "subject.domain", "subject.type",
  "object", "object.name", "object.path", "object.type",
  "category.generic", "category.high", "category.low",
  "event_src.host", "event_src.ip", "event_src.vendor",
  "count", "count.bytes",
]);

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

export function validatePDQL(query: string): ValidationResult {
  if (!query.trim()) return { valid: true, error: null };

  // Check balanced parentheses
  let depth = 0;
  let inString = false;
  let strChar = "";
  for (const ch of query) {
    if (inString) {
      if (ch === strChar) inString = false;
    } else if (ch === '"' || ch === "'") {
      inString = true;
      strChar = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth < 0) return { valid: false, error: "Лишняя закрывающая скобка ')'" };
    }
  }
  if (depth > 0) return { valid: false, error: `Не закрыто ${depth} скобка(ок) '('` };

  // Check pipe segments
  const segments = query.split("|").map((s) => s.trim());
  for (const seg of segments) {
    if (!seg) return { valid: false, error: "Пустой сегмент в pipe (||)" };
    const fn = seg.match(/^(\w+)\s*\(/)?.[1]?.toLowerCase();
    if (fn && !PDQL_FUNCTIONS.has(fn)) {
      const similar = [...PDQL_FUNCTIONS].filter((f) => f.startsWith(fn[0])).slice(0, 3);
      return {
        valid: false,
        error: `Неизвестная функция '${fn}'${similar.length ? `. Похожие: ${similar.join(", ")}` : ""}`,
      };
    }
  }

  return { valid: true, error: null };
}

export function suggestFields(partial: string): string[] {
  if (!partial) return [];
  const lower = partial.toLowerCase();
  return [...KNOWN_FIELDS].filter((f) => f.startsWith(lower) && f !== lower).slice(0, 8);
}

export function isKnownField(field: string): boolean {
  return KNOWN_FIELDS.has(field);
}
