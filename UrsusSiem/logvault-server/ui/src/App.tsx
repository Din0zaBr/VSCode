import { NavLink, Route, Routes, Navigate, useNavigate, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Events from "./pages/Events";
import Incidents from "./pages/Incidents";
import Assets from "./pages/Assets";
import DataStorage from "./pages/DataStorage";
import SystemAdmin from "./pages/SystemAdmin";
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
      <span style={{ display: "none", fontSize: "48px" }} role="img" aria-label="bear">🐻</span>
      <div className="leading-none">
        <div className="text-sm font-bold tracking-widest" style={{ color: "#58a6ff" }}>URSUS</div>
        <div className="text-[9px] tracking-[0.2em] font-light" style={{ color: "#388bfd" }}>INSIGHT</div>
      </div>
    </div>
  );
}

// ── Группы навигации ─────────────────────────────────────────────────────────

const MAIN_TABS = [
  { to: "/assets",       label: "Активы",            roles: ["admin", "operator"] },
  { to: "/events",       label: "События",           roles: ["admin", "operator"] },
  { to: "/incidents",    label: "Инциденты",         roles: ["admin", "operator"] },
  { to: "/data",         label: "Хранилище данных",  roles: ["admin", "operator"] },
  { to: "/system",       label: "Система",           roles: ["admin"] },
];

function PrivateRoute({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppLayout() {
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
    <div className="min-h-screen flex flex-col" style={{ background: "#0d1117" }}>
      {/* ── Top Header ──────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-4 px-4 py-0 flex-shrink-0"
        style={{
          background: "#161b22",
          borderBottom: "1px solid #21262d",
          height: "52px",
        }}
      >
        {/* Logo */}
        <button onClick={() => navigate("/dashboard")} className="flex items-center">
          <SiemLogo />
        </button>

        <div className="w-px h-6 flex-shrink-0" style={{ background: "#30363d" }} />

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
                  color: active ? "#58a6ff" : "#8b949e",
                  background: active ? "rgba(56,139,253,0.1)" : "transparent",
                  borderBottom: active ? "2px solid #58a6ff" : "2px solid transparent",
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
              color: isActive ? "#58a6ff" : "#6e7681",
              background: isActive ? "rgba(56,139,253,0.1)" : "transparent",
              borderBottom: isActive ? "2px solid #58a6ff" : "2px solid transparent",
            })}
          >
            Дашборд
          </NavLink>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span
            className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-medium"
            style={{ background: "rgba(56,139,253,0.12)", color: "#58a6ff", border: "1px solid rgba(56,139,253,0.25)" }}
          >
            {role}
          </span>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{ color: "#6e7681", border: "1px solid #30363d" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#f85149"; e.currentTarget.style.borderColor = "#6e1c19"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#6e7681"; e.currentTarget.style.borderColor = "#30363d"; }}
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
          <Route path="/data/*"      element={<DataStorage />} />
          {isAdmin() && <Route path="/system/*" element={<SystemAdmin />} />}
          <Route path="*"            element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <AppLayout />
          </PrivateRoute>
        }
      />
    </Routes>
  );
}
