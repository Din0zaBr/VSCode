import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, isAdmin } from "../api/client";
import type { KnownAccount } from "../api/client";

const RISK_COLORS: Record<string, string> = {
  CRITICAL: "text-red-400",
  HIGH: "text-orange-400",
  ELEVATED: "text-yellow-400",
  NORMAL: "text-purple-300",
};

export default function Accounts() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editAccount, setEditAccount] = useState<KnownAccount | null>(null);
  const [form, setForm] = useState({ username: "", domain: "", display_name: "", email: "", department: "", role: "", risk_level: "NORMAL", is_service_account: false, is_privileged: false, notes: "" });
  const size = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["accounts", page, search, domain, riskLevel],
    queryFn: () => api.listAccounts({ page, size, search, domain, risk_level: riskLevel }),
  });

  const saveMutation = useMutation({
    mutationFn: (d: typeof form) => editAccount ? api.updateAccount(editAccount.id, d) : api.createAccount(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); setShowForm(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  const discoverMutation = useMutation({
    mutationFn: api.discoverAccounts,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  const openCreate = () => { setEditAccount(null); setForm({ username: "", domain: "", display_name: "", email: "", department: "", role: "", risk_level: "NORMAL", is_service_account: false, is_privileged: false, notes: "" }); setShowForm(true); };
  const openEdit = (a: KnownAccount) => {
    setEditAccount(a);
    setForm({ username: a.username, domain: a.domain ?? "", display_name: a.display_name ?? "", email: a.email ?? "", department: a.department ?? "", role: a.role ?? "", risk_level: a.risk_level, is_service_account: a.is_service_account, is_privileged: a.is_privileged, notes: a.notes ?? "" });
    setShowForm(true);
  };

  const totalPages = data ? Math.ceil(data.total / size) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="siem-page-title">Учётные записи</h2>
        {isAdmin() && (
          <div className="flex gap-2">
            <button type="button" onClick={() => discoverMutation.mutate()} disabled={discoverMutation.isPending} className="siem-btn-ghost text-sm px-4 py-2 disabled:opacity-50">
              {discoverMutation.isPending ? "Обнаружение..." : "Авто-обнаружение"}
            </button>
            <button onClick={openCreate} className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors">+ Добавить</button>
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Поиск по имени..." className="siem-input text-sm w-48" />
        <input value={domain} onChange={(e) => { setDomain(e.target.value); setPage(1); }} placeholder="Домен" className="siem-input text-sm w-36" />
        <select value={riskLevel} onChange={(e) => { setRiskLevel(e.target.value); setPage(1); }} className="siem-input text-sm min-w-[180px]">
          <option value="">Все risk уровни</option>
          {["CRITICAL", "HIGH", "ELEVATED", "NORMAL"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="siem-card rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold siem-fg">{editAccount ? "Редактировать" : "Новая учётная запись"}</h3>
          <div className="grid grid-cols-2 gap-4">
            {(["username", "domain", "display_name", "email", "department", "role"] as const).map((f) => (
              <div key={f}>
                <label className="text-xs siem-fg-soft mb-1 block">{f.replace("_", " ")}</label>
                <input value={form[f]} onChange={(e) => setForm((d) => ({ ...d, [f]: e.target.value }))} className="siem-input w-full text-sm" />
              </div>
            ))}
            <div>
              <label className="text-xs siem-fg-soft mb-1 block">Risk Level</label>
              <select value={form.risk_level} onChange={(e) => setForm((d) => ({ ...d, risk_level: e.target.value }))} className="siem-input w-full text-sm">
                {["CRITICAL", "HIGH", "ELEVATED", "NORMAL"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex gap-4 items-center pt-4">
              <label className="flex items-center gap-2 text-sm siem-fg-muted cursor-pointer">
                <input type="checkbox" checked={form.is_service_account} onChange={(e) => setForm((d) => ({ ...d, is_service_account: e.target.checked }))} className="h-4 w-4 rounded border" style={{ borderColor: "var(--border)", accentColor: "var(--accent-secondary)" }} />
                Сервисный аккаунт
              </label>
              <label className="flex items-center gap-2 text-sm siem-fg-muted cursor-pointer">
                <input type="checkbox" checked={form.is_privileged} onChange={(e) => setForm((d) => ({ ...d, is_privileged: e.target.checked }))} className="h-4 w-4 rounded border" style={{ borderColor: "var(--border)", accentColor: "var(--accent-secondary)" }} />
                Привилегированный
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="siem-btn text-sm disabled:opacity-50">Сохранить</button>
            <button type="button" onClick={() => setShowForm(false)} className="siem-btn-ghost text-sm">Отмена</button>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center siem-fg-soft py-12">Загрузка...</div>}

      <div className="overflow-auto rounded-lg siem-card p-0">
        <table className="w-full text-sm siem-table">
          <thead>
            <tr>
              {["Пользователь", "Домен", "Email", "Отдел", "Risk", "Тип", "Последний раз", ""].map((h) => (
                <th key={h} className="px-4 py-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.accounts ?? []).map((a: KnownAccount) => (
              <tr key={a.id}>
                <td className="px-4 py-2 siem-fg font-mono text-xs">{a.username}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.domain}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.email}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.department}</td>
                <td className={`px-4 py-2 text-xs font-medium ${RISK_COLORS[a.risk_level] ?? "siem-fg-soft"}`}>{a.risk_level}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.is_privileged ? "🔑 Привил." : a.is_service_account ? "⚙️ Серв." : "—"}</td>
                <td className="px-4 py-2 siem-fg-soft text-xs">{a.last_seen ? new Date(a.last_seen).toLocaleString("ru") : "—"}</td>
                <td className="px-4 py-2">
                  {isAdmin() && (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openEdit(a)} className="siem-btn-ghost text-xs px-2 py-1">✏️</button>
                      <button type="button" onClick={() => deleteMutation.mutate(a.id)} className="px-2 py-1 text-xs rounded border border-red-500/35 text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/15 transition-colors">🗑</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !data?.accounts?.length && (
              <tr><td colSpan={8} className="text-center siem-fg-soft py-8">Нет учётных записей</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="siem-btn-ghost text-sm px-3 py-1.5 disabled:opacity-40">Prev</button>
          <span className="text-sm siem-fg-soft">Стр. {page} / {totalPages}</span>
          <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="siem-btn-ghost text-sm px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
