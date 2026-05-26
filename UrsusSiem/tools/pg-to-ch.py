#!/usr/bin/env python3
"""
Migration helper: copy the Postgres `logs` table into a ClickHouse cluster.

The Go gateway is dual-write during the migration window (Sprint 8 → Sprint 9),
so this script is only needed for the historical backfill of data that
predates the dual-write switch.

Usage:
    pip install psycopg2-binary clickhouse-driver
    PG_DSN='postgres://logvault:secret@pg:5432/logvault' \
    CH_DSN='clickhouse://default:@ch:9000/ursus' \
    python pg-to-ch.py --since 2026-01-01 --batch 10000
"""

import os, sys, time, json, argparse, datetime
from typing import Iterable

import psycopg2  # type: ignore
import psycopg2.extras  # type: ignore
from clickhouse_driver import Client  # type: ignore


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="1970-01-01",
                    help="ISO date — copy events with timestamp >= since")
    ap.add_argument("--until", default="2099-01-01")
    ap.add_argument("--batch", type=int, default=10_000)
    ap.add_argument("--dry-run", action="store_true")
    return ap.parse_args()


def iter_pg_rows(pg, since: str, until: str, batch: int) -> Iterable[list]:
    sql = """
        SELECT timestamp, event_id, host, agent_id, source, level, service,
               message, meta::text
          FROM logs
         WHERE timestamp >= %s AND timestamp < %s
         ORDER BY id
    """
    with pg.cursor(name="ursus_export", cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.itersize = batch
        cur.execute(sql, (since, until))
        chunk: list = []
        for row in cur:
            chunk.append((
                row["timestamp"], row["event_id"], row["host"], row["agent_id"],
                row["source"], row["level"], row["service"],
                row["message"], row["meta"] or "{}", "",  # ocsf empty until refill
            ))
            if len(chunk) >= batch:
                yield chunk
                chunk = []
        if chunk:
            yield chunk


def main():
    args = parse_args()

    pg_dsn = os.environ.get("PG_DSN")
    ch_dsn = os.environ.get("CH_DSN")
    if not pg_dsn or not ch_dsn:
        sys.exit("PG_DSN and CH_DSN env vars are required")

    pg = psycopg2.connect(pg_dsn)
    ch = Client.from_url(ch_dsn)

    total = 0
    start = time.time()
    insert_sql = (
        "INSERT INTO logs "
        "(timestamp, event_id, host, agent_id, source, level, service, message, meta, ocsf) "
        "VALUES"
    )

    for chunk in iter_pg_rows(pg, args.since, args.until, args.batch):
        if args.dry_run:
            total += len(chunk)
            continue
        ch.execute(insert_sql, chunk)
        total += len(chunk)
        if total % (args.batch * 10) == 0:
            elapsed = time.time() - start
            rate = total / max(elapsed, 1)
            print(f"  copied {total:>10} events  ({rate:,.0f} rows/s)")

    elapsed = time.time() - start
    print(f"\nDONE — {total:,} events copied in {elapsed:,.1f}s "
          f"({total / max(elapsed, 1):,.0f} rows/s)")


if __name__ == "__main__":
    main()
