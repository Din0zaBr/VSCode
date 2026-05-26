"""
Ursus Insight SIEM - Statistical Analyzer
Provides time-series data, anomaly scoring, and chart generation.
"""
import io
import time
import logging
import threading
from collections import defaultdict, Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import FancyBboxPatch

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config
from core import database

logger = logging.getLogger("ursus.analyzer")

# ── Color palette ─────────────────────────────────────────────────────────────
PALETTE = {
    "bg":       "#1A1A2E",
    "bg2":      "#16213E",
    "primary":  "#6A0DAD",
    "accent":   "#BF40BF",
    "slate":    "#2F4F4F",
    "critical": "#FF3131",
    "high":     "#FF6B00",
    "medium":   "#FFD700",
    "low":      "#00BFFF",
    "info":     "#888888",
    "text":     "#E0E0E0",
    "grid":     "#2A2A4A",
}


def _apply_cyberpunk_style(fig, ax_list=None):
    fig.patch.set_facecolor(PALETTE["bg"])
    if ax_list is None:
        ax_list = fig.get_axes()
    for ax in ax_list:
        ax.set_facecolor(PALETTE["bg2"])
        ax.tick_params(colors=PALETTE["text"], labelsize=9)
        ax.spines["bottom"].set_color(PALETTE["grid"])
        ax.spines["top"].set_color(PALETTE["grid"])
        ax.spines["left"].set_color(PALETTE["grid"])
        ax.spines["right"].set_color(PALETTE["grid"])
        ax.title.set_color(PALETTE["accent"])
        if ax.xaxis.get_label():
            ax.xaxis.label.set_color(PALETTE["text"])
        if ax.yaxis.get_label():
            ax.yaxis.label.set_color(PALETTE["text"])
        ax.grid(True, color=PALETTE["grid"], linestyle="--", alpha=0.5, linewidth=0.5)


SEV_COLORS = {
    "CRITICAL": PALETTE["critical"],
    "HIGH":     PALETTE["high"],
    "MEDIUM":   PALETTE["medium"],
    "LOW":      PALETTE["low"],
    "INFO":     PALETTE["info"],
}

SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]


def _fig_to_bytes(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=110,
                facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    return buf.read()


# ── Chart: Events timeline (stacked area) ────────────────────────────────────

def chart_events_timeline(hours: int = 24) -> bytes:
    raw = database.get_events_by_hour(hours=hours)

    # Build hourly buckets
    buckets: dict[str, dict[str, int]] = defaultdict(lambda: {s: 0 for s in SEVERITIES})
    for row in raw:
        buckets[row["hour"]][row["severity"]] += row["cnt"]

    # Create sorted hour list
    if not buckets:
        hours_list = []
    else:
        all_hours = sorted(buckets.keys())
        hours_list = all_hours

    fig, ax = plt.subplots(figsize=(10, 3.5))
    _apply_cyberpunk_style(fig, [ax])

    if hours_list:
        x = [datetime.fromisoformat(h) for h in hours_list]
        bottoms = np.zeros(len(x))

        for sev in ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]:
            vals = np.array([buckets[h].get(sev, 0) for h in hours_list], dtype=float)
            ax.fill_between(x, bottoms, bottoms + vals,
                            color=SEV_COLORS[sev], alpha=0.75, label=sev, step="mid")
            ax.step(x, bottoms + vals, color=SEV_COLORS[sev], linewidth=0.8, where="mid")
            bottoms += vals

        ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
        ax.xaxis.set_major_locator(mdates.AutoDateLocator())
        fig.autofmt_xdate(rotation=30)

    ax.set_title(f"Events — Last {hours}h", fontsize=12, pad=8)
    ax.legend(loc="upper left", fontsize=8,
              facecolor=PALETTE["bg"], edgecolor=PALETTE["primary"],
              labelcolor=PALETTE["text"])
    ax.set_ylabel("Count", fontsize=9)

    return _fig_to_bytes(fig)


# ── Chart: Severity donut ─────────────────────────────────────────────────────

