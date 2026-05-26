import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api, setToken, setRole, setAllowedAgents } from "../api/client";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error("Заполните все поля");
      return;
    }
    setLoading(true);
    try {
      const data = await api.login(username, password);
      setToken(data.token);
      setRole(data.role);
      setAllowedAgents(data.agents);
      navigate("/dashboard", { replace: true });
    } catch {
      toast.error("Неверный логин или пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--bg-gradient-mid) 50%, var(--bg-gradient-end) 100%)" }}
    >
      {/* Background glow */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--accent-secondary) 18%, transparent) 0%, transparent 70%)" }}
      />

      <div className="w-full max-w-sm relative z-10">
        <div
          className="liquid-glass rounded-2xl p-8 shadow-2xl"
          style={{
            background: "color-mix(in srgb, var(--surface) 80%, transparent)",
            border: "1px solid var(--border-strong)",
            boxShadow:
              "0 0 60px color-mix(in srgb, var(--accent-secondary) 24%, transparent), inset 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-3">
              <img src="/logo_app.png" alt="URSUS" className="w-12 h-12 object-contain"
                onError={(e) => { e.currentTarget.style.display = "none"; (e.currentTarget.nextSibling as HTMLElement).style.display = "block"; }} />
              <span className="brand-bear" style={{ display: "none", fontSize: "42px" }}>🐻</span>
              <div className="text-left">
                <div className="brand-name text-xl leading-none" style={{ color: "var(--accent)" }}>URSUS</div>
                <div className="text-[10px] tracking-[0.3em] font-light leading-none brand-mono" style={{ color: "var(--accent-secondary)" }}>INSIGHT</div>
              </div>
            </div>
            <p className="text-xs mt-2 brand-mono uppercase" style={{ color: "var(--text-soft)", letterSpacing: "0.15em" }}>
              Security Information &amp; Event Management
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-soft)" }}>Логин</label>
              <input
                type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoFocus
                className="siem-input w-full py-2.5"
                placeholder="admin"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-soft)" }}>Пароль</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="siem-input w-full py-2.5"
                placeholder="••••••••"
              />
            </div>
            <button type="submit" disabled={loading}
              className="w-full siem-btn py-2.5 mt-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold">
              {loading ? "Вход..." : "Войти"}
            </button>
          </form>

          <div className="mt-6 text-center text-[10px]" style={{ color: "var(--border-strong)" }}>
            URSUS Insight SIEM · Protected Access
          </div>
        </div>
      </div>
    </div>
  );
}
