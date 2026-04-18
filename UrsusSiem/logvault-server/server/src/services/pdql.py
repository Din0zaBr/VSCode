"""
URSUS SIEM - PDQL (PT Data Query Language) Parser & SQL Translator.
Translates PDQL pipe-syntax queries into PostgreSQL SQL.

Syntax:
  filter(level = "ERROR" and host contains "prod") | select(time, host, message) | sort(time desc) | limit(100)
  filter(src.ip in_subnet "10.0.0.0/8") | group(src.ip) | aggregate(count(), count_distinct(dst.port)) | sort(count desc)
"""
from __future__ import annotations

import re
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("server.pdql")


# ── Data structures ──���───────────────────────────────────────────────────────

@dataclass
class Predicate:
    field: str
    operator: str
    value: Any


@dataclass
class FilterNode:
    """AST node for filter expressions."""
    type: str = "predicate"  # "predicate", "and", "or", "not"
    predicate: Predicate | None = None
    children: list["FilterNode"] = field(default_factory=list)


@dataclass
class SortItem:
    field: str
    direction: str = "desc"


@dataclass
class AggregateFunc:
    func: str  # count, count_distinct, sum, avg, min, max, first, last
    field: str = ""  # empty for count()


@dataclass
class PDQLQuery:
    filter_node: FilterNode | None = None
    select_fields: list[str] = field(default_factory=list)
    sort_items: list[SortItem] = field(default_factory=list)
    limit_value: int | None = None
    group_fields: list[str] = field(default_factory=list)
    aggregates: list[AggregateFunc] = field(default_factory=list)


# ── Tokenizer ────────────────────────────────────────��───────────────────────

_TOKEN_RE = re.compile(
    r"""
    (?P<STRING>"[^"]*"|'[^']*')        |
    (?P<NUMBER>\d+(?:\.\d+)?)           |
    (?P<OP>>=|<=|!=|==|[=<>])          |
    (?P<COMMA>,)                        |
    (?P<LPAREN>\()                      |
    (?P<RPAREN>\))                      |
    (?P<PIPE>\|)                        |
    (?P<LBRACKET>\[)                    |
    (?P<RBRACKET>\])                    |
    (?P<WORD>[a-zA-Z_][\w.]*)           |
    (?P<WS>\s+)
    """,
    re.VERBOSE,
)


@dataclass
class Token:
    type: str
    value: str


def _tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    pos = 0
    for m in _TOKEN_RE.finditer(text):
        if m.start() != pos:
            skipped = text[pos:m.start()]
            if skipped.strip():
                raise PDQLParseError(f"Unexpected token: {skipped.strip()}")
        kind = m.lastgroup
        val = m.group()
        if kind == "WS":
            pos = m.end()
            continue
        if kind == "STRING":
            val = val[1:-1]
            kind = "STRING"
        elif kind == "WORD":
            upper = val.upper()
            if upper in ("AND", "OR", "NOT", "IN", "MATCH", "CONTAINS",
                         "STARTSWITH", "ENDSWITH", "IN_SUBNET", "IN_LIST",
                         "FILTER", "SELECT", "SORT", "LIMIT", "GROUP",
                         "AGGREGATE", "ASC", "DESC",
                         "COUNT", "COUNT_DISTINCT", "SUM", "AVG",
                         "MIN", "MAX", "FIRST", "LAST"):
                kind = "KEYWORD"
                val = upper
            else:
                kind = "FIELD"
        tokens.append(Token(type=kind, value=val))
        pos = m.end()
    if pos != len(text):
        skipped = text[pos:]
        if skipped.strip():
            raise PDQLParseError(f"Unexpected token: {skipped.strip()}")
    return tokens


# ── Parser ───────────────────────────────────────────────────────────────────

class PDQLParseError(Exception):
    pass


