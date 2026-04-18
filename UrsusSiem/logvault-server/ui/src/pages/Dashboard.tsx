import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { getIncidentExtra } from "../api/client";
import type { AgentInfo } from "../api/client";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useState } from "react";

const TIME_STEPS = [
  { label: "15 минут", value: "15m" },
  { label: "30 минут", value: "30m" },
  { label: "1 час",   value: "1h" },
  { label: "6 часов", value: "6h" },
  { label: "12 часов",value: "12h" },
  { label: "24 часа", value: "1d" },
  { label: "Неделя",  value: "7d" },
  { label: "Месяц",   value: "30d" },
];

const CHART_VIEWS = [
  { value: "count",    label: "Все события" },
  { value: "severity", label: "По критичности" },
  { value: "category", label: "По типу" },
];

const LEVEL_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  ERROR:    "#f97316",
  WARNING:  "#eab308",
  WARN:     "#facc15",
  INFO:     "#a78bfa",
  DEBUG:    "#6b7280",
};

const SEV_PIE_CFG = [
  { name: "CRITICAL", color: "#ef4444" },
  { name: "HIGH",     color: "#f97316" },
  { name: "MEDIUM",   color: "#eab308" },
  { name: "LOW",      color: "#3b82f6" },
];

function SiemTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
      {label && <div className="mb-1 pb-1 border-b" style={{ borderColor: "var(--border)", color: "var(--text-soft)" }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mt-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span style={{ color: "var(--text-soft)" }}>{p.name}:</span>
          <span className="font-semibold" style={{ color: "var(--text)" }}>{(p.value ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [step, setStep] = useState("1h");
  const [chartView, setChartView] = useState("count");

  const { data, isLoading } = useQuery({
    queryKey: ["stats", step],
    queryFn: () => api.stats({ interval: step }),
    refetchInterval: 30_000,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents(),
    refetchInterval: 15_000,
  });

  const { data: assetsData } = useQuery({
    queryKey: ["assets-dash"],
    queryFn: () => api.listAssets({ size: 1 }),
    refetchInterval: 60_000,
  });

  const { data: incData } = useQuery({
    queryKey: ["corr-alerts-dash"],
    queryFn: () => api.correlationAlerts({ limit: 200 }),
    refetchInterval: 30_000,
  });

  const incAlerts    = incData?.alerts ?? [];
  const openInc      = incAlerts.filter((a) => a.status === "OPEN").length;
  const criticalInc  = incAlerts.filter((a) => a.severity === "CRITICAL").length;
  const totalAssets  = assetsData?.total ?? 0;
  const activeAgents = (agents ?? []).filter((a) => a.active);
  const totalLogs    = data?.by_level.reduce((s, b) => s + b.doc_count, 0) ?? 0;
  const totalTasks   = incAlerts.flatMap((a) => getIncidentExtra(a.id).tasks.filter((t) => !t.done)).length;

  const minMap: Record<string, number> = {
    "15m": 15, "30m": 30, "1h": 60, "6h": 360,
    "12h": 720, "1d": 1440, "7d": 10080, "30d": 43200,
  };
  const avgFlow = totalLogs > 0 ? (totalLogs / (minMap[step] ?? 60)).toFixed(1) : "0";

  const timelineData = (data?.over_time ?? []).map((b) => {
    const byLevel = Object.fromEntries((b.by_level?.buckets ?? []).map((l) => [l.key, l.doc_count]));
    const label = new Date(b.key).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return { label, total: b.doc_count, ...byLevel };
  });

  const levelPie = Object.entries(LEVEL_COLORS)
    .map(([key, color]) => ({ name: key, value: data?.by_level.find((b) => b.key === key)?.doc_count ?? 0, color }))
    .filter((l) => l.value > 0);

  const incSevPie = SEV_PIE_CFG
    .map((s) => ({ name: s.name, value: incAlerts.filter((a) => a.severity === s.name).length, color: s.color }))
    .filter((s) => s.value > 0);

  const hostBar = (data?.by_host ?? []).slice(0, 8).map((h) => ({ name: h.key, count: h.doc_count }));

  const recentInc = [...incAlerts]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  const hostGroups = new Map<string, AgentInfo[]>();
  for (const a of agents ?? []) {
    const key = a.host || "Unknown";
    if (!hostGroups.has(key)) hostGroups.set(key, []);
    hostGroups.get(key)!.push(a);
  }

  const stepLabel = TIME_STEPS.find((s) => s.value === step)?.label ?? step;

  return (
    <div className="overflow-auto h-[calc(100vh-52px)]">
      <div className="p-6 space-y-5 max-w-[1600px]">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold" style={{ color: "var(--text)" }}>Панель управления</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-soft)" }}>URSUS SIEM · обзор системы безопасности</p>
          </div>
        </div>

        {/* Event Stream - Primary Feature */}
        <Card
          title="Поток событий"
          sub={stepLabel}
          extra={
            <div className="flex items-center gap-2">
              {/* Chart view tabs */}
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                {CHART_VIEWS.map((v) => (
                  <button
                    key={v.value}
                    onClick={() => setChartView(v.value)}
                    className="px-3 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: chartView === v.value ? "var(--accent)" : "transparent",
                      color: chartView === v.value ? "#fff" : "var(--text-soft)",
                      borderRight: v.value !== "category" ? `1px solid var(--border)` : undefined,
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {/* Step dropdown */}
              <select
                value={step}
                onChange={(e) => setStep(e.target.value)}
                className="siem-input text-xs py-1"
                style={{ minWidth: "120px" }}
              >
                {TIME_STEPS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          }
        >
          {isLoading ? <Skel h={260} /> : timelineData.length === 0 ? <Empty h={260} /> : (
            <ResponsiveContainer width="100%" height={260}>
              {chartView === "count" ? (
                <AreaChart data={timelineData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-soft)", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "var(--text-soft)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SiemTooltip />} />
                  <Area type="monotone" dataKey="total" name="Всего событий" stroke="#a78bfa" strokeWidth={2} fill="url(#gTotal)" dot={false} />
                </AreaChart>
              ) : chartView === "severity" ? (
                <AreaChart data={timelineData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    {["CRITICAL", "ERROR", "WARNING", "INFO"].map((lvl) => (
                      <linearGradient key={lvl} id={`g${lvl}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={LEVEL_COLORS[lvl]} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={LEVEL_COLORS[lvl]} stopOpacity={0.02} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-soft)", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "var(--text-soft)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SiemTooltip />} />
                  <Area type="monotone" dataKey="CRITICAL" name="Критические" stroke={LEVEL_COLORS.CRITICAL} strokeWidth={1.5} fill={`url(#gCRITICAL)`} dot={false} stackId="s" />
                  <Area type="monotone" dataKey="ERROR"    name="Ошибки"      stroke={LEVEL_COLORS.ERROR}    strokeWidth={1.5} fill={`url(#gERROR)`}    dot={false} stackId="s" />
                  <Area type="monotone" dataKey="WARNING"  name="Предупреждения" stroke={LEVEL_COLORS.WARNING} strokeWidth={1} fill={`url(#gWARNING)`} dot={false} stackId="s" />
                  <Area type="monotone" dataKey="INFO"     name="Информация"   stroke={LEVEL_COLORS.INFO}     strokeWidth={1} fill={`url(#gINFO)`}     dot={false} stackId="s" />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: "var(--text-soft)", fontSize: 10 }}>{v}</span>} />
                </AreaChart>
              ) : (
                <AreaChart data={timelineData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gTotal2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gError2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gWarn2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#eab308" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#eab308" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "var(--text-soft)", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "var(--text-soft)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SiemTooltip />} />
                  <Area type="monotone" dataKey="total"   name="Всего"       stroke="#a78bfa" strokeWidth={2} fill="url(#gTotal2)" dot={false} />
                  <Area type="monotone" dataKey="ERROR"   name="Ошибки"      stroke="#ef4444" strokeWidth={1.5} fill="url(#gError2)" dot={false} />
                  <Area type="monotone" dataKey="WARNING" name="Предупр."    stroke="#eab308" strokeWidth={1} fill="url(#gWarn2)" dot={false} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: "var(--text-soft)", fontSize: 10 }}>{v}</span>} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          )}
        </Card>

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Открытых инцидентов",  val: openInc,            color: "#ef4444", to: "/incidents" },
            { label: "Критичных инцидентов", val: criticalInc,         color: "#f97316", to: "/incidents" },
            { label: "Активов",              val: totalAssets,         color: "#a78bfa", to: "/assets" },
            { label: "Активных агентов",     val: activeAgents.length, color: "#4ade80", sub: `из ${agents?.length ?? 0}` },
            { label: "Поток событий",        val: avgFlow,             color: "#a78bfa", sub: "событий/мин", ld: isLoading },
            { label: "Открытых задач",       val: totalTasks,          color: "#eab308", to: "/incidents" },
          ].map((k) => (
            <div key={k.label} className="siem-card p-4 transition-colors hover:border-siem-purple cursor-pointer"
              onClick={k.to ? () => navigate(k.to!) : undefined}
              style={{ cursor: k.to ? "pointer" : "default" }}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-soft)" }}>{k.label}</div>
              <div className="text-3xl font-bold" style={{ color: k.color }}>
                {k.ld ? <span className="animate-pulse" style={{ color: "var(--border)" }}>—</span> : String(k.val)}
              </div>
              {k.sub && <div className="text-[10px] mt-1" style={{ color: "var(--text-soft)" }}>{k.sub}</div>}
            </div>
          ))}
        </div>

        {/* Row 2: Level pie + Host bar */}
        <div className="grid grid-cols-3 gap-4">
          <Card title="По уровням логов">
            {isLoading ? <Skel h={220} /> : levelPie.length === 0 ? <Empty h={220} /> : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={levelPie} cx="50%" cy="44%" innerRadius={52} outerRadius={80} dataKey="value" nameKey="name" paddingAngle={3}>
                    {levelPie.map((e, i) => <Cell key={i} fill={e.color} opacity={0.88} stroke="none" />)}
                  </Pie>
                  <Tooltip content={<SiemTooltip />} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: "var(--text-soft)", fontSize: 10 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Топ источников событий" cls="col-span-2">
            {isLoading ? <Skel h={220} /> : hostBar.length === 0 ? <Empty h={220} /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hostBar} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "var(--text-soft)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SiemTooltip />} />
                  <Bar dataKey="count" name="Событий" radius={[0, 4, 4, 0]}>
                    {hostBar.map((_, i) => (
                      <Cell key={i} fill="#a78bfa" opacity={0.9 - i * 0.08} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        {/* Row 3: Inc severity + Recent incidents + Agents */}
        <div className="grid grid-cols-3 gap-4">
          <Card title="Инциденты по критичности">
            {incSevPie.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[200px] gap-2">
                <div className="text-4xl" style={{ color: "var(--border)" }}>◎</div>
                <div className="text-sm" style={{ color: "var(--text-soft)" }}>Нет инцидентов</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={incSevPie} cx="50%" cy="44%" innerRadius={45} outerRadius={72} dataKey="value" nameKey="name" paddingAngle={4}>
                    {incSevPie.map((e, i) => <Cell key={i} fill={e.color} opacity={0.85} stroke="none" />)}
                  </Pie>
                  <Tooltip content={<SiemTooltip />} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: "var(--text-soft)", fontSize: 10 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Последние инциденты">
            {recentInc.length === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: "var(--text-soft)" }}>Нет инцидентов</div>
            ) : (
              <>
                {recentInc.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-2.5 border-b cursor-pointer transition-colors rounded px-1"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => navigate("/incidents")}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <SevDot sev={a.severity} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>{a.rule_name}</div>
                      <div className="text-[10px]" style={{ color: "var(--text-soft)" }}>{new Date(a.created_at).toLocaleString("ru-RU")}</div>
                    </div>
                    <IncStatusBadge status={a.status} />
                  </div>
                ))}
                <button onClick={() => navigate("/incidents")} className="w-full text-center text-xs pt-3 pb-1" style={{ color: "var(--accent)" }}>
                  Все инциденты →
                </button>
              </>
            )}
          </Card>

          <Card title="Состояние агентов">
            {hostGroups.size === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: "var(--text-soft)" }}>Нет агентов</div>
            ) : (
              <div className="space-y-3">
                {[...hostGroups.entries()].slice(0, 7).map(([host, ha]) => {
                  const active = ha.filter((a) => a.active).length;
                  const pct = ha.length > 0 ? (active / ha.length) * 100 : 0;
                  const barColor = pct === 100 ? "#4ade80" : pct > 50 ? "#eab308" : "#ef4444";
                  return (
                    <div key={host}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="truncate max-w-[180px]" style={{ color: "var(--text)" }}>{host}</span>
                        <span style={{ color: barColor }}>{active}/{ha.length}</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "var(--surface-2)" }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children, cls = "", sub, extra }: { title: string; children: React.ReactNode; cls?: string; sub?: string; extra?: React.ReactNode }) {
  return (
    <div className={`siem-card p-4 ${cls}`}>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h3>
          {sub && <span className="text-[10px]" style={{ color: "var(--text-soft)" }}>{sub}</span>}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Skel({ h }: { h: number }) {
  return <div className="rounded-lg animate-pulse" style={{ background: "var(--surface-2)", height: h }} />;
}

function Empty({ h }: { h: number }) {
  return <div className="flex items-center justify-center text-sm" style={{ height: h, color: "var(--text-soft)" }}>Нет данных</div>;
}

function SevDot({ sev }: { sev: string }) {
  const c: Record<string, string> = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308", LOW: "#3b82f6" };
  const col = c[sev] ?? "#94a3b8";
  return <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col }} />;
}

function IncStatusBadge({ status }: { status: string }) {
  const m: Record<string, { cls: string; lbl: string }> = {
    OPEN:           { cls: "badge-open",          lbl: "Открыт" },
    INVESTIGATING:  { cls: "badge-investigating",  lbl: "Расследуется" },
    RESOLVED:       { cls: "badge-resolved",       lbl: "Закрыт" },
    FALSE_POSITIVE: { cls: "badge-fp",             lbl: "Ложный" },
  };
  const v = m[status] ?? { cls: "badge-info", lbl: status };
  return <span className={v.cls}>{v.lbl}</span>;
}
