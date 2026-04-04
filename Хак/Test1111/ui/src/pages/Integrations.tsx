import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

const CATEGORY_LABELS: Record<string, string> = {
  edr: "EDR", sandbox: "Sandbox", nta: "NTA", syslog: "Syslog", cef: "CEF",
  soar: "SOAR", firewall: "Firewall", av: "Antivirus",
};

export default function Integrations() {
  const { data: integrations, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: api.listIntegrations,
    refetchInterval: 60_000,
  });

  const { data: adStatus } = useQuery({
    queryKey: ["ad-status"],
    queryFn: api.adStatus,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-100">Интеграции</h2>

      {/* AD Status */}
      <div>
        <h3 className="text-lg font-semibold text-gray-200 mb-3">Active Directory</h3>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${adStatus?.connected ? "bg-green-500" : adStatus?.configured ? "bg-yellow-500" : "bg-gray-600"}`} />
            <div>
              <div className="text-sm font-medium text-gray-200">
                {adStatus?.configured ? `${adStatus.domain} (${adStatus.server})` : "Не настроен"}
              </div>
              <div className="text-xs text-gray-500">
                {adStatus?.connected ? "Подключено" : adStatus?.configured ? "Настроен, не подключён" : "Интеграция отключена"}
              </div>
            </div>
            <div className="ml-auto">
              <span className="text-xs px-2 py-1 bg-gray-700 text-gray-400 rounded">LDAP</span>
            </div>
          </div>
        </div>
      </div>

      {/* Vendor integrations */}
      <div>
        <h3 className="text-lg font-semibold text-gray-200 mb-3">Вендорские интеграции</h3>
        {isLoading && <div className="text-center text-gray-500 py-8">Загрузка...</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(integrations ?? []).map((intg: any) => (
            <div key={intg.name} className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-100">{intg.name}</div>
                  <div className="text-xs text-gray-500">{intg.vendor}</div>
                </div>
                <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-400 rounded">
                  {CATEGORY_LABELS[intg.category] ?? intg.category}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${intg.connected ? "bg-green-500" : intg.configured ? "bg-yellow-500" : "bg-gray-600"}`} />
                <span className="text-xs text-gray-400">
                  {intg.connected ? "Подключено" : intg.configured ? "Настроено" : "Не настроено"}
                </span>
              </div>
              <div className="flex gap-2">
                <button className="flex-1 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors" disabled>
                  Настроить
                </button>
                <button className="flex-1 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors" disabled>
                  Тест
                </button>
              </div>
            </div>
          ))}
          {!isLoading && !integrations?.length && (
            <div className="col-span-3 text-center text-gray-500 py-8">Нет интеграций</div>
          )}
        </div>
      </div>
    </div>
  );
}
