import { NavLink, Route, Routes, Navigate, useNavigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import LiveLogs from "./pages/LiveLogs";
import Search from "./pages/Search";
import Alerts from "./pages/Alerts";
import Users from "./pages/Users";
import Login from "./pages/Login";
import CorrelationRules from "./pages/CorrelationRules";
import CorrelationAlerts from "./pages/CorrelationAlerts";
import Assets from "./pages/Assets";
import Accounts from "./pages/Accounts";
import Exclusions from "./pages/Exclusions";
import Integrations from "./pages/Integrations";
import SystemHealth from "./pages/SystemHealth";
import { getToken, clearToken, isAdmin, getRole } from "./api/client";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Панель управления", roles: ["admin", "operator"] },
  { to: "/live", label: "Логи", roles: ["admin", "operator"] },
  { to: "/search", label: "Поиск", roles: ["admin", "operator"] },
  { to: "/alerts", label: "Алерты", roles: ["admin", "operator"] },
  { to: "/correlation/alerts", label: "Корреляция", roles: ["admin", "operator"] },
  { to: "/assets", label: "Активы", roles: ["admin", "operator"] },
  { to: "/health", label: "System Health", roles: ["admin", "operator"] },
  { to: "/users", label: "Пользователи", roles: ["admin"] },
];

const ADMIN_NAV = [
  { to: "/correlation/rules", label: "Правила корреляции" },
  { to: "/accounts", label: "Учётные записи" },
  { to: "/exclusions", label: "Исключения" },
  { to: "/integrations", label: "Интеграции" },
];

function PrivateRoute({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppLayout() {
  const navigate = useNavigate();
  const role = getRole();

  const handleLogout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  const visibleNav = NAV_ITEMS.filter((n) => n.roles.includes(role));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-4">
        <h1 className="text-lg font-bold text-vault-400 tracking-wide select-none whitespace-nowrap">
          URSUS SIEM
        </h1>
        <nav className="flex gap-0.5 flex-1 flex-wrap">
          {visibleNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-vault-600/20 text-vault-300"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
          {isAdmin() && (
            <>
              <span className="text-gray-700 self-center text-xs mx-1">|</span>
              {ADMIN_NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-vault-600/20 text-vault-300"
                        : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <span className="text-xs text-gray-600 uppercase flex-shrink-0">{role}</span>
        <button
          onClick={handleLogout}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400
                     hover:text-red-400 hover:bg-gray-800 transition-colors flex-shrink-0"
        >
          Выход
        </button>
      </header>

      <main className="flex-1 p-6 overflow-auto">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/live" element={<LiveLogs />} />
          <Route path="/search" element={<Search />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/correlation/rules" element={<CorrelationRules />} />
          <Route path="/correlation/alerts" element={<CorrelationAlerts />} />
          <Route path="/assets" element={<Assets />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/exclusions" element={<Exclusions />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/health" element={<SystemHealth />} />
          {isAdmin() && <Route path="/users" element={<Users />} />}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
