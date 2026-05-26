"""
Отправка логов в OpenSearch с поддержкой:
  - Bulk API (пакетная отправка)
  - Retry с exponential backoff
  - Автоматический дренаж буфера при восстановлении связи
"""

from __future__ import annotations

import json
import time
import logging
import threading
from datetime import datetime
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .parser import ParsedLog
from .buffer import LogBuffer

logger = logging.getLogger(__name__)


class OpenSearchSender:
    """
    Отправляет логи в OpenSearch.

    Работает в двух режимах:
      1. Прямая отправка: лог пришёл → сразу в batch → отправка при накоплении
      2. Дренаж буфера: фоновый поток периодически сбрасывает буфер
    """

    def __init__(
        self,
        host: str = "https://opensearch:9200",
        user: str = "admin",
        password: str = "admin",
        index_prefix: str = "logs",
        verify_ssl: bool = False,
        batch_size: int = 200,
        flush_interval: float = 5.0,
        buffer: Optional[LogBuffer] = None,
    ):
        self._host = host.rstrip("/")
        self._user = user
        self._password = password
        self._index_prefix = index_prefix
        self._verify_ssl = verify_ssl
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._buffer = buffer

        self._batch: list[ParsedLog] = []
        self._batch_lock = threading.Lock()
        self._running = False
        self._server_available = True

        self._session = self._create_session()

    def _create_session(self) -> requests.Session:
        session = requests.Session()
        session.auth = (self._user, self._password)
        session.verify = self._verify_ssl
        retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[502, 503, 504])
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session

    def send(self, log: ParsedLog):
        """
        Принимает лог. Если сервер доступен — добавляет в batch.
        Если недоступен — кладёт в буфер.
        """
        if not self._server_available and self._buffer:
            self._buffer.push(log)
            return

        with self._batch_lock:
            self._batch.append(log)
            if len(self._batch) >= self._batch_size:
                batch = self._batch[:]
                self._batch.clear()

        if len(batch if 'batch' in dir() else []) >= self._batch_size:
            self._flush_batch(batch)

    def start_background(self):
        """Запускает фоновый поток для периодического flush и дренажа буфера."""
        self._running = True
        t = threading.Thread(target=self._background_loop, daemon=True)
        t.start()

    def stop(self):
        self._running = False
        self._flush_current_batch()

    def _background_loop(self):
        while self._running:
            self._flush_current_batch()
            self._drain_buffer()
            time.sleep(self._flush_interval)

    def _flush_current_batch(self):
        with self._batch_lock:
            if not self._batch:
                return
            batch = self._batch[:]
            self._batch.clear()
        self._flush_batch(batch)

    def _flush_batch(self, batch: list[ParsedLog]):
        """Отправляет пачку логов через Bulk API."""
        if not batch:
            return

        body_lines: list[str] = []
        for log in batch:
            index_name = self._make_index_name(log)
            meta = json.dumps({"index": {"_index": index_name}})
            doc = json.dumps(log.to_dict(), ensure_ascii=False)
            body_lines.append(meta)
            body_lines.append(doc)

        payload = "\n".join(body_lines) + "\n"

        try:
            resp = self._session.post(
                f"{self._host}/_bulk",
                data=payload.encode("utf-8"),
                headers={"Content-Type": "application/x-ndjson"},
                timeout=30,
            )
            if resp.status_code >= 400:
                logger.error("Bulk API ошибка %d: %s", resp.status_code, resp.text[:500])
                self._on_send_failure(batch)
            else:
                body = resp.json()
                if body.get("errors"):
                    failed = sum(
                        1 for item in body["items"]
                        if item.get("index", {}).get("status", 200) >= 400
                    )
                    logger.warning("Bulk: %d/%d записей с ошибками", failed, len(batch))
                else:
                    logger.debug("Bulk: отправлено %d записей", len(batch))
                self._server_available = True

        except requests.RequestException as e:
            logger.error("Ошибка соединения с OpenSearch: %s", e)
            self._on_send_failure(batch)

    def _on_send_failure(self, batch: list[ParsedLog]):
        """При ошибке отправки — сохраняем в буфер."""
        self._server_available = False
        if self._buffer:
            self._buffer.push_batch(batch)
            logger.info(
                "Сохранено %d записей в буфер (буфер: %d)",
                len(batch), self._buffer.size(),
            )

    def _drain_buffer(self):
        """Пытается отправить накопленные записи из буфера."""
        if not self._buffer:
            return

        buf_size = self._buffer.size()
        if buf_size == 0:
            return

        if not self._check_health():
            return

        self._server_available = True
        logger.info("Дренаж буфера: %d записей в очереди", buf_size)

        records = self._buffer.peek(self._batch_size)
        if not records:
            return

        ids = [r[0] for r in records]
        body_lines: list[str] = []
        for _, doc in records:
            ts = doc.get("timestamp", "")
            date_part = ts[:10] if len(ts) >= 10 else datetime.now().strftime("%Y-%m-%d")
            hostname = doc.get("hostname", "unknown")
            index_name = f"{self._index_prefix}-{hostname}-{date_part}"
            meta = json.dumps({"index": {"_index": index_name}})
            body_lines.append(meta)
            body_lines.append(json.dumps(doc, ensure_ascii=False))

        payload = "\n".join(body_lines) + "\n"

        try:
            resp = self._session.post(
                f"{self._host}/_bulk",
                data=payload.encode("utf-8"),
                headers={"Content-Type": "application/x-ndjson"},
                timeout=30,
            )
            if resp.status_code < 400:
                self._buffer.ack(ids)
                logger.info("Дренаж: отправлено %d записей из буфера", len(ids))
            else:
                logger.warning("Дренаж: ошибка %d", resp.status_code)
        except requests.RequestException as e:
            logger.warning("Дренаж: сервер недоступен: %s", e)
            self._server_available = False

    def _check_health(self) -> bool:
        """Проверяет доступность OpenSearch."""
        try:
            resp = self._session.get(
                f"{self._host}/_cluster/health", timeout=5
            )
            return resp.status_code == 200
        except requests.RequestException:
            return False

    def _make_index_name(self, log: ParsedLog) -> str:
        ts = log.timestamp
        date_part = ts[:10] if len(ts) >= 10 else datetime.now().strftime("%Y-%m-%d")
        hostname = log.hostname or "unknown"
        return f"{self._index_prefix}-{hostname}-{date_part}"
