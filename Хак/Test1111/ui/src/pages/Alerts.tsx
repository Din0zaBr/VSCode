import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, isAdmin, type AlertRule, type AlertChannel } from "../api/client";

const EMPTY_CHANNEL: AlertChannel = { type: "webhook", webhook_url: "" };

const EMPTY_RULE: Partial<AlertRule> = {
  name: "",
  enabled: true,
  condition_type: "threshold",
  threshold: 10,
  window_minutes: 5,
  regex_pattern: "",
  level: "ERROR",
  channels: [{ ...EMPTY_CHANNEL }],
};

export default function Alerts() {
  const queryClient = useQueryClient();
  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: api.alertRules,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Правило удалено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: (rule: Partial<AlertRule>) => api.createAlert(rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Правило создано");
      setShowForm(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<AlertRule>>({ ...EMPTY_RULE });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) {
      toast.error("Имя обязательно");
      return;
    }
    createMut.mutate(form);
  };

  const updateChannel = (idx: number, patch: Partial<AlertChannel>) => {
    setForm((f) => {
      const channels = [...(f.channels ?? [])];
      channels[idx] = { ...channels[idx], ...patch };
      return { ...f, channels };
    });
  };

  const addChannel = () => {
    setForm((f) => ({ ...f, channels: [...(f.channels ?? []), { ...EMPTY_CHANNEL }] }));
  };

  const removeChannel = (idx: number) => {
    setForm((f) => ({ ...f, channels: (f.channels ?? []).filter((_, i) => i !== idx) }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-100">Правила алертов</h2>
        {isAdmin() && (
          <button
            onClick={() => {
              setForm({ ...EMPTY_RULE, channels: [{ ...EMPTY_CHANNEL }] });
              setShowForm(!showForm);
            }}
            className="px-4 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {showForm ? "Отмена" : "Новое правило"}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300">Создание правила алерта</h3>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Имя">
              <input
                value={form.name ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="input-field"
                placeholder="Например, высокая скорость ошибок"
              />
            </Field>
            <Field label="Тип лога">
              <select
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                className="input-field"
              >
                {["ERROR", "CRITICAL", "WARN", "INFO", "DEBUG"].map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Условие">
              <select
                value={form.condition_type}
                onChange={(e) => setForm((f) => ({ ...f, condition_type: e.target.value as "threshold" | "regex" }))}
                className="input-field"
              >
                <option value="threshold">Пороговое значение</option>
                <option value="regex">Регулярное выражение</option>
              </select>
            </Field>
            {form.condition_type === "threshold" ? (
              <>
                <Field label="Пороговое значение (количество)">
                  <input
                    type="number"
                    min={1}
                    value={form.threshold}
                    onChange={(e) => setForm((f) => ({ ...f, threshold: +e.target.value }))}
                    className="input-field"
                  />
                </Field>
                <Field label="Временной интервал (минуты)">
                  <input
                    type="number"
                    min={1}
                    value={form.window_minutes}
                    onChange={(e) => setForm((f) => ({ ...f, window_minutes: +e.target.value }))}
                    className="input-field"
                  />
                </Field>
              </>
            ) : (
              <Field label="Регулярное выражение" className="col-span-2">
                <input
                  value={form.regex_pattern ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, regex_pattern: e.target.value }))}
                  className="input-field"
                  placeholder="Например, OutOfMemory|Segfault|OutOfMemoryError"
                />
              </Field>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Каналы для уведомлений</span>
              <button type="button" onClick={addChannel} className="text-xs text-vault-400 hover:text-vault-300">
                + Добавить канал для уведомлений
              </button>
            </div>
            {(form.channels ?? []).map((ch, idx) => (
              <div key={idx} className="bg-gray-800/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <select
                    value={ch.type}
                    onChange={(e) => updateChannel(idx, { type: e.target.value as "webhook" | "telegram" })}
                    className="input-field w-40"
                  >
                    <option value="webhook">Вебхук</option>
                    <option value="telegram">Телеграм</option>
                  </select>
                  {(form.channels ?? []).length > 1 && (
                    <button type="button" onClick={() => removeChannel(idx)} className="text-xs text-red-400 hover:text-red-300">
                      Удалить канал для уведомлений
                    </button>
                  )}
                </div>
                {ch.type === "webhook" ? (
                  <input
                    placeholder="https://hooks.example.com/..."
                    value={ch.webhook_url ?? ""}
                    onChange={(e) => updateChannel(idx, { webhook_url: e.target.value })}
                    className="input-field w-full"
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      placeholder="Bot Token"
                      value={ch.telegram_token ?? ""}
                      onChange={(e) => updateChannel(idx, { telegram_token: e.target.value })}
                      className="input-field"
                    />
                    <input
                      placeholder="Chat ID"
                      value={ch.telegram_chat_id ?? ""}
                      onChange={(e) => updateChannel(idx, { telegram_chat_id: e.target.value })}
                      className="input-field"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="rounded bg-gray-800 border-gray-600 text-vault-500 focus:ring-vault-500"
              />
              Включено
            </label>
          </div>

          <button
            type="submit"
            disabled={createMut.isPending}
            className="px-6 py-2 bg-vault-600 hover:bg-vault-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {createMut.isPending ? "Создание..." : "Создать правило"}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">Загрузка правил...</div>
      ) : rules.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          Нет настроенных правил алертов. Создайте одно, чтобы начать.
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule: AlertRule) => (
            <div
              key={rule.id}
              className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${rule.enabled ? "bg-green-400" : "bg-gray-600"}`} />
                  <span className="text-sm font-medium text-gray-200">{rule.name || rule.id}</span>
                  <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                    {rule.condition_type}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {rule.condition_type === "threshold"
                    ? `${rule.level} > ${rule.threshold} in ${rule.window_minutes}min`
                    : `Regex: ${rule.regex_pattern}`}
                  {" | "}
                  {(rule.channels ?? []).map((c) => c.type).join(", ") || "нет каналов"}
                </div>
              </div>
              {isAdmin() && (
                <button
                  onClick={() => deleteMut.mutate(rule.id)}
                  disabled={deleteMut.isPending}
                  className="text-sm text-red-400 hover:text-red-300 transition-colors px-3 py-1"
                >
                  Удалить
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .input-field {
          background: #111827;
          border: 1px solid #374151;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #e5e7eb;
          outline: none;
          width: 100%;
          transition: border-color 0.15s;
        }
        .input-field:focus {
          border-color: #4c6ef5;
        }
        .input-field::placeholder {
          color: #6b7280;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children, className = "" }: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs text-gray-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
