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

export interface CorrelationRule {
  id: string;
  name: string;
  description?: string;
  severity: string;
  enabled: boolean;
  // Sigma rule YAML stored as string
  sigma_rule?: string;
  conditions: Record<string, unknown>;
  hit_count?: number;
  created_at?: string;
  updated_at?: string;
}

// ── Local-only types (localStorage) ─────────────────────────────────────────

export interface Fieldset {
  id: string;
  name: string;
  fields: string[];
  isDefault?: boolean;
}

export interface QueryHistoryItem {
  id: string;
  timestamp: string;
  label?: string;
  pdql: string;
  timeRange: { type: string; relative?: string; from?: string; to?: string };
  fieldsetId?: string;
}

export interface IncidentTask {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
}

export interface IncidentNote {
  id: string;
  text: string;
  created_at: string;
  author?: string;
}

export interface IncidentHistoryEntry {
  id: string;
  event: string;   // e.g. "Статус изменён: OPEN → INVESTIGATING"
  timestamp: string;
  author?: string;
}

export interface IncidentExtra {
  incident_id: number;
  assignee?: string;
  category?: string;
  type?: string;
  impact?: string;
  tasks: IncidentTask[];
  notes: IncidentNote[];
  history: IncidentHistoryEntry[];
}

// ── Fieldset helpers ─────────────────────────────────────────────────────────

const FS_KEY = "ursus_fieldsets";
const DEFAULT_FIELDSET: Fieldset = {
  id: "default",
  name: "По умолчанию",
  fields: ["criticality", "time", "event_src.host", "text"],
  isDefault: true,
};

export function getFieldsets(): Fieldset[] {
  try {
    const raw = localStorage.getItem(FS_KEY);
    if (!raw) return [DEFAULT_FIELDSET];
    const parsed = JSON.parse(raw) as Fieldset[];
    if (!parsed.find((f) => f.id === "default")) parsed.unshift(DEFAULT_FIELDSET);
    return parsed;
  } catch {
    return [DEFAULT_FIELDSET];
  }
}

export function saveFieldsets(fs: Fieldset[]): void {
  localStorage.setItem(FS_KEY, JSON.stringify(fs));
}

// ── Query history helpers ────────────────────────────────────────────────────

const QH_KEY = "ursus_query_history";
const QH_MAX = 50;

