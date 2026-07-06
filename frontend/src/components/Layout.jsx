import { NavLink, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Calculator, History, Download,
  LogOut, Package, ChevronRight, Menu, X
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/export', icon: Calculator, label: 'Re-Order Form' },
  { to: '/sales-report', icon: History, label: 'Sales & Stock Report' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 overflow-hidden">

      {/* ── Mobile overlay ─────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ────────────────────────────────────── */}
      <aside
        className={`
          fixed lg:relative inset-y-0 left-0 z-50
          flex-shrink-0 flex flex-col
          bg-slate-900 border-r border-slate-800/50
          transition-all duration-300 ease-in-out
          ${sidebarOpen 
            ? 'w-64 translate-x-0' 
            : 'w-0 -translate-x-full lg:translate-x-0 overflow-hidden border-r-0'
          }
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800/50 flex-shrink-0">
          <div className="w-9 h-9 bg-gradient-to-br from-brand-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white leading-tight truncate">Inventory</p>
            <p className="text-xs text-slate-400 truncate">Planning Plugin</p>
          </div>
          <button
            className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
            onClick={() => setSidebarOpen(false)}
            title="Collapse Sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className="text-sm flex-1 truncate">{label}</span>
              <ChevronRight size={14} className="flex-shrink-0 opacity-40" />
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-3 py-4 border-t border-slate-800/50 flex-shrink-0">
          <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-800/50">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {user?.fullName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user?.fullName || user?.username}</p>
              <p className="text-xs text-slate-500 truncate">{user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-slate-500 hover:text-red-400 transition-colors p-1 flex-shrink-0"
              title="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main area ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar header (visible on desktop & mobile) */}
        <header className="flex items-center gap-4 px-5 py-3 bg-slate-900 border-b border-slate-800/50 flex-shrink-0 z-30">
          <button
            onClick={() => setSidebarOpen(prev => !prev)}
            className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-800"
            title="Toggle Sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Package className="w-5 h-5 text-brand-400 flex-shrink-0" />
            <span className="font-bold text-white text-sm truncate">Inventory Planning</span>
          </div>
        </header>

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="p-6 min-h-full">
            <div className="max-w-7xl mx-auto animate-fade-in">
              {children}
            </div>
          </div>
        </main>
      </div>

      {/* Styled Logout Warning Confirmation Modal */}
      {showLogoutConfirm && createPortal(
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl animate-scale-up">
            <div className="flex flex-col items-center text-center">
              {/* Warning Alert Icon */}
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-4">
                <LogOut size={22} className="stroke-[2.5]" />
              </div>
              <h3 className="text-base font-bold text-white mb-2">Confirm Logout</h3>
              <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                Are you sure you want to log out of your session? Any unsaved planning grid modifications might be lost.
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 font-medium rounded-xl text-xs transition-colors border border-slate-700/50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmLogout}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl text-xs transition-colors shadow-lg shadow-red-600/20"
                >
                  Yes, Logout
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
