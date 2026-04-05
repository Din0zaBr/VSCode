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
const LOGO_PATH = "/logo.png"; // если файл отсутствует — покажем мишку
function SiemLogo() {
  return (
    <div className="flex items-center gap-2 select-none flex-shrink-0">
      <img
        src={LOGO_PATH}
        alt="URSUS Insight"
        className="w-7 h-7 object-contain"
        onError={(e) => {
          const el = e.currentTarget;
          el.style.display = "none";
          const span = el.nextElementSibling as HTMLElement | null;
          if (span) span.style.display = "inline";
        }}
      />
      <span style={{ display: "none", fontSize: "24px" }} role="img" aria-label="bear">🐻</span>
      <div className="leading-none">
        <div className="text-sm font-bold tracking-widest" style={{ color: "#BF40BF" }}>URSUS</div>
        <div className="text-[9px] tracking-[0.2em] font-light" style={{ color: "#8b20d1" }}>INSIGHT</div>
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
    <div className="min-h-screen flex flex-col" style={{ background: "#08090e" }}>
      {/* ── Top Header ──────────────────────────────────────────────────── */}
      <header
        className="flex items-center gap-4 px-4 py-0 flex-shrink-0"
        style={{
          background: "linear-gradient(90deg, #08090e 0%, #0f0d1a 50%, #090e10 100%)",
          borderBottom: "1px solid #1a0d2e",
          height: "52px",
        }}
      >
        {/* Logo */}
        <button onClick={() => navigate("/dashboard")} className="flex items-center">
          <SiemLogo />
        </button>

        <div className="w-px h-6 flex-shrink-0" style={{ background: "#2d1860" }} />

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
                  color: active ? "#BF40BF" : "#94a3b8",
                  background: active ? "rgba(106,13,173,0.12)" : "transparent",
                  borderBottom: active ? "2px solid #BF40BF" : "2px solid transparent",
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
              color: isActive ? "#BF40BF" : "#64748b",
              background: isActive ? "rgba(106,13,173,0.12)" : "transparent",
              borderBottom: isActive ? "2px solid #BF40BF" : "2px solid transparent",
            })}
          >
            Дашборд
          </NavLink>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span
            className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-medium"
            style={{ background: "rgba(106,13,173,0.2)", color: "#8b20d1", border: "1px solid #2d1860" }}
          >
            {role}
          </span>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ color: "#64748b", border: "1px solid #1a0d2e" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.borderColor = "#7f1d1d"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#64748b"; e.currentTarget.style.borderColor = "#1a0d2e"; }}
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