export function getQueryHistory(): QueryHistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(QH_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addQueryHistory(item: Omit<QueryHistoryItem, "id" | "timestamp">): void {
  const history = getQueryHistory();
  const entry: QueryHistoryItem = {
    ...item,
    id: `qh-${Date.now()}`,
    timestamp: new Date().toISOString(),
  };
  const updated = [entry, ...history].slice(0, QH_MAX);
  localStorage.setItem(QH_KEY, JSON.stringify(updated));
}

export function clearQueryHistory(): void {
  localStorage.removeItem(QH_KEY);
}

// ── Incident extras helpers ──────────────────────────────────────────────────

const IE_KEY = "ursus_incident_extras";

export function getIncidentExtras(): Record<number, IncidentExtra> {
  try {
    return JSON.parse(localStorage.getItem(IE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getIncidentExtra(id: number): IncidentExtra {
  const all = getIncidentExtras();
  return all[id] ?? { incident_id: id, tasks: [], notes: [], history: [] };
}

export function saveIncidentExtra(extra: IncidentExtra): void {
  const all = getIncidentExtras();
  all[extra.incident_id] = extra;
  localStorage.setItem(IE_KEY, JSON.stringify(all));
}

export interface CorrelationAlert {
  id: number;
  created_at: string;
  rule_id: string;
  rule_name: string;
  severity: string;
  status: string;
  source_ip?: string;
  description?: string;
  event_ids?: unknown;
  notes?: string;
}

export interface Asset {
  id: number;
  hostname: string;
  ip?: string;
  os?: string;
  department?: string;
  owner?: string;
  criticality: string;
  tags?: string[];
  notes?: string;
  first_seen?: string;
  last_seen?: string;
  status: string;
}

export interface KnownAccount {
  id: number;
  username: string;
  domain?: string;
  display_name?: string;
  email?: string;
  department?: string;
  role?: string;
  risk_level: string;
  is_service_account: boolean;
  is_privileged: boolean;
  notes?: string;
  first_seen?: string;
  last_seen?: string;
}

export interface Exclusion {
  id: number;
  name: string;
  description?: string;
  exclusion_type: string;
  conditions: Record<string, unknown>;
  enabled: boolean;
  scope?: string;
  created_by?: string;
  expires_at?: string;
  created_at?: string;
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

  // ── PDQL ─────────────────────────────────────────────────────────────────
  pdqlSearch(
    query: string,
    page = 1,
    size = 100,
    opts?: { from?: string; to?: string },
  ) {
    const qs = new URLSearchParams({ query, page: String(page), size: String(size) });
    const isoFrom = opts?.from ? localToIso(opts.from) : "";
    const isoTo = opts?.to ? localToIso(opts.to) : "";
    if (isoFrom) qs.set("from", isoFrom);
    if (isoTo) qs.set("to", isoTo);
    return request<any>(`/search/pdql?${qs}`);
  },

  /** Admin: re-run parser enrichment on existing DB rows (fills category, event_type, …). */
  reparseMeta(limit = 5000, offset = 0) {
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return request<{ scanned: number; updated: number; has_more: boolean; limit: number; offset: number }>(
      `/search/reparse-meta?${qs}`,
      { method: "POST" },
    );
  },

  // ── Correlation rules ────────────────────────────────────────────────────
  correlationRules() {
    return request<CorrelationRule[]>("/correlation/rules");
  },

  createCorrelationRule(rule: CorrelationRule) {
    return request<CorrelationRule>("/correlation/rules", { method: "POST", body: JSON.stringify(rule) });
  },

  updateCorrelationRule(id: string, rule: CorrelationRule) {
    return request<CorrelationRule>(`/correlation/rules/${id}`, { method: "PUT", body: JSON.stringify(rule) });
  },

  deleteCorrelationRule(id: string) {
    return request<{ ok: boolean }>(`/correlation/rules/${id}`, { method: "DELETE" });
  },

  // ── Correlation alerts ───────────────────────────────────────────────────
  correlationAlerts(params: { limit?: number; offset?: number; status?: string; severity?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    if (params.status) qs.set("status", params.status);
    if (params.severity) qs.set("severity", params.severity);
    return request<{ total: number; alerts: CorrelationAlert[] }>(`/correlation/alerts?${qs}`);
  },

  updateCorrelationAlertStatus(id: number, status: string, notes?: string) {
    return request<{ ok: boolean }>(`/correlation/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ status, notes: notes ?? "" }) });
  },

  // ── Assets ───────────────────────────────────────────────────────────────
  listAssets(params: { page?: number; size?: number; search?: string; status?: string; criticality?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.size) qs.set("size", String(params.size));
    if (params.search) qs.set("search", params.search);
    if (params.status) qs.set("status", params.status);
    if (params.criticality) qs.set("criticality", params.criticality);
    return request<{ total: number; assets: Asset[] }>(`/assets?${qs}`);
  },

  createAsset(data: Partial<Asset>) {
    return request<Asset>("/assets", { method: "POST", body: JSON.stringify(data) });
  },

  updateAsset(id: number, data: Partial<Asset>) {
    return request<{ ok: boolean }>(`/assets/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },

  deleteAsset(id: number) {
    return request<{ ok: boolean }>(`/assets/${id}`, { method: "DELETE" });
  },

  discoverAssets() {
    return request<{ ok: boolean; discovered: number }>("/assets/discover", { method: "POST" });
  },

  // ── Accounts ─────────────────────────────────────────────────────────────
  listAccounts(params: { page?: number; size?: number; search?: string; domain?: string; risk_level?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.size) qs.set("size", String(params.size));
    if (params.search) qs.set("search", params.search);
    if (params.domain) qs.set("domain", params.domain);
    if (params.risk_level) qs.set("risk_level", params.risk_level);
    return request<{ total: number; accounts: KnownAccount[] }>(`/accounts?${qs}`);
  },

  createAccount(data: Partial<KnownAccount>) {
    return request<KnownAccount>("/accounts", { method: "POST", body: JSON.stringify(data) });
  },

  updateAccount(id: number, data: Partial<KnownAccount>) {
    return request<{ ok: boolean }>(`/accounts/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },

  deleteAccount(id: number) {
    return request<{ ok: boolean }>(`/accounts/${id}`, { method: "DELETE" });
  },

  discoverAccounts() {
    return request<{ ok: boolean; discovered: number }>("/accounts/discover", { method: "POST" });
  },

  // ── Exclusions ───────────────────────────────────────────────────────────
  listExclusions(params: { page?: number; size?: number; type?: string; enabled?: boolean } = {}) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.size) qs.set("size", String(params.size));
    if (params.type) qs.set("type", params.type);
    if (params.enabled !== undefined) qs.set("enabled", String(params.enabled));
    return request<{ total: number; exclusions: Exclusion[] }>(`/exclusions?${qs}`);
  },

  createExclusion(data: Partial<Exclusion> & { conditions: Record<string, unknown> }) {
    return request<Exclusion>("/exclusions", { method: "POST", body: JSON.stringify(data) });
  },

  updateExclusion(id: number, data: Partial<Exclusion> & { conditions: Record<string, unknown> }) {
    return request<{ ok: boolean }>(`/exclusions/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },

  deleteExclusion(id: number) {
    return request<{ ok: boolean }>(`/exclusions/${id}`, { method: "DELETE" });
  },

  // ── Integrations ─────────────────────────────────────────────────────────
  listIntegrations() {
    return request<any[]>("/integrations");
  },

  adStatus() {
    return request<{ configured: boolean; connected: boolean; server: string; domain: string }>("/integrations/ad/status");
  },

  // ── System Health ─────────────────────────────────────────────────────────
  systemHealth() {
    return request<any>("/health/detailed");
  },
};

export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = getToken() ?? "";
  return `${proto}//${window.location.host}/api/logs/live?token=${encodeURIComponent(token)}`;
}
