import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, type UserInfo, type AgentInfo } from "../api/client";

export default function Users() {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const { data: allAgents = [] } = useQuery({ queryKey: ["agents"], queryFn: api.agents });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "operator" });
  const [editingAgents, setEditingAgents] = useState<number | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  const createMut = useMutation({
    mutationFn: () => api.createUser(form.username, form.password, form.role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("Пользователь создан");
      setShowForm(false);
      setForm({ username: "", password: "", role: "operator" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("Пользователь удалён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => api.updateUserRole(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("Роль обновлена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const agentsMut = useMutation({
    mutationFn: ({ id, agents }: { id: number; agents: string[] }) => api.setUserAgents(id, agents),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("Агенты назначены");
      setEditingAgents(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openAgentsEditor = (user: UserInfo) => {
    setEditingAgents(user.id);
    setSelectedAgents([...user.agents]);
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) =>
      prev.includes(agentId) ? prev.filter((a) => a !== agentId) : [...prev, agentId],
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-100">Управление пользователями</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? "Отмена" : "Новый пользователь"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}
          className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-gray-300">Создание пользователя</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Логин</label>
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200
                           focus:outline-none focus:border-vault-500"
                placeholder="operator1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Пароль</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200
                           focus:outline-none focus:border-vault-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Роль</label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200
                           focus:outline-none focus:border-vault-500"
              >
                <option value="operator">Оператор</option>
                <option value="admin">Администратор</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={createMut.isPending}
            className="px-6 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium
                       transition-colors disabled:opacity-50"
          >
            {createMut.isPending ? "Создание..." : "Создать"}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">Загрузка...</div>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs uppercase tracking-wider border-b border-gray-800">
                <th className="px-4 py-3">Пользователь</th>
                <th className="px-4 py-3">Роль</th>
                <th className="px-4 py-3">Назначенные агенты</th>
                <th className="px-4 py-3">Создан</th>
                <th className="px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-mono text-vault-300">{u.username}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => roleMut.mutate({ id: u.id, role: e.target.value })}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200
                                 focus:outline-none focus:border-vault-500"
                    >
                      <option value="admin">Администратор</option>
                      <option value="operator">Оператор</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === "operator" ? (
                      <div className="flex items-center gap-2">
                        <div className="flex flex-wrap gap-1">
                          {u.agents.length > 0 ? (
                            u.agents.map((a) => (
                              <span key={a} className="bg-vault-600/20 text-vault-300 px-2 py-0.5 rounded text-xs">
                                {a}
                              </span>
                            ))
                          ) : (
                            <span className="text-gray-600 text-xs">нет агентов</span>
                          )}
                        </div>
                        <button
                          onClick={() => openAgentsEditor(u)}
                          className="text-xs text-vault-400 hover:text-vault-300 shrink-0"
                        >
                          Изменить
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-500 text-xs">все (админ)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(u.created_at).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteMut.mutate(u.id)}
                      disabled={deleteMut.isPending}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingAgents !== null && (
        <AgentsModal
          userId={editingAgents}
          allAgents={allAgents}
          selected={selectedAgents}
          onToggle={toggleAgent}
          onSave={() => agentsMut.mutate({ id: editingAgents, agents: selectedAgents })}
          onClose={() => setEditingAgents(null)}
          saving={agentsMut.isPending}
        />
      )}
    </div>
  );
}

function AgentsModal({ userId, allAgents, selected, onToggle, onSave, onClose, saving }: {
  userId: number;
  allAgents: AgentInfo[];
  selected: string[];
  onToggle: (id: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-100 mb-4">Назначить агентов</h3>

        {allAgents.length === 0 ? (
          <p className="text-gray-500 text-sm">Нет доступных агентов</p>
        ) : (
          <div className="space-y-1 mb-4">
            {allAgents.map((a) => (
              <label
                key={a.agent_id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(a.agent_id)}
                  onChange={() => onToggle(a.agent_id)}
                  className="rounded bg-gray-800 border-gray-600 text-vault-500 focus:ring-vault-500"
                />
                <div>
                  <span className="text-sm text-gray-200 font-mono">{a.agent_id}</span>
                  {a.host && <span className="text-xs text-gray-500 ml-2">{a.host}</span>}
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium
                       transition-colors disabled:opacity-50"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