class PDQLParser:
    """Parses PDQL query string into PDQLQuery structure."""

    def parse(self, query: str) -> PDQLQuery:
        query = query.strip()
        if not query:
            return PDQLQuery()

        result = PDQLQuery()
        # Split by top-level pipes (not inside parentheses)
        commands = self._split_pipes(query)

        for cmd in commands:
            cmd = cmd.strip()
            if not cmd:
                continue
            upper = cmd.upper()
            if upper.startswith("FILTER"):
                body = self._extract_body(cmd, "FILTER")
                result.filter_node = self._parse_filter(body)
            elif upper.startswith("WHERE"):
                # Channel / UI synonym for FILTER (PT PDQL-style)
                body = self._extract_body(cmd, "WHERE")
                result.filter_node = self._parse_filter(body)
            elif upper.startswith("SELECT"):
                body = self._extract_body(cmd, "SELECT")
                result.select_fields = [f.strip() for f in body.split(",")]
            elif upper.startswith("SORT"):
                body = self._extract_body(cmd, "SORT")
                result.sort_items = self._parse_sort(body)
            elif upper.startswith("LIMIT"):
                body = self._extract_body(cmd, "LIMIT")
                result.limit_value = int(body.strip())
            elif upper.startswith("GROUP"):
                body = self._extract_body(cmd, "GROUP")
                result.group_fields = [f.strip() for f in body.split(",")]
            elif upper.startswith("AGGREGATE"):
                body = self._extract_body(cmd, "AGGREGATE")
                result.aggregates = self._parse_aggregates(body)
            else:
                raise PDQLParseError(f"Unknown command: {cmd[:30]}")

        return result

    def _split_pipes(self, query: str) -> list[str]:
        """Split by | respecting parentheses, lists and quoted strings."""
        parts: list[str] = []
        depth = 0
        quote: str | None = None
        current: list[str] = []
        for ch in query:
            if quote:
                if ch == quote:
                    quote = None
            elif ch in ("'", '"'):
                quote = ch
            elif ch in ("(", "["):
                depth += 1
            elif ch in (")", "]"):
                depth -= 1
            elif ch == "|" and depth == 0:
                parts.append("".join(current))
                current = []
                continue
            current.append(ch)
        if current:
            parts.append("".join(current))
        return parts

    def _extract_body(self, cmd: str, keyword: str) -> str:
        """Extract content inside command(...)."""
        idx = cmd.upper().index(keyword) + len(keyword)
        rest = cmd[idx:].strip()
        if rest.startswith("(") and rest.endswith(")"):
            return rest[1:-1]
        return rest

    def _parse_filter(self, body: str) -> FilterNode:
        tokens = _tokenize(body)
        node, pos = self._parse_or(tokens, 0)
        if pos != len(tokens):
            raise PDQLParseError(f"Unexpected token: {tokens[pos].value}")
        return node

    def _parse_or(self, tokens: list[Token], pos: int) -> tuple[FilterNode, int]:
        left, pos = self._parse_and(tokens, pos)
        while pos < len(tokens) and tokens[pos].type == "KEYWORD" and tokens[pos].value == "OR":
            pos += 1
            right, pos = self._parse_and(tokens, pos)
            left = FilterNode(type="or", children=[left, right])
        return left, pos

    def _parse_and(self, tokens: list[Token], pos: int) -> tuple[FilterNode, int]:
        left, pos = self._parse_not(tokens, pos)
        while pos < len(tokens) and tokens[pos].type == "KEYWORD" and tokens[pos].value == "AND":
            pos += 1
            right, pos = self._parse_not(tokens, pos)
            left = FilterNode(type="and", children=[left, right])
        return left, pos

    def _parse_not(self, tokens: list[Token], pos: int) -> tuple[FilterNode, int]:
        if pos < len(tokens) and tokens[pos].type == "KEYWORD" and tokens[pos].value == "NOT":
            pos += 1
            child, pos = self._parse_atom(tokens, pos)
            return FilterNode(type="not", children=[child]), pos
        return self._parse_atom(tokens, pos)

    def _parse_atom(self, tokens: list[Token], pos: int) -> tuple[FilterNode, int]:
        if pos >= len(tokens):
            raise PDQLParseError("Unexpected end of filter expression")

        # Parenthesized sub-expression
        if tokens[pos].type == "LPAREN":
            pos += 1
            node, pos = self._parse_or(tokens, pos)
            if pos < len(tokens) and tokens[pos].type == "RPAREN":
                pos += 1
            return node, pos

        # Function-style: match(field, "pattern"), in_subnet(field, "cidr"), in_list([...], field)
        if tokens[pos].type == "KEYWORD" and tokens[pos].value in ("MATCH", "IN_SUBNET", "IN_LIST"):
            func = tokens[pos].value
            pos += 1
            if pos < len(tokens) and tokens[pos].type == "LPAREN":
                pos += 1
            args: list[str] = []
            while pos < len(tokens) and tokens[pos].type != "RPAREN":
                if tokens[pos].type == "COMMA":
                    pos += 1
                    continue
                args.append(tokens[pos].value)
                pos += 1
            if pos < len(tokens) and tokens[pos].type == "RPAREN":
                pos += 1
            if func == "MATCH" and len(args) >= 2:
                return FilterNode(type="predicate", predicate=Predicate(field=args[0], operator="MATCH", value=args[1])), pos
            if func == "IN_SUBNET" and len(args) >= 2:
                return FilterNode(type="predicate", predicate=Predicate(field=args[0], operator="IN_SUBNET", value=args[1])), pos
            if func == "IN_LIST" and len(args) >= 2:
                return FilterNode(type="predicate", predicate=Predicate(field=args[-1], operator="IN", value=args[:-1])), pos

        # field operator value
        if tokens[pos].type == "FIELD":
            fld = tokens[pos].value
            pos += 1
            if pos >= len(tokens):
                raise PDQLParseError(f"Expected operator after field '{fld}'")
            op_token = tokens[pos]
            pos += 1

            if op_token.type == "OP":
                op = op_token.value
            elif op_token.type == "KEYWORD":
                op = op_token.value
            else:
                raise PDQLParseError(f"Expected operator, got '{op_token.value}'")

            # IN [val1, val2, ...] and IN (val1, val2, ...)
            if op == "IN" and pos < len(tokens) and tokens[pos].type in ("LBRACKET", "LPAREN"):
                close_type = "RBRACKET" if tokens[pos].type == "LBRACKET" else "RPAREN"
                pos += 1
                values: list[str] = []
                while pos < len(tokens) and tokens[pos].type != close_type:
                    if tokens[pos].type == "COMMA":
                        pos += 1
                        continue
                    values.append(tokens[pos].value)
                    pos += 1
                if pos < len(tokens) and tokens[pos].type == close_type:
                    pos += 1
                return FilterNode(type="predicate", predicate=Predicate(field=fld, operator="IN", value=values)), pos

            # Single value
            if pos >= len(tokens):
                raise PDQLParseError(f"Expected value after operator '{op}'")
            val = tokens[pos].value
            pos += 1
            return FilterNode(type="predicate", predicate=Predicate(field=fld, operator=op, value=val)), pos

        raise PDQLParseError(f"Unexpected token: {tokens[pos].value}")

    def _parse_sort(self, body: str) -> list[SortItem]:
        items: list[SortItem] = []
        for part in body.split(","):
            parts = part.strip().split()
            fld = parts[0]
            direction = parts[1].lower() if len(parts) > 1 else "desc"
            items.append(SortItem(field=fld, direction=direction))
        return items

    def _parse_aggregates(self, body: str) -> list[AggregateFunc]:
        aggs: list[AggregateFunc] = []
        depth = 0
        current: list[str] = []
        for ch in body:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if ch == "," and depth == 0:
                aggs.append(self._parse_one_agg("".join(current).strip()))
                current = []
                continue
            current.append(ch)
        if current:
            aggs.append(self._parse_one_agg("".join(current).strip()))
        return aggs

    def _parse_one_agg(self, text: str) -> AggregateFunc:
        m = re.match(r"(\w+)\(([^)]*)\)", text.strip())
        if not m:
            raise PDQLParseError(f"Invalid aggregate: {text}")
        func = m.group(1).lower()
        arg = m.group(2).strip()
        return AggregateFunc(func=func, field=arg)


