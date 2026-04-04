import { NavLink, Route, Routes, Navigate, useNavigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import LiveLogs from "./pages/LiveLogs";
import Search from "./pages/Search";
import Alerts from "./pages/Alerts";
import Users from "./pages/Users";
import Login from "./pages/Login";
import { getToken, clearToken, isAdmin, getRole } from "./api/client";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Панель управления", roles: ["admin", "operator"] },
  { to: "/live", label: "Логи в реальном времени", roles: ["admin", "operator"] },
  { to: "/search", label: "Поиск логов", roles: ["admin", "operator"] },
  { to: "/alerts", label: "Алерты", roles: ["admin", "operator"] },
  { to: "/users", label: "Пользователи", roles: ["admin"] },
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
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-8">
        <h1 className="text-xl font-bold text-vault-400 tracking-wide select-none">
          LogVault
        </h1>
        <nav className="flex gap-1 flex-1">
          {visibleNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-vault-600/20 text-vault-300"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <span className="text-xs text-gray-600 uppercase">{role}</span>
        <button
          onClick={handleLogout}
          className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400
                     hover:text-red-400 hover:bg-gray-800 transition-colors"
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
