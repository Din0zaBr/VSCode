import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

type ReportType = "incidents" | "threats" | "agents" | "access";

interface ReportData {
  title: string;
  generatedAt: string;
  dateRange: string;
  content: React.ReactNode;
}

export default function Reports() {
  const [reportType, setReportType] = useState<ReportType>("incidents");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["stats", fromDate, toDate],
    queryFn: () => api.stats({ from: fromDate, to: toDate }),
    enabled: !!fromDate && !!toDate,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: api.agents,
  });

  const { data: alerts } = useQuery({
    queryKey: ["correlation-alerts"],
    queryFn: () => api.correlationAlerts({ limit: 1000 }),
  });

  const generateReport = async () => {
    setGenerating(true);
    try {
      let content: React.ReactNode;
      let title: string;

      switch (reportType) {
        case "incidents": {
          const alertCount = alerts?.alerts?.length ?? 0;
          const critical = alerts?.alerts?.filter((a) => a.severity === "CRITICAL").length ?? 0;
          const high = alerts?.alerts?.filter((a) => a.severity === "HIGH").length ?? 0;
          content = (
            <div className="space-y-6">
              <div className="grid grid-cols-4 gap-4">
                <div className="siem-card p-4">
                  <div className="text-2xl font-bold" style={{ color: "#a78bfa" }}>{alertCount}</div>
                  <div className="text-xs text-gray-500 mt-1">Всего алертов</div>
                </div>
                <div className="siem-card p-4">
                  <div className="text-2xl font-bold text-red-400">{critical}</div>
                  <div className="text-xs text-gray-500 mt-1">Критических</div>
                </div>
                <div className="siem-card p-4">
                  <div className="text-2xl font-bold text-orange-400">{high}</div>
                  <div className="text-xs text-gray-500 mt-1">Высоких</div>
                </div>
                <div className="siem-card p-4">
                  <div className="text-2xl font-bold text-purple-300">0</div>
                  <div className="text-xs text-gray-500 mt-1">Разрешено</div>
                </div>
              </div>
              <div className="siem-card p-4">
                <h3 className="text-sm font-semibold mb-3">Алерты по правилам</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {(alerts?.alerts ?? []).slice(0, 20).map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-xs p-2 rounded" style={{ background: "rgba(167,139,250,0.1)" }}>
                      <span className="truncate">{a.rule_name}</span>
                      <span className={`badge-${a.severity.toLowerCase()}`}>{a.severity}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
          title = "Отчёт по инцидентам";
          break;
        }

        case "threats": {
          const topRules = (alerts?.alerts ?? [])
            .reduce((acc, a) => {
              const idx = acc.findIndex((x) => x.name === a.rule_name);
              if (idx >= 0) acc[idx].count++;
              else acc.push({ name: a.rule_name, count: 1, severity: a.severity });
              return acc;
            }, [] as Array<{ name: string; count: number; severity: string }>)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

          content = (
            <div className="space-y-4">
              <div className="siem-card p-4">
                <h3 className="text-sm font-semibold mb-3">Топ угроз на неделю</h3>
                <div className="space-y-2">
                  {topRules.map((r) => (
                    <div key={r.name} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1">{r.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`badge-${r.severity.toLowerCase()}`}>{r.severity}</span>
                        <span className="font-bold" style={{ color: "#a78bfa" }}>{r.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
          title = "Топ угроз";
          break;
        }

        case "agents": {
          content = (
            <div className="siem-card p-4">
              <h3 className="text-sm font-semibold mb-3">Активность агентов</h3>
              <div className="overflow-x-auto">
                <table className="siem-table w-full text-xs">
                  <thead>
                    <tr>
                      <th>Агент</th>
                      <th>Хост</th>
                      <th>Статус</th>
                      <th>События</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(agents ?? []).map((a) => (
                      <tr key={a.agent_id}>
                        <td className="font-mono">{a.agent_id}</td>
                        <td>{a.host}</td>
                        <td>
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ background: a.active ? "#22c55e" : "#6b7280" }}
                            />
                            {a.active ? "Онлайн" : "Офлайн"}
                          </span>
                        </td>
                        <td>{a.doc_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
          title = "Активность агентов";
          break;
        }

        case "access": {
          content = (
            <div className="siem-card p-4">
              <h3 className="text-sm font-semibold mb-3">Аудит доступа</h3>
              <p className="text-xs text-gray-500">Попытки входа и изменения прав доступа</p>
              <div className="mt-3">
                <div className="text-2xl font-bold" style={{ color: "#a78bfa" }}>
                  {stats?.by_level?.find((l) => l.key === "ERROR")?.doc_count ?? 0}
                </div>
                <div className="text-xs text-gray-500">Ошибки аутентификации</div>
              </div>
            </div>
          );
          title = "Аудит доступа";
          break;
        }
      }

      setReport({
        title,
        generatedAt: new Date().toLocaleString("ru-RU"),
        dateRange: `${fromDate} — ${toDate}`,
        content,
      });
    } finally {
      setGenerating(false);
    }
  };

  const exportHTML = () => {
    if (!report) return;
    const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>${report.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #333; margin: 0 0 10px 0; }
    .meta { font-size: 12px; color: #888; margin-bottom: 30px; }
    .card { border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 6px; }
    .metric { display: inline-block; margin-right: 30px; }
    .metric-value { font-size: 28px; font-weight: bold; color: #8b5cf6; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f9f9f9; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${report.title}</h1>
    <div class="meta">Создан: ${report.generatedAt} | Период: ${report.dateRange}</div>
    <div class="card">${document.getElementById("report-content")?.innerHTML || ""}</div>
  </div>
</body>
</html>
    `;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${reportType}-${new Date().toISOString().split("T")[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 mb-1">Отчёты</h2>
        <p className="text-sm text-gray-500">Аналитика и статистика SIEM</p>
      </div>

      {/* Controls */}
      <div className="siem-card p-4 space-y-4">
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-gray-500 uppercase block mb-2">Тип отчёта</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="siem-input w-full"
            >
              <option value="incidents">Отчёт по инцидентам</option>
              <option value="threats">Топ угроз</option>
              <option value="agents">Активность агентов</option>
              <option value="access">Аудит доступа</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase block mb-2">С даты</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="siem-input w-full"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase block mb-2">По дату</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="siem-input w-full"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={generateReport}
              disabled={generating}
              className="siem-btn text-xs px-4 py-2 flex-1"
            >
              {generating ? "Генерация..." : "Создать"}
            </button>
          </div>
        </div>
      </div>

      {/* Report */}
      {report && (
        <div className="siem-card p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-purple-900/50 pb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-100">{report.title}</h3>
              <div className="text-xs text-gray-500 mt-1">
                Период: {report.dateRange} | Создан: {report.generatedAt}
              </div>
            </div>
            <button
              onClick={exportHTML}
              className="siem-btn text-xs px-4 py-2"
            >
              ⬇ HTML
            </button>
          </div>
          <div id="report-content">{report.content}</div>
        </div>
      )}
    </div>
  );
}
