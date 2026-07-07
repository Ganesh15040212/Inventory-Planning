import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../utils/api';
import {
  Package, TrendingUp, Calculator, History,
  BarChart2, ArrowRight, Loader2, RefreshCw
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts';

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const StatCard = ({ title, value, subtitle, icon: Icon, color, loading }) => (
  <div className="stat-card">
    <div className="flex items-start justify-between mb-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
    </div>
    {loading ? (
      <div className="space-y-2">
        <div className="skeleton h-8 w-24" />
        <div className="skeleton h-4 w-32" />
      </div>
    ) : (
      <>
        <p className="text-2xl font-bold text-white mb-0.5">
          {typeof value === 'number' ? value.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : value}
        </p>
        <p className="text-xs text-slate-500">{title}</p>
        {subtitle && <p className="text-xs text-slate-600 mt-0.5">{subtitle}</p>}
      </>
    )}
  </div>
);

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [recentHistory, setRecentHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(false);

  const fetchData = async () => {
    try {
      const statsRes = await api.get('/items/stats');
      const data = statsRes.data.data;
      setStats(data);
      setRecentHistory(data.recentHistory || []);
      setIsOnline(true);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setIsOnline(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // Chart data from recent history
  const chartData = recentHistory.slice(0, 7).reverse().map((h, i) => ({
    name: `#${h.ItemCode}`,
    stock: parseFloat(h.StockOnHand || 0),
    requirement: parseFloat(h.FinalRequirement || 0),
    amount: parseFloat(h.PurchaseAmount || 0),
  }));

  const statCards = [
    { title: 'Total Items in Master', value: stats?.totalItems, subtitle: 'Items in ERP database', icon: Package, color: 'bg-brand-600' },
    { title: 'Total Stock On Hand', value: stats?.totalStock, subtitle: 'At Shop stock point', icon: BarChart2, color: 'bg-emerald-600' },
    { 
      title: 'Last Month Sales', 
      value: stats?.monthSales !== undefined ? `Rs. ${stats.monthSales.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—', 
      subtitle: 'Amount sold this month', 
      icon: TrendingUp, 
      color: 'bg-purple-600' 
    },
    { 
      title: 'Last One Year Sales', 
      value: stats?.yearSales !== undefined ? `Rs. ${stats.yearSales.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—', 
      subtitle: 'Amount sold this year', 
      icon: TrendingUp, 
      color: 'bg-orange-500' 
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white leading-tight">
              Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'}, {user?.fullName?.split(' ')[0] || user?.username}! 👋
            </h1>

            {/* Live/Offline Status Dot */}
            <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border flex-shrink-0 ${isOnline
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-ping' : 'bg-red-500'}`} />
              <span>{isOnline ? 'Live' : 'Offline'}</span>
            </div>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing} className="btn-secondary text-sm">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((s, i) => (
          <StatCard key={i} {...s} loading={loading} />
        ))}
      </div>

      {/* Chart + Quick actions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="xl:col-span-2 glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recent Calculations Overview</h2>
            <span className="badge badge-blue">Last 7 records</span>
          </div>
          {recentHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="stockGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3670f7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3670f7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" stroke="#475569" tick={{ fontSize: 11 }} />
                <YAxis stroke="#475569" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#475569' }}
                />
                <Area type="monotone" dataKey="stock" stroke="#3670f7" strokeWidth={2} fill="url(#stockGrad)" name="Stock" />
                <Area type="monotone" dataKey="requirement" stroke="#10b981" strokeWidth={2} fill="url(#reqGrad)" name="Requirement" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-500 text-sm">
              No calculations yet. Start planning inside Planning &amp; Export!
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="glass-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white mb-4">Quick Actions</h2>
          {[
            { label: 'Re-Order Form', sub: 'Run formulas & export Excel/PDF', icon: Calculator, color: 'text-brand-400', to: '/export' },
            { label: 'Sales & Stock Report', sub: 'Download daily sales & stock reports', icon: History, color: 'text-purple-400', to: '/sales-report' },
          ].map(({ label, sub, icon: Icon, color, to }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40 hover:border-slate-600/60 transition-all duration-200 group text-left"
            >
              <div className={`${color}`}><Icon size={18} /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 group-hover:text-white">{label}</p>
                <p className="text-xs text-slate-500">{sub}</p>
              </div>
              <ArrowRight size={14} className="text-slate-600 group-hover:text-slate-400 group-hover:translate-x-1 transition-transform" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
