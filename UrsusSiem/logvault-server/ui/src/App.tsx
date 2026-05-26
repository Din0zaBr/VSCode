import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate, useNavigate, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Events from "./pages/Events";
import Incidents from "./pages/Incidents";
import Assets from "./pages/Assets";
import DataStorage from "./pages/DataStorage";
import SystemAdmin from "./pages/SystemAdmin";
import Integrations from "./pages/Integrations";
import Login from "./pages/Login";
import { getToken, clearToken, isAdmin, getRole } from "./api/client";

// Bear emoji logo — используется как заглушка при отсутствии файла логотипа
const LOGO_PATH = "/logo_app.png"; // если файл отсутствует — покажем мишку
function SiemLogo() {
  return (
    <div className="flex items-center gap-2 select-none flex-shrink-0">
      <img
        src={LOGO_PATH}
        alt="URSUS Insight"
        className="w-10 h-10 object-contain"
        onError={(e) => {
          const el = e.currentTarget;
          el.style.display = "none";
          const span = el.nextElementSibling as HTMLElement | null;
          if (span) span.style.display = "inline";
        }}
      />
      <span
        className="brand-bear"
        style={{ display: "none", fontSize: "32px", lineHeight: 1 }}
        role="img"
        aria-label="bear"
      >
        🐻
      </span>
      <div className="leading-none">
        <div className="brand-name text-sm" style={{ color: "var(--accent)" }}>URSUS</div>
        <div className="text-[9px] tracking-[0.2em] font-light brand-mono" style={{ color: "var(--accent-secondary)" }}>INSIGHT</div>
      </div>
    </div>
  );
}

// ── Группы навигации ─────────────────────────────────────────────────────────

const MAIN_TABS = [
  { to: "/assets",        label: "Активы",            roles: ["admin", "operator"] },
  { to: "/events",        label: "События",           roles: ["admin", "operator"] },
  { to: "/incidents",     label: "Инциденты",         roles: ["admin", "operator"] },
  { to: "/data",          label: "Хранилище данных",  roles: ["admin", "operator"] },
  { to: "/integrations",  label: "Интеграции",        roles: ["admin"] },
  { to: "/system",        label: "Система",           roles: ["admin"] },
];

type ThemeMode = "dark" | "light" | "cyber";
const THEME_STORAGE_KEY = "ursus-theme-mode";
const THEME_ORDER: ThemeMode[] = ["cyber", "dark", "light"];
const THEME_LABELS: Record<ThemeMode, string> = {
  cyber: "Cyber",
  dark: "Dark",
  light: "Light",
};

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppLayout({ theme, onThemeCycle }: { theme: ThemeMode; onThemeCycle: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const role = getRole();

  const handleLogout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const visibleTabs = MAIN_TABS.filter((n) => n.roles.includes(role));

  // Подсветка активного раздела (учитывает вложенные пути)
  const isTabActive = (to: string) => location.pathname.startsWith(to);

  return (
    <div className="min-h-screen flex flex-col app-shell">
      {/* ── Top Header ──────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-4 px-4 py-0 flex-shrink-0"
        style={{ height: "52px" }}
      >
        {/* Logo */}
        <button onClick={() => navigate("/dashboard")} className="flex items-center">
          <SiemLogo />
        </button>

        <div className="w-px h-6 flex-shrink-0 app-separator" />

        {/* Main navigation */}
        <nav className="flex flex-1 h-full">
          {visibleTabs.map((tab) => {
            const active = isTabActive(tab.to);
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className="relative flex items-center px-4 h-full text-xs font-medium tracking-wide transition-colors"
                style={{
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  background: active ? "color-mix(in srgb, var(--accent) 13%, transparent)" : "transparent",
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                {tab.label}
              </NavLink>
            );
          })}

          {/* Dashboard link */}
          <NavLink
            to="/dashboard"
            className="relative flex items-center px-3 h-full text-xs font-medium tracking-wide transition-colors ml-auto"
            style={({ isActive }) => ({
              color: isActive ? "var(--accent)" : "var(--text-soft)",
              background: isActive ? "color-mix(in srgb, var(--accent) 13%, transparent)" : "transparent",
              borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
            })}
          >
            Дашборд
          </NavLink>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={onThemeCycle}
            className="theme-toggle-btn"
            title={`Тема: ${THEME_LABELS[theme]} → переключить`}
          >
            {THEME_LABELS[theme]}
          </button>
          <span
            className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-medium"
            style={{
              background: "color-mix(in srgb, var(--accent-secondary) 20%, transparent)",
              color: "var(--accent-secondary)",
              border: "1px solid var(--border-strong)",
            }}
          >
            {role}
          </span>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ color: "var(--text-soft)", border: "1px solid var(--border)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#7f1d1d"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-soft)"; e.currentTarget.style.borderColor = "var(--border)"; }}
          >
            Выход
          </button>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/dashboard"   element={<Dashboard />} />
          <Route path="/assets/*"    element={<Assets />} />
          <Route path="/events/*"    element={<Events />} />
          <Route path="/incidents/*" element={<Incidents />} />
          <Route path="/data/*"         element={<DataStorage />} />
          {isAdmin() && <Route path="/integrations/*" element={<Integrations />} />}
          {isAdmin() && <Route path="/system/*"       element={<SystemAdmin />} />}
          <Route path="*"            element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "cyber") return stored;
    return "cyber";
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const cycleTheme = () =>
    setTheme((prev) => {
      const idx = THEME_ORDER.indexOf(prev);
      return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    });

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <AppLayout theme={theme} onThemeCycle={cycleTheme} />
          </PrivateRoute>
        }
      />
    </Routes>
  );
}