# ── SQL Translator ───���───────────────────────────────────────────────────────

class PDQLToSQL:
    """Translates PDQLQuery into PostgreSQL SQL."""

    @staticmethod
    def _coalesce_text(*exprs: str) -> str:
        """SQL: COALESCE(NULLIF(e1,''), NULLIF(e2,''), ...)."""
        cleaned = [f"NULLIF({e}, '')" for e in exprs if e]
        if not cleaned:
            return "''"
        if len(cleaned) == 1:
            return cleaned[0]
        return f"COALESCE({', '.join(cleaned)})"

    DIRECT_FIELDS: dict[str, str] = {
        "id": "l.id",
        "time": "l.timestamp",
        "event_id": "l.event_id",
        "text": "l.message",
        "message": "l.message",
        "level": "l.level",
        "agent_id": "l.agent_id",
        "source": "l.source",
        "service": "s.name",
        "event_src.host": "l.host",
        "host": "l.host",
        # часто в enrich — дублируем явно для group/filter
        "event_type": "l.meta->>'event_type'",
    }

    # Explicit field aliases with fallbacks (flat key, nested JSON, legacy underscore keys).
    # This keeps PDQL stable even if meta schema varies between sources.
    ALIAS_FIELDS: dict[str, str] = {
        # ── event_src.* ──────────────────────────────────────────────────
        "event_src.vendor": _coalesce_text.__func__(
            "l.meta->>'event_src.vendor'",
            "l.meta->'event_src'->>'vendor'",
            "l.meta->>'event_src_vendor'",
        ),
        "event_src.title": _coalesce_text.__func__(
            "l.meta->>'event_src.title'",
            "l.meta->'event_src'->>'title'",
            "l.meta->>'event_src_title'",
        ),
        "event_src.subsys": _coalesce_text.__func__(
            "l.meta->>'event_src.subsys'",
            "l.meta->'event_src'->>'subsys'",
            "l.meta->>'event_src_subsys'",
        ),
        "event_src.category": _coalesce_text.__func__(
            "l.meta->>'event_src.category'",
            "l.meta->'event_src'->>'category'",
            "l.meta->>'event_src_category'",
        ),
        # host is stored in column, but some sources also put it in meta
        "event_src.host": _coalesce_text.__func__(
            "l.host",
            "l.meta->>'event_src.host'",
            "l.meta->'event_src'->>'host'",
        ),
        "event_src.ip": _coalesce_text.__func__(
            "l.meta->>'event_src.ip'",
            "l.meta->'event_src'->>'ip'",
            "l.meta->>'event_src_ip'",
        ),

        # ── src.* / dst.* (often flat keys) ─────────────────────────────
        "src.ip": _coalesce_text.__func__(
            "l.meta->>'src.ip'",
            "l.meta->'src'->>'ip'",
            "l.meta->>'src_ip'",
        ),
        "dst.ip": _coalesce_text.__func__(
            "l.meta->>'dst.ip'",
            "l.meta->'dst'->>'ip'",
            "l.meta->>'dst_ip'",
        ),
        "src.host": _coalesce_text.__func__(
            "l.meta->>'src.host'",
            "l.meta->'src'->>'host'",
            "l.meta->>'src_host'",
        ),
        "dst.host": _coalesce_text.__func__(
            "l.meta->>'dst.host'",
            "l.meta->'dst'->>'host'",
            "l.meta->>'dst_host'",
        ),
        "src.port": _coalesce_text.__func__(
            "l.meta->>'src.port'",
            "l.meta->'src'->>'port'",
            "l.meta->>'src_port'",
        ),
        "dst.port": _coalesce_text.__func__(
            "l.meta->>'dst.port'",
            "l.meta->'dst'->>'port'",
            "l.meta->>'dst_port'",
        ),

        # ── category.* (parser stores meta.category.{generic,high,low}) ──
        "category.generic": _coalesce_text.__func__(
            "l.meta->>'category.generic'",
            "l.meta->'category'->>'generic'",
        ),
        "category.high": _coalesce_text.__func__(
            "l.meta->>'category.high'",
            "l.meta->'category'->>'high'",
        ),
        "category.low": _coalesce_text.__func__(
            "l.meta->>'category.low'",
            "l.meta->'category'->>'low'",
        ),

        # ── subject.* / object.* (flat keys in enrichment) ──────────────
        "subject.process.id": _coalesce_text.__func__(
            "l.meta->>'subject.process.id'",
            "l.meta->'subject'->'process'->>'id'",
        ),
        "subject.process.parent.id": _coalesce_text.__func__(
            "l.meta->>'subject.process.parent.id'",
            "l.meta->'subject'->'process'->'parent'->>'id'",
        ),
        "subject.account.id": _coalesce_text.__func__(
            "l.meta->>'subject.account.id'",
            "l.meta->'subject'->'account'->>'id'",
        ),
        "object.path": _coalesce_text.__func__(
            "l.meta->>'object.path'",
            "l.meta->'object'->>'path'",
        ),
        "object.process.id": _coalesce_text.__func__(
            "l.meta->>'object.process.id'",
            "l.meta->'object'->'process'->>'id'",
        ),
    }

    NUMERIC_FIELDS: dict[str, str] = {
        "id": "bigint",
        "event_id_raw": "bigint",
        "record_number": "bigint",
        "src.port": "int",
        "dst.port": "int",
        "count": "int",
        "count.bytes": "bigint",
        "count.bytes_in": "bigint",
        "count.bytes_out": "bigint",
        "duration": "numeric",
    }

    def field_to_sql(self, fld: str) -> str:
        if fld in self.DIRECT_FIELDS:
            return self.DIRECT_FIELDS[fld]
        if fld in self.ALIAS_FIELDS:
            return self.ALIAS_FIELDS[fld]
        parts = fld.split(".")
        if len(parts) == 1:
            return f"l.meta->>'{parts[0]}'"
        flat_key = f"l.meta->>'{fld}'"
        underscore_key = f"l.meta->>'{fld.replace('.', '_')}'"
        path = "l.meta"
        for p in parts[:-1]:
            path += f"->'{p}'"
        path += f"->>'{parts[-1]}'"
        if fld in self.NUMERIC_FIELDS:
            return f"(COALESCE(NULLIF({flat_key}, ''), NULLIF({underscore_key}, ''), {path}))::{self.NUMERIC_FIELDS[fld]}"
        return f"COALESCE(NULLIF({flat_key}, ''), NULLIF({underscore_key}, ''), {path})"

    def translate(
        self,
        query: PDQLQuery,
        allowed_agents: list[str] | None = None,
        time_from: str | None = None,
        time_to: str | None = None,
        omit_default_limit: bool = False,
    ) -> tuple[str, list[Any]]:
        params: list[Any] = []
        conditions: list[str] = []

        # Agent access control
        if allowed_agents is not None:
            if not allowed_agents:
                return "SELECT 0 WHERE FALSE", []
            conditions.append("l.agent_id = ANY(%s)")
            params.append(allowed_agents)

        # Time window (ISO timestamps from API)
        if time_from:
            conditions.append("l.timestamp >= %s")
            params.append(time_from)
        if time_to:
            conditions.append("l.timestamp <= %s")
            params.append(time_to)

        # Filter
        if query.filter_node:
            where_sql, where_params = self._translate_filter(query.filter_node)
            if where_sql:
                conditions.append(where_sql)
                params.extend(where_params)

        where = " AND ".join(conditions) if conditions else "TRUE"

        # GROUP BY + aggregation mode
        if query.group_fields:
            return self._translate_grouped(query, where, params)

        # Normal select mode
        select_cols = self._build_select(query.select_fields)
        sort_clause = self._build_sort(query.sort_items)
        if query.limit_value:
            limit_clause = f"LIMIT {query.limit_value}"
        elif omit_default_limit:
            limit_clause = ""
        else:
            limit_clause = "LIMIT 500"

        lines = [
            f"SELECT {select_cols}",
            "FROM logs l LEFT JOIN services s ON l.service_id = s.id",
            f"WHERE {where}",
            sort_clause,
        ]
        if limit_clause:
            lines.append(limit_clause)
        sql = "\n".join(lines)

        return sql, params

    def _translate_grouped(
        self, query: PDQLQuery, where: str, params: list[Any]
    ) -> tuple[str, list[Any]]:
        group_sql = ", ".join(self.field_to_sql(f) for f in query.group_fields)
        group_aliases = ", ".join(
            f'{self.field_to_sql(f)} AS "{f}"' for f in query.group_fields
        )

        agg_parts: list[str] = []
        for agg in query.aggregates:
            agg_parts.append(self._translate_agg(agg))
        if not agg_parts:
            agg_parts.append("COUNT(*) AS \"count\"")

        select_parts = f"{group_aliases}, {', '.join(agg_parts)}"
        sort_clause = self._build_sort(query.sort_items)
        limit_clause = f"LIMIT {query.limit_value}" if query.limit_value else "LIMIT 500"

        sql = f"""SELECT {select_parts}
FROM logs l LEFT JOIN services s ON l.service_id = s.id
WHERE {where}
GROUP BY {group_sql}
{sort_clause}
{limit_clause}"""

        return sql, params

    def _translate_agg(self, agg: AggregateFunc) -> str:
        if agg.func == "count" and not agg.field:
            return 'COUNT(*) AS "count"'
        if agg.func == "count_distinct":
            sql_field = self.field_to_sql(agg.field)
            return f'COUNT(DISTINCT {sql_field}) AS "count_distinct_{agg.field.replace(".", "_")}"'
        if agg.func in ("sum", "avg", "min", "max"):
            sql_field = self.field_to_sql(agg.field)
            return f'{agg.func.upper()}({sql_field}) AS "{agg.func}_{agg.field.replace(".", "_")}"'
        if agg.func == "first":
            sql_field = self.field_to_sql(agg.field)
            return f'(ARRAY_AGG({sql_field} ORDER BY l.timestamp ASC))[1] AS "first_{agg.field.replace(".", "_")}"'
        if agg.func == "last":
            sql_field = self.field_to_sql(agg.field)
            return f'(ARRAY_AGG({sql_field} ORDER BY l.timestamp DESC))[1] AS "last_{agg.field.replace(".", "_")}"'
        return f'COUNT(*) AS "count"'

    def _build_select(self, fields: list[str]) -> str:
        if not fields:
            return """l.event_id, l.timestamp, l.host, l.agent_id, l.source,
                      l.level, l.message, COALESCE(s.name, '') AS service, l.meta"""
        parts: list[str] = []
        for f in fields:
            sql_f = self.field_to_sql(f)
            parts.append(f'{sql_f} AS "{f}"')
        return ", ".join(parts)

    def _build_sort(self, items: list[SortItem]) -> str:
        if not items:
            return "ORDER BY l.timestamp DESC"
        parts: list[str] = []
        for si in items:
            # Handle aggregation aliases
            if si.field in ("count",):
                parts.append(f'"{si.field}" {si.direction.upper()}')
            elif si.field.startswith("count_distinct_") or si.field.startswith("sum_") or si.field.startswith("avg_"):
                parts.append(f'"{si.field}" {si.direction.upper()}')
            else:
                sql_f = self.field_to_sql(si.field)
                parts.append(f"{sql_f} {si.direction.upper()}")
        return "ORDER BY " + ", ".join(parts)

    def _translate_filter(self, node: FilterNode) -> tuple[str, list[Any]]:
        if node.type == "predicate" and node.predicate:
            return self._translate_predicate(node.predicate)
        if node.type == "and":
            parts, params = [], []
            for child in node.children:
                s, p = self._translate_filter(child)
                parts.append(f"({s})")
                params.extend(p)
            return " AND ".join(parts), params
        if node.type == "or":
            parts, params = [], []
            for child in node.children:
                s, p = self._translate_filter(child)
                parts.append(f"({s})")
                params.extend(p)
            return " OR ".join(parts), params
        if node.type == "not" and node.children:
            s, p = self._translate_filter(node.children[0])
            return f"NOT ({s})", p
        return "TRUE", []

    def _translate_predicate(self, pred: Predicate) -> tuple[str, list[Any]]:
        sql_field = self.field_to_sql(pred.field)
        op = pred.operator.upper()

        if op in ("=", "=="):
            return f"{sql_field} = %s", [pred.value]
        if op in ("!=", "<>"):
            return f"{sql_field} != %s", [pred.value]
        if op in (">", "<", ">=", "<="):
            return f"{sql_field} {op} %s", [pred.value]
        if op == "CONTAINS":
            return f"{sql_field} ILIKE %s", [f"%{pred.value}%"]
        if op == "STARTSWITH":
            return f"{sql_field} LIKE %s", [f"{pred.value}%"]
        if op == "ENDSWITH":
            return f"{sql_field} LIKE %s", [f"%{pred.value}"]
        if op == "MATCH":
            return f"{sql_field} ~* %s", [pred.value]
        if op == "IN":
            if isinstance(pred.value, list):
                return f"{sql_field} = ANY(%s)", [pred.value]
            return f"{sql_field} = ANY(%s)", [[pred.value]]
        if op == "IN_SUBNET":
            return f"{sql_field}::inet <<= %s::inet", [pred.value]

        return f"{sql_field} = %s", [pred.value]

