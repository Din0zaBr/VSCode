const BASE = "/api";

const TOKEN_KEY = "logvault_token";
const ROLE_KEY = "logvault_role";
const AGENTS_KEY = "logvault_agents";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(AGENTS_KEY);
}

export function getRole(): string {
  return localStorage.getItem(ROLE_KEY) ?? "operator";
}

export function setRole(role: string): void {
  localStorage.setItem(ROLE_KEY, role);
}

export function getAllowedAgents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(AGENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function setAllowedAgents(agents: string[]): void {
  localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
}

export function isAdmin(): boolean {
  return getRole() === "admin";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export interface LogEvent {
  event_id: string;
  timestamp: string;
  host: string;
  agent_id: string;
  source: string;
  level: string;
  message: string;
  service: string;
  meta: Record<string, unknown>;
}

export interface SearchResult {
  total: number;
  logs: LogEvent[];
}

export interface SearchParams {
  q?: string;
  level?: string;
  agent_id?: string;
  service?: string;
  host?: string;
  source?: string;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

export interface StatsResult {
  over_time: TimeBucket[];
  by_level: TermBucket[];
  by_service: TermBucket[];
  by_agent: TermBucket[];
  by_host: TermBucket[];
  by_source: TermBucket[];
  heatmap: TimeBucket[];
}

export interface TimeBucket {
  key: number;
  key_as_string: string;
  doc_count: number;
  by_level?: { buckets: TermBucket[] };
}

export interface TermBucket {
  key: string;
  doc_count: number;
}

export interface AgentInfo {
  agent_id: string;
  doc_count: number;
  last_seen: string;
  host: string;
  active: boolean;
}

export interface HostInfo {
  host: string;
  agent_count: number;
  doc_count: number;
  last_seen: string;
}

export interface AlertChannel {
  type: "webhook" | "telegram";
  webhook_url?: string;
  telegram_token?: string;
  telegram_chat_id?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  condition_type: "threshold" | "regex";
  threshold: number;
  window_minutes: number;
  regex_pattern: string;
  level: string;
  channels: AlertChannel[];
}

export interface AgentMetrics {
  agent_id: string;
  host: string;
  timestamp: string;
  cpu: { usage_percent: number; cores: number };
  memory: {
    total_mb: number;
    used_mb: number;
    free_mb: number;
    available_mb: number;
    swap_total_mb: number;
    swap_used_mb: number;
    usage_percent: number;
  };
  disk: {
    device: string;
    mount: string;
    fs_type: string;
    total_gb: number;
    used_gb: number;
    free_gb: number;
    usage_percent: number;
  }[];
  load_average: { "1m": number; "5m": number; "15m": number };
  uptime: { seconds: number; human: string };
  distro: { name: string; version: string; id: string };
}

function localToIso(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

export interface LoginResponse {
  token: string;
  username: string;
  role: string;
  agents: string[];
}

export interface UserInfo {
  id: number;
  username: string;
  role: string;
  created_at: string;
  agents: string[];
}

export const api = {
  login(username: string, password: string) {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  me() {
    return request<{ username: string; user_id: number; role: string; agents: string[] }>("/auth/me");
  },

  listUsers() {
    return request<UserInfo[]>("/users/");
  },

  createUser(username: string, password: string, role: string) {
    return request<{ ok: boolean; id: number; username: string; role: string }>("/users/", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    });
  },

  deleteUser(id: number) {
    return request<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" });
  },

  updateUserRole(id: number, role: string) {
    return request<{ ok: boolean }>(`/users/${id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    });
  },

  setUserAgents(id: number, agents: string[]) {
    return request<{ ok: boolean; agents: string[] }>(`/users/${id}/agents`, {
      method: "PUT",
      body: JSON.stringify({ agents }),
    });
  },

  search(params: SearchParams) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.level) qs.set("level", params.level);
    if (params.agent_id) qs.set("agent_id", params.agent_id);
    if (params.service) qs.set("service", params.service);
    if (params.host) qs.set("host", params.host);
    if (params.source) qs.set("source", params.source);
    const isoFrom = localToIso(params.from ?? "");
    const isoTo = localToIso(params.to ?? "");
    if (isoFrom) qs.set("from", isoFrom);
    if (isoTo) qs.set("to", isoTo);
    if (params.page) qs.set("page", String(params.page));
    if (params.size) qs.set("size", String(params.size));
    return request<SearchResult>(`/search?${qs}`);
  },

  stats(params: { interval?: string; from?: string; to?: string; agent_id?: string; service?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.interval) qs.set("interval", params.interval);
    const sFrom = localToIso(params.from ?? "");
    const sTo = localToIso(params.to ?? "");
    if (sFrom) qs.set("from", sFrom);
    if (sTo) qs.set("to", sTo);
    if (params.agent_id) qs.set("agent_id", params.agent_id);
    if (params.service) qs.set("service", params.service);
    return request<StatsResult>(`/stats?${qs}`);
  },

  agents() {
    return request<AgentInfo[]>("/agents");
  },

  latestMetrics() {
    return request<AgentMetrics[]>("/metrics/latest");
  },

  hosts() {
    return request<HostInfo[]>("/hosts");
  },

  alertRules() {
    return request<AlertRule[]>("/alerts/");
  },

  createAlert(rule: Partial<AlertRule>) {
    return request<{ ok: boolean; id: string }>("/alerts/", {
      method: "POST",
      body: JSON.stringify(rule),
    });
  },

  deleteAlert(id: string) {
    return request<{ ok: boolean }>(`/alerts/${id}`, { method: "DELETE" });
  },

  updateAlerts(rules: AlertRule[]) {
    return request<{ ok: boolean }>("/alerts/", {
      method: "PUT",
      body: JSON.stringify(rules),
    });
  },
};

export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = getToken() ?? "";
  return `${proto}//${window.location.host}/api/logs/live?token=${encodeURIComponent(token)}`;
}