def chart_severity_donut(hours: int = 24) -> bytes:
    since = time.time() - hours * 3600
    dist = database.get_category_distribution(since=since)

    # Severity distribution
    from core.database import get_conn
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT severity, COUNT(*) as cnt FROM events
               WHERE timestamp>=? GROUP BY severity""",
            (since,)
        ).fetchall()

    labels, values, colors = [], [], []
    for row in rows:
        sev = row["severity"]
        if row["cnt"] > 0:
            labels.append(sev)
            values.append(row["cnt"])
            colors.append(SEV_COLORS.get(sev, PALETTE["info"]))

    fig, ax = plt.subplots(figsize=(4.5, 4.5))
    _apply_cyberpunk_style(fig, [ax])
    ax.set_facecolor(PALETTE["bg"])

    if values:
        wedges, texts, autotexts = ax.pie(
            values, labels=labels, colors=colors,
            autopct="%1.0f%%", startangle=90,
            wedgeprops={"linewidth": 2, "edgecolor": PALETTE["bg"]},
            pctdistance=0.8
        )
        for t in texts:
            t.set_color(PALETTE["text"]); t.set_fontsize(9)
        for at in autotexts:
            at.set_color(PALETTE["bg"]); at.set_fontsize(8); at.set_fontweight("bold")
        # Make it a donut
        centre_circle = plt.Circle((0, 0), 0.55, fc=PALETTE["bg"])
        ax.add_patch(centre_circle)
        ax.text(0, 0, f"{sum(values)}\nevents", ha="center", va="center",
                color=PALETTE["accent"], fontsize=11, fontweight="bold")
    else:
        ax.text(0.5, 0.5, "No data", ha="center", va="center",
                color=PALETTE["text"], transform=ax.transAxes)

    ax.set_title(f"Severity Distribution ({hours}h)", fontsize=11, pad=8)
    return _fig_to_bytes(fig)


# ── Chart: Top sources bar ────────────────────────────────────────────────────

def chart_top_sources(limit: int = 10, hours: int = 24) -> bytes:
    since = time.time() - hours * 3600
    sources = database.get_top_sources(limit=limit, since=since)

    fig, ax = plt.subplots(figsize=(7, 3.5))
    _apply_cyberpunk_style(fig, [ax])

    if sources:
        ips = [s["source_ip"] or s["source_host"] or "unknown" for s in sources]
        counts = [s["cnt"] for s in sources]
        # Gradient-like colors
        bar_colors = [PALETTE["primary"] if i % 2 == 0 else PALETTE["accent"]
                      for i in range(len(ips))]
        bars = ax.barh(ips[::-1], counts[::-1], color=bar_colors[::-1],
                       edgecolor=PALETTE["grid"], linewidth=0.5)
        for bar, count in zip(bars, counts[::-1]):
            ax.text(bar.get_width() + 0.3, bar.get_y() + bar.get_height() / 2,
                    str(count), va="center", ha="left",
                    color=PALETTE["text"], fontsize=8)
    else:
        ax.text(0.5, 0.5, "No data", ha="center", va="center",
                color=PALETTE["text"], transform=ax.transAxes)

    ax.set_title(f"Top {limit} Sources ({hours}h)", fontsize=12, pad=8)
    ax.set_xlabel("Event Count", fontsize=9)
    return _fig_to_bytes(fig)


# ── Chart: Category heatmap ───────────────────────────────────────────────────

def chart_category_bar(hours: int = 24) -> bytes:
    since = time.time() - hours * 3600
    dist = database.get_category_distribution(since=since)

    fig, ax = plt.subplots(figsize=(7, 3.5))
    _apply_cyberpunk_style(fig, [ax])

    if dist:
        cats = [d["category"] for d in dist]
        vals = [d["cnt"] for d in dist]
        xs = range(len(cats))
        bars = ax.bar(xs, vals,
                      color=[PALETTE["primary"], PALETTE["accent"]] * (len(cats) // 2 + 1),
                      edgecolor=PALETTE["grid"], linewidth=0.5)
        ax.set_xticks(list(xs))
        ax.set_xticklabels(cats, rotation=30, ha="right", fontsize=9)
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.3,
                    str(v), ha="center", va="bottom",
                    color=PALETTE["text"], fontsize=8)
    else:
        ax.text(0.5, 0.5, "No data", ha="center", va="center",
                color=PALETTE["text"], transform=ax.transAxes)

    ax.set_title(f"Events by Category ({hours}h)", fontsize=12, pad=8)
    ax.set_ylabel("Count", fontsize=9)
    return _fig_to_bytes(fig)


# ── Anomaly scoring ───────────────────────────────────────────────────────────

def compute_anomaly_score(source_ip: str, hours: int = 1) -> dict:
    """
    Simple Z-score based anomaly detection for a source IP.
    Returns score 0-100 and contributing factors.
    """
    since = time.time() - hours * 3600
    events = database.get_events(limit=500, source_ip=source_ip, since=since)

    if not events:
        return {"score": 0, "factors": []}

    factors = []
    score = 0

    # 1. Failure rate
    fails = sum(1 for e in events if "fail" in e["raw_message"].lower() or
                "deny" in e["raw_message"].lower())
    fail_rate = fails / len(events)
    if fail_rate > 0.7:
        score += 30
        factors.append(f"High failure rate: {fail_rate:.0%}")

    # 2. High severity ratio
    high_sev = sum(1 for e in events if e["severity"] in ("CRITICAL", "HIGH"))
    if high_sev / len(events) > 0.5:
        score += 25
        factors.append(f"High severity events: {high_sev}/{len(events)}")

    # 3. Event velocity (events per minute)
    velocity = len(events) / (hours * 60)
    if velocity > 10:
        score += 20
        factors.append(f"High event rate: {velocity:.1f}/min")

    # 4. Diversity of event types
    types = Counter(e["event_type"] for e in events)
    if len(types) > 8:
        score += 15
        factors.append(f"Wide variety of event types: {len(types)}")

    # 5. Direct CRITICAL events
    crits = sum(1 for e in events if e["severity"] == "CRITICAL")
    if crits > 0:
        score += min(crits * 5, 25)
        factors.append(f"Critical severity events: {crits}")

    return {"score": min(score, 100), "factors": factors}
