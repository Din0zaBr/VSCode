import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEvent } from "../api/client";
import { wsUrl } from "../api/client";

const MAX_LOGS = 500;

export function useWebSocket() {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const paused = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const bufferRef = useRef<LogEvent[]>([]);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();

      ws.onmessage = (ev) => {
        try {
          const log: LogEvent = JSON.parse(ev.data);
          if (paused.current) {
            bufferRef.current.push(log);
            if (bufferRef.current.length > MAX_LOGS) bufferRef.current.shift();
            return;
          }
          setLogs((prev) => {
            const next = [...prev, log];
            return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
          });
        } catch { /* ignore malformed */ }
      };
    };

    connect();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const setPaused = useCallback((v: boolean) => {
    paused.current = v;
    if (!v && bufferRef.current.length) {
      setLogs((prev) => {
        const merged = [...prev, ...bufferRef.current];
        bufferRef.current = [];
        return merged.length > MAX_LOGS ? merged.slice(-MAX_LOGS) : merged;
      });
    }
  }, []);

  const clear = useCallback(() => setLogs([]), []);

  return { logs, connected, setPaused, clear, paused };
}
