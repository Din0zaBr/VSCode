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

const INTERVALS = [
  { label: "15м", value: "15m" },
  { label: "1ч",  value: "1h" },
  { label: "6ч",  value: "6h" },
  { label: "1д",  value: "1d" },
  { label: "7д",  value: "7d" },
];

const LEVEL_PIE_CFG = [
  { key: "CRITICAL", color: "#ef4444" },
  { key: "ERROR",    color: "#f97316" },
  { key: "WARNING",  color: "#eab308" },
  { key: "WARN",     color: "#facc15" },
  { key: "INFO",     color: "#6A0DAD" },
  { key: "DEBUG",    color: "#2F4F4F" },
];

const SEV_PIE_CFG = [
  { name: "CRITICAL", color: "#ef4444" },
  { name: "HIGH",     color: "#f97316" },
  { name: "MEDIUM",   color: "#eab308" },
  { name: "LOW",      color: "#3b82f6" },
];

function SiemTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-xl"
      style={{ background: "#0d0f18", borderColor: "#2d1860" }}>
      {label && <div className="text-gray-500 mb-1 pb-1 border-b" style={{ borderColor: "#1a0d2e" }}>{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mt-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span style={{ color: "#94a3b8" }}>{p.name}:</span>
          <span className="text-gray-200 font-semibold">{(p.value ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [interval, setInterval] = useState("1h");

  const { data, isLoading } = useQuery({
    queryKey: ["stats", interval],
    queryFn: () => api.stats({ interval }),
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
  const minMap: Record<string, number> = { "15m": 15, "1h": 60, "6h": 360, "1d": 1440, "7d": 10080 };
  const avgFlow = totalLogs > 0 ? (totalLogs / (minMap[interval] ?? 60)).toFixed(1) : "0";

  const timelineData = (data?.over_time ?? []).map((b) => {
    const byLevel = Object.fromEntries((b.by_level?.buckets ?? []).map((l) => [l.key, l.doc_count]));
    const label = new Date(b.key).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return { label, total: b.doc_count, ...byLevel };
  });

  const levelPie = LEVEL_PIE_CFG
    .map((l) => ({ name: l.key, value: data?.by_level.find((b) => b.key === l.key)?.doc_count ?? 0, color: l.color }))
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

  return (
    <div className="overflow-auto h-[calc(100vh-52px)]">
      <div className="p-6 space-y-5 max-w-[1600px]">

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-100">Панель управления</h2>
            <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>URSUS Insight · обзор системы безопасности</p>
          </div>
          <div className="flex gap-0.5 rounded-xl p-1 border" style={{ background: "#0d0f18", borderColor: "#1a0d2e" }}>
            {INTERVALS.map((iv) => (
              <button key={iv.value} onClick={() => setInterval(iv.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: interval === iv.value ? "#6A0DAD" : "transparent",
                  color:      interval === iv.value ? "#fff" : "#64748b",
                  boxShadow:  interval === iv.value ? "0 0 12px rgba(106,13,173,0.45)" : "none",
                }}>
                {iv.label}
              </button>
            ))}
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Открытых инцидентов",  val: openInc,            color: "#ef4444", glow: "#ef444420", to: "/incidents" },
            { label: "Критичных инцидентов", val: criticalInc,         color: "#f97316", glow: "#f9731620", to: "/incidents" },
            { label: "Активов",              val: totalAssets,         color: "#BF40BF", glow: "#BF40BF20", to: "/assets" },
            { label: "Активных агентов",     val: activeAgents.length, color: "#4ade80", glow: "#4ade8015", sub: `из ${agents?.length ?? 0}` },
            { label: "Поток событий",        val: avgFlow,             color: "#6A0DAD", glow: "#6A0DAD15", sub: "событий/мин", ld: isLoading },
            { label: "Открытых задач",       val: totalTasks,          color: "#eab308", glow: "#eab30815", to: "/incidents" },
          ].map((k) => (
            <div key={k.label} className="siem-card p-4 transition-transform hover:scale-[1.01]"
              style={{ borderColor: k.color + "30", boxShadow: `0 0 18px ${k.glow}`, cursor: k.to ? "pointer" : "default" }}
              onClick={k.to ? () => navigate(k.to!) : undefined}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "#64748b" }}>{k.label}</div>
              <div className="text-3xl font-bold" style={{ color: k.color }}>
                {k.ld ? <span className="animate-pulse text-gray-700">—</span> : String(k.val)}
              </div>
              {k.sub && <div className="text-[10px] mt-1" style={{ color: "#475569" }}>{k.sub}</div>}
            </div>
          ))}
        </div>

        {/* Row 1: Timeline + Level Pie */}
        <div className="grid grid-cols-3 gap-4">
          <Card title="Поток событий" sub={interval} cls="col-span-2">
            {isLoading ? <Skel h={220} /> : timelineData.length === 0 ? <Empty h={220} /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={timelineData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6A0DAD" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#6A0DAD" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gError" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a0d2e" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SiemTooltip />} />
                  <Area type="monotone" dataKey="total"    name="Всего"        stroke="#6A0DAD" strokeWidth={2}   fill="url(#gTotal)" dot={false} />
                  <Area type="monotone" dataKey="ERROR"    name="Ошибки"       stroke="#ef4444" strokeWidth={1.5} fill="url(#gError)" dot={false} />
                  <Area type="monotone" dataKey="WARNING"  name="Предупр."     stroke="#eab308" strokeWidth={1}   fill="none" strokeDasharray="4 2" dot={false} />
                  <Area type="monotone" dataKey="CRITICAL" name="Критических"  stroke="#f97316" strokeWidth={1}   fill="none" strokeDasharray="2 3" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="По уровням логов">
            {isLoading ? <Skel h={220} /> : levelPie.length === 0 ? <Empty h={220} /> : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={levelPie} cx="50%" cy="44%" innerRadius={52} outerRadius={80} dataKey="value" nameKey="name" paddingAngle={3}>
                    {levelPie.map((e, i) => <Cell key={i} fill={e.color} opacity={0.88} stroke="none" />)}
                  </Pie>
                  <Tooltip content={<SiemTooltip />} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: "#94a3b8", fontSize: 10 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        {/* Row 2: Host bar + Inc severity */}
        <div className="grid grid-cols-3 gap-4">
          <Card title="Топ источников событий" cls="col-span-2">
            {isLoading ? <Skel h={200} /> : hostBar.length === 0 ? <Empty h={200} /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hostBar} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a0d2e" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SiemTooltip />} />
                  <Bar dataKey="count" name="Событий" radius={[0, 4, 4, 0]}>
                    {hostBar.map((_, i) => (
                      <Cell key={i}
                        fill={["#BF40BF","#9a2e9a","#8b20d1","#6A0DAD","#520a88","#3a0763","#28054a","#1e0235"][i] ?? "#6A0DAD"}
                        opacity={0.9 - i * 0.04} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Инциденты по критичности">
            {incSevPie.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[200px] gap-2">
                <div className="text-4xl" style={{ color: "#1a0d2e" }}>◎</div>
                <div className="text-sm text-gray-700">Нет инцидентов</div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={incSevPie} cx="50%" cy="44%" innerRadius={45} outerRadius={72} dataKey="value" nameKey="name" paddingAngle={4}>
                    {incSevPie.map((e, i) => <Cell key={i} fill={e.color} opacity={0.85} stroke="none" />)}
                  </Pie>
                  <Tooltip content={<SiemTooltip />} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: "#94a3b8", fontSize: 10 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        {/* Row 3: Recent incidents + Agents */}
        <div className="grid grid-cols-2 gap-4">
          <Card title="Последние инциденты">
            {recentInc.length === 0 ? (
              <div className="text-center text-gray-700 py-6 text-sm">Нет инцидентов</div>
            ) : (
              <>
                {recentInc.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-2.5 border-b cursor-pointer hover:bg-purple-900/10 transition-colors rounded px-1"
                    style={{ borderColor: "#1a0d2e" }} onClick={() => navigate("/incidents")}>
                    <SevDot sev={a.severity} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-200 truncate">{a.rule_name}</div>
                      <div className="text-[10px]" style={{ color: "#64748b" }}>{new Date(a.created_at).toLocaleString("ru-RU")}</div>
                    </div>
                    <IncStatusBadge status={a.status} />
                  </div>
                ))}
                <button onClick={() => navigate("/incidents")} className="w-full text-center text-xs pt-3 pb-1" style={{ color: "#6A0DAD" }}>
                  Все инциденты →
                </button>
              </>
            )}
          </Card>

          <Card title="Состояние агентов">
            {hostGroups.size === 0 ? (
              <div className="text-center text-gray-700 py-6 text-sm">Нет агентов</div>
            ) : (
              <div className="space-y-3">
                {[...hostGroups.entries()].slice(0, 7).map(([host, ha]) => {
                  const active = ha.filter((a) => a.active).length;
                  const pct = ha.length > 0 ? (active / ha.length) * 100 : 0;
                  const barColor = pct === 100 ? "#4ade80" : pct > 50 ? "#eab308" : "#ef4444";
                  return (
                    <div key={host}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-300 truncate max-w-[180px]">{host}</span>
                        <span style={{ color: barColor }}>{active}/{ha.length}</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "#1a0d2e" }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: barColor, boxShadow: `0 0 6px ${barColor}60` }} />
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

function Card({ title, children, cls = "", sub }: { title: string; children: React.ReactNode; cls?: string; sub?: string }) {
  return (
    <div className={`siem-card p-4 ${cls}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
        {sub && <span className="text-[10px]" style={{ color: "#64748b" }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Skel({ h }: { h: number }) {
  return <div className="rounded-lg animate-pulse" style={{ background: "#111520", height: h }} />;
}

function Empty({ h }: { h: number }) {
  return <div className="flex items-center justify-center text-gray-700 text-sm" style={{ height: h }}>Нет данных</div>;
}

function SevDot({ sev }: { sev: string }) {
  const c: Record<string, string> = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308", LOW: "#3b82f6" };
  const col = c[sev] ?? "#94a3b8";
  return <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col, boxShadow: `0 0 6px ${col}80` }} />;
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
