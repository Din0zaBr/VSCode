import { useState } from "react";

interface CustomField {
  id: string;
  name: string;
  label: string;
  type: "text" | "textarea" | "dropdown" | "date" | "number" | "checkbox";
  options?: string[];
  required: boolean;
  description: string;
  created_at: string;
}

export default function CustomFieldsAdmin() {
  const FIELDS_KEY = "ursus_custom_fields";
  const [fields, setFields] = useState<CustomField[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(FIELDS_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomField>({
    id: "",
    name: "",
    label: "",
    type: "text",
    required: false,
    description: "",
    created_at: new Date().toISOString(),
  });

  const saveFields = (updated: CustomField[]) => {
    setFields(updated);
    localStorage.setItem(FIELDS_KEY, JSON.stringify(updated));
  };

  const handleNew = () => {
    setForm({
      id: `field-${Date.now()}`,
      name: "",
      label: "",
      type: "text",
      required: false,
      description: "",
      created_at: new Date().toISOString(),
    });
    setEditId(null);
    setShowForm(true);
  };

  const handleEdit = (f: CustomField) => {
    setForm({ ...f });
    setEditId(f.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || !form.label) return;
    if (editId) {
      saveFields(fields.map((f) => (f.id === editId ? form : f)));
    } else {
      saveFields([form, ...fields]);
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    if (confirm("Удалить поле?")) {
      saveFields(fields.filter((f) => f.id !== id));
    }
  };

  const TYPE_LABELS: Record<CustomField["type"], string> = {
    text: "Текст",
    textarea: "Текст (многострочный)",
    dropdown: "Выпадающий список",
    date: "Дата",
    number: "Число",
    checkbox: "Флажок",
  };

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 mb-1">Пользовательские поля</h2>
        <p className="text-sm text-gray-500">Управление дополнительными полями для инцидентов и сценариев</p>
      </div>

      {/* Fields list */}
      <div className="space-y-3">
        {fields.length === 0 ? (
          <div className="siem-card p-6 text-center">
            <div className="text-gray-600 text-sm mb-4">Нет пользовательских полей</div>
            <button onClick={handleNew} className="siem-btn text-xs px-4 py-2">
              + Создать поле
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-300">Поля ({fields.length})</span>
              <button onClick={handleNew} className="siem-btn text-xs px-4 py-2">
                + Новое поле
              </button>
            </div>
            {fields.map((f) => (
              <div key={f.id} className="siem-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-gray-200">{f.label}</h3>
                      {f.required && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(248,81,73,0.12)", color: "#f87171" }}
                        >
                          обязательно
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-600 space-y-0.5">
                      <div>
                        Ключ: <span style={{ color: "#a78bfa", fontFamily: "monospace" }}>{f.name}</span>
                      </div>
                      <div>Тип: {TYPE_LABELS[f.type]}</div>
                      {f.description && <div>{f.description}</div>}
                      {f.options && f.options.length > 0 && (
                        <div>Варианты: {f.options.join(", ")}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleEdit(f)}
                      className="siem-btn-ghost text-xs px-3 py-1.5"
                    >
                      Редактировать
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="text-xs px-3 py-1.5 rounded-lg"
                      style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowForm(false)}
        >
          <div
            className="siem-card w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-lg font-semibold text-gray-200">
                {editId ? "Редактировать поле" : "Новое поле"}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-gray-600 hover:text-gray-400">
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase block mb-2">Название поля (ключ)</label>
                  <input
                    className="siem-input w-full text-sm font-mono"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value.replace(/\s+/g, "_").toLowerCase() })}
                    placeholder="field_name"
                  />
                  <div className="text-[10px] text-gray-600 mt-1">
                    Использование: custom_field[{form.name}]
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase block mb-2">Название для отображения</label>
                  <input
                    className="siem-input w-full text-sm"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="Название поля"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase block mb-2">Тип данных</label>
                  <select
                    className="siem-input w-full text-sm"
                    value={form.type}
                    onChange={(e) => {
                      const newType = e.target.value as CustomField["type"];
                      setForm({ ...form, type: newType, options: newType === "dropdown" ? [""] : undefined });
                    }}
                  >
                    <option value="text">Текст</option>
                    <option value="textarea">Текст (многострочный)</option>
                    <option value="dropdown">Выпадающий список</option>
                    <option value="date">Дата</option>
                    <option value="number">Число</option>
                    <option value="checkbox">Флажок</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={form.required}
                      onChange={(e) => setForm({ ...form, required: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-xs text-gray-400">Обязательное поле</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase block mb-2">Описание</label>
                <textarea
                  className="siem-input w-full text-sm resize-none"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Описание для пользователя"
                />
              </div>

              {form.type === "dropdown" && (
                <div>
                  <label className="text-xs text-gray-500 uppercase block mb-2">Варианты (по одному на строку)</label>
                  <textarea
                    className="siem-input w-full text-sm resize-none font-mono"
                    rows={3}
                    value={(form.options ?? []).join("\n")}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        options: e.target.value
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="Вариант 1&#10;Вариант 2&#10;Вариант 3"
                  />
                </div>
              )}

              {form.type === "dropdown" && form.options && form.options.length > 0 && (
                <div className="bg-purple-900/20 p-3 rounded">
                  <div className="text-xs font-semibold text-gray-300 mb-2">Предпросмотр:</div>
                  <div className="space-y-1">
                    {form.options.map((opt, i) => (
                      <div key={i} className="text-sm text-gray-400">
                        • {opt}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setShowForm(false)} className="siem-btn-ghost text-xs px-4 py-2">
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name || !form.label}
                className="siem-btn text-xs px-4 py-2 disabled:opacity-50"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
