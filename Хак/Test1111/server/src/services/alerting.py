from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

import requests

from server.src.config import settings
from server.src.services.postgres import PGService

logger = logging.getLogger("server.alerting")

_alert_rules: list[dict[str, Any]] = []
_rules_lock = threading.Lock()


def get_rules() -> list[dict[str, Any]]:
    with _rules_lock:
        return list(_alert_rules)


def set_rules(rules: list[dict[str, Any]]) -> None:
    with _rules_lock:
        _alert_rules.clear()
        _alert_rules.extend(rules)


def add_rule(rule: dict[str, Any]) -> None:
    with _rules_lock:
        _alert_rules.append(rule)


def remove_rule(rule_id: str) -> bool:
    with _rules_lock:
        for i, r in enumerate(_alert_rules):
            if r.get("id") == rule_id:
                _alert_rules.pop(i)
                return True
    return False


def _send_webhook(url: str, message: str) -> None:
    try:
        requests.post(url, json={"text": message}, timeout=10)
    except Exception:
        logger.exception("Failed to send webhook to %s", url)


def _send_telegram(token: str, chat_id: str, message: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        requests.post(url, json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"}, timeout=10)
    except Exception:
        logger.exception("Failed to send Telegram message")


def _fire_alert(rule: dict[str, Any], detail: str) -> None:
    message = f"[LogVault Alert] {rule.get('name', 'unnamed')}: {detail}"
    channels = rule.get("channels", [])

    if not channels:
        if settings.ALERT_WEBHOOK_URL:
            _send_webhook(settings.ALERT_WEBHOOK_URL, message)
        if settings.ALERT_TELEGRAM_TOKEN and settings.ALERT_TELEGRAM_CHAT_ID:
            _send_telegram(settings.ALERT_TELEGRAM_TOKEN, settings.ALERT_TELEGRAM_CHAT_ID, message)
        return

    for ch in channels:
        ch_type = ch.get("type", "webhook")
        if ch_type == "webhook" and ch.get("webhook_url"):
            _send_webhook(ch["webhook_url"], message)
        elif ch_type == "telegram" and ch.get("telegram_token") and ch.get("telegram_chat_id"):
            _send_telegram(ch["telegram_token"], ch["telegram_chat_id"], message)


def _check_threshold_rule(db: PGService, rule: dict[str, Any]) -> None:
    window = rule.get("window_minutes", 5)
    level = rule.get("level", "ERROR")
    threshold = rule.get("threshold", 10)

    result = db.search(
        level=level,
        from_ts=f"now-{window}m",
        to_ts="now",
        size=0,
    )
    count = result.get("total", 0)
    if count >= threshold:
        _fire_alert(rule, f"{count} {level} logs in last {window}min (threshold: {threshold})")


def _check_regex_rule(db: PGService, rule: dict[str, Any]) -> None:
    pattern = rule.get("regex_pattern", "")
    window = rule.get("window_minutes", 5)
    if not pattern:
        return

    result = db.search(
        q=pattern,
        from_ts=f"now-{window}m",
        to_ts="now",
        size=1,
    )
    count = result.get("total", 0)
    if count > 0:
        _fire_alert(rule, f"Pattern '{pattern}' matched {count} times in last {window}min")


def alert_loop(db: PGService, interval: float = 30.0) -> None:
    logger.info("Alert engine started (interval=%.0fs)", interval)
    while True:
        time.sleep(interval)
        rules = get_rules()
        for rule in rules:
            if not rule.get("enabled", True):
                continue
            try:
                ctype = rule.get("condition_type", "threshold")
                if ctype == "threshold":
                    _check_threshold_rule(db, rule)
                elif ctype == "regex":
                    _check_regex_rule(db, rule)
            except Exception:
                logger.exception("Error checking rule %s", rule.get("id"))
