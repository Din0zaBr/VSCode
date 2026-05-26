export interface VisualCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
  logic: "AND" | "OR";
}

export interface VisualQuery {
  conditions: VisualCondition[];
  sortField: string;
  sortDir: "asc" | "desc";
  limit: number;
}

export function conditionToPDQL(c: VisualCondition): string {
  const { field, operator, value } = c;
  if (!value.trim()) return "";

  if (operator === "in") {
    const vals = value.split(",").map((v) => `"${v.trim()}"`).join(", ");
    return `${field} in [${vals}]`;
  }
  if (["contains", "startswith", "endswith", "match", "in_subnet"].includes(operator)) {
    return `${field} ${operator} "${value}"`;
  }
  if (!isNaN(Number(value))) {
    return `${field} ${operator} ${value}`;
  }
  return `${field} ${operator} "${value}"`;
}

export function toPDQL(query: VisualQuery): string {
  const parts: string[] = [];
  const { conditions, sortField, sortDir, limit } = query;

  const condParts: string[] = [];
  conditions.forEach((c, i) => {
    const expr = conditionToPDQL(c);
    if (!expr) return;
    if (condParts.length === 0) {
      condParts.push(expr);
    } else {
      condParts.push(`${c.logic.toLowerCase()} ${expr}`);
    }
  });

  if (condParts.length > 0) {
    parts.push(`filter(${condParts.join(" ")})`);
  }
  parts.push(`sort(${sortField} ${sortDir})`);
  parts.push(`limit(${limit})`);

  return parts.join(" | ");
}

/** Attempt to parse a simple filter() PDQL string back into conditions. */
export function fromPDQL(pdql: string): Partial<VisualQuery> {
  const result: Partial<VisualQuery> = {
    conditions: [],
    sortField: "time",
    sortDir: "desc",
    limit: 100,
  };

  // Extract sort
  const sortMatch = pdql.match(/sort\((\w+)\s+(asc|desc)\)/i);
  if (sortMatch) {
    result.sortField = sortMatch[1];
    result.sortDir = sortMatch[2].toLowerCase() as "asc" | "desc";
  }

  // Extract limit
  const limitMatch = pdql.match(/limit\((\d+)\)/i);
  if (limitMatch) {
    result.limit = parseInt(limitMatch[1], 10);
  }

  // Extract filter conditions (basic parser for single-level conditions)
  const filterMatch = pdql.match(/filter\(([^)]+)\)/i);
  if (filterMatch) {
    const inner = filterMatch[1];
    const condRegex = /(\w[\w.]*)\s*(=|!=|>=|<=|>|<|contains|startswith|endswith|match|in_subnet|in)\s*"?([^"]+)"?/gi;
    let match;
    let first = true;
    let logic: "AND" | "OR" = "AND";
    const conditions: VisualCondition[] = [];

    while ((match = condRegex.exec(inner)) !== null) {
      const before = inner.slice(0, match.index).toLowerCase();
      if (before.endsWith("or ")) logic = "OR";
      else if (before.endsWith("and ")) logic = "AND";

      conditions.push({
        id: `c${conditions.length + 1}`,
        field: match[1],
        operator: match[2].toLowerCase(),
        value: match[3].trim(),
        logic: first ? "AND" : logic,
      });
      first = false;
    }

    result.conditions = conditions;
  }

  return result;
}
