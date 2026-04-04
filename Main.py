#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════╗
║           URSUS INSIGHT SIEM  v1.0.0                 ║
║     Security Information and Event Management        ║
║                                                      ║
║  Palette: Cyber Forest                               ║
║  Primary #6A0DAD | Accent #BF40BF | BG #2F4F4F      ║
╚══════════════════════════════════════════════════════╝

Usage:
    python3 Main.py [--host HOST] [--port PORT] [--no-demo]
"""
import os
import sys
import time
import socket
import logging
import argparse
import threading
import functools

# ── Logging setup (before any imports that use it) ────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(os.path.dirname(__file__), "logs", "ursus.log"),
                            encoding="utf-8"),
    ]
)
logger = logging.getLogger("ursus.main")

# ── Project root on path ──────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import config

# ── Init DB immediately ───────────────────────────────────────────────────────
from core import database
database.init_db()

# ── Imports ───────────────────────────────────────────────────────────────────
from flask import Flask, redirect, url_for, render_template, request, session, flash
from flask_cors import CORS

from core import collector, correlator
from api.routes import api


# ── Auth decorator ────────────────────────────────────────────────────────────

def login_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


# ── Flask app ─────────────────────────────────────────────────────────────────

def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=os.path.join(ROOT, "web", "templates"),
        static_folder=os.path.join(ROOT, "web", "static"),
        static_url_path="/static",
    )
    app.secret_key = config.SECRET_KEY
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Register API blueprint
    app.register_blueprint(api)

    # ── Auth routes ──────────────────────────────────────────────────────────

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if session.get("logged_in"):
            return redirect(url_for("index"))
        error = None
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            if username == config.WEB_USERNAME and password == config.WEB_PASSWORD:
                session.permanent = True
                session["logged_in"] = True
                session["username"] = username
                return redirect(request.args.get("next") or url_for("index"))
            error = "Неверный логин или пароль"
        return render_template("login.html", error=error)

    @app.get("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    # ── Page routes ──────────────────────────────────────────────────────────

    @app.get("/")
    @login_required
    def index():
        return render_template("dashboard.html", active_page="dashboard")

    @app.get("/events")
    @login_required
    def events_page():
        return render_template("events.html", active_page="events")

    @app.get("/alerts")
    @login_required
    def alerts_page():
        return render_template("alerts.html", active_page="alerts")

    @app.get("/rules")
    @login_required
    def rules_page():
        return render_template("rules.html", active_page="rules")

    @app.get("/agents")
    @login_required
    def agents_page():
        try:
            siem_ip = socket.gethostbyname(socket.gethostname())
        except Exception:
            siem_ip = "SIEM_IP"
        return render_template("agents.html",
                               active_page="agents",
                               siem_ip=siem_ip,
                               agent_key=config.AGENT_API_KEY)

    # ── Error handlers ────────────────────────────────────────────────────────
    @app.errorhandler(404)
    def not_found(e):
        return {"error": "not found"}, 404

    @app.errorhandler(401)
    def unauthorized(e):
        return {"error": "unauthorized", "detail": str(e)}, 401

    @app.errorhandler(400)
    def bad_request(e):
        return {"error": "bad request", "detail": str(e)}, 400

    return app


# ── Background services ───────────────────────────────────────────────────────

def start_services(demo_mode: bool = True) -> list:
    services = []

    # 1. Event processor (always running)
    proc = collector.EventProcessor()
    proc.start()
    services.append(proc)
    logger.info("Event processor started")

    # 2. Syslog UDP listener
    syslog = collector.SyslogListener()
    syslog.start()
    services.append(syslog)

    # 3. File tail watcher
    watcher = collector.FileTailWatcher()
    watcher.start()
    services.append(watcher)

    # 4. Correlation engine
    engine = correlator.CorrelationEngine()
    engine.start()
    services.append(engine)
    logger.info("Correlation engine started")

    # 5. Demo event generator (optional)
    if demo_mode:
        demo = collector.DemoEventGenerator(interval_range=(3, 10))
        demo.start()
        services.append(demo)
        logger.info("Demo event generator started (use --no-demo to disable)")

    # 6. Maintenance thread
    def maintenance_loop():
        while True:
            time.sleep(3600)
            try:
                database.purge_old_data()
                database.mark_stale_agents(timeout_sec=120)
            except Exception as e:
                logger.error("Maintenance error: %s", e)

    maint = threading.Thread(target=maintenance_loop, daemon=True, name="Maintenance")
    maint.start()

    return services


# ── Banner ────────────────────────────────────────────────────────────────────

def print_banner(host: str, port: int):
    try:
        local_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        local_ip = "localhost"

    banner = f"""
╔══════════════════════════════════════════════════════════╗
║         🐻  URSUS INSIGHT SIEM  v1.0.0  🐻              ║
║                  [ CYBER FOREST ]                        ║
╠══════════════════════════════════════════════════════════╣
║  Web UI:    http://{local_ip}:{port:<5}                    ║
║  Syslog:    UDP {local_ip}:514 / 1514                 ║
║  Agent API: http://{local_ip}:{port+1:<5} (port {port+1})  ║
║  Database:  {config.DB_PATH:<45}║
╚══════════════════════════════════════════════════════════╝
    """
    print(banner)


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)

    parser = argparse.ArgumentParser(description="Ursus Insight SIEM")
    parser.add_argument("--host",    default=config.WEB_HOST, help="Web server host")
    parser.add_argument("--port",    type=int, default=config.WEB_PORT, help="Web server port")
    parser.add_argument("--no-demo", action="store_true", help="Disable demo event generator")
    parser.add_argument("--debug",   action="store_true", help="Enable Flask debug mode")
    args = parser.parse_args()

    logger.info("Ursus Insight SIEM starting...")

    # Start background services
    services = start_services(demo_mode=not args.no_demo)
    logger.info("Started %d background services", len(services))

    print_banner(args.host, args.port)

    # Create and run Flask app
    app = create_app()

    try:
        app.run(
            host=args.host,
            port=args.port,
            debug=args.debug,
            use_reloader=False,   # Important: don't restart, we have background threads
            threaded=True,
        )
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        for svc in services:
            if hasattr(svc, "stop"):
                svc.stop()
        logger.info("Ursus Insight stopped.")


if __name__ == "__main__":
    main()
