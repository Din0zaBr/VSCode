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
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #08090e 0%, #0d0a18 50%, #090e10 100%)" }}>
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(106,13,173,0.12) 0%, transparent 70%)" }} />

      <div className="w-full max-w-sm relative z-10">
        <div className="rounded-2xl p-8 shadow-2xl" style={{ background: "#0d0f18", border: "1px solid #2d1860", boxShadow: "0 0 60px rgba(106,13,173,0.2)" }}>
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-3">
              <img src="/logo.png" alt="URSUS" className="w-10 h-10 object-contain"
                onError={(e) => { e.currentTarget.style.display = "none"; (e.currentTarget.nextSibling as HTMLElement).style.display = "block"; }} />
              <span style={{ display: "none", fontSize: "36px" }}>🐻</span>
              <div className="text-left">
                <div className="text-xl font-bold tracking-widest leading-none" style={{ color: "#BF40BF" }}>URSUS</div>
                <div className="text-[10px] tracking-[0.3em] font-light leading-none" style={{ color: "#6A0DAD" }}>INSIGHT</div>
              </div>
            </div>
            <p className="text-xs mt-2" style={{ color: "#64748b" }}>
              Security Information & Event Management
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "#64748b" }}>Логин</label>
              <input
                type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoFocus
                className="siem-input w-full py-2.5"
                placeholder="admin"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "#64748b" }}>Пароль</label>
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

          <div className="mt-6 text-center text-[10px]" style={{ color: "#2d1860" }}>
            URSUS Insight SIEM · Protected Access
          </div>
        </div>
      </div>
    </div>
  );
}
