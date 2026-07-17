import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  Loader2, Download, FileSpreadsheet, FileText, X, History, Boxes
} from 'lucide-react';

/* ─── Math Formulas Helper ─────────────────────────── */
const NUM = (v, d = 2) => {
  const num = parseFloat(v) || 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
};

const toDisplayDate = (ymd) => {
  if (!ymd) return '';
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
};

// Parse a user-typed DD/MM/YYYY string → YYYY-MM-DD (returns null if invalid)
const parseDateInput = (raw) => {
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(p => p.trim());
  if (y.length !== 4) return null;
  const iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return iso;
};

export default function SalesReport() {
  // Custom Sales Report States
  const [salesFromDate, setSalesFromDate] = useState(() => localStorage.getItem('inv_sales_from') || '2026-05-24');
  const [salesToDate, setSalesToDate] = useState(() => localStorage.getItem('inv_sales_to') || '2026-06-23');
  const [showSalesPdfPreview, setShowSalesPdfPreview] = useState(false);
  const [salesPdfUrl, setSalesPdfUrl] = useState('');
  const [showSalesExcelPreview, setShowSalesExcelPreview] = useState(false);
  const [salesExcelData, setSalesExcelData] = useState([]);
  const [salesPreviewLoading, setSalesPreviewLoading] = useState(false);
  const [salesExporting, setSalesExporting] = useState(null);

  // Group / Category states
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');

  // Stock Report states
  const [stockGroup, setStockGroup] = useState('');
  const [stockCategories, setStockCategories] = useState([]);
  const [stockCategory, setStockCategory] = useState('');
  const [stockIncludeZero, setStockIncludeZero] = useState(false);

  // Save parameters to localStorage on change
  useEffect(() => { localStorage.setItem('inv_sales_from', salesFromDate); }, [salesFromDate]);
  useEffect(() => { localStorage.setItem('inv_sales_to', salesToDate); }, [salesToDate]);

  // Load groups + categories once on page mount
  useEffect(() => {
    const loadGroups = async () => {
      setGroupsLoading(true);
      try {
        const res = await api.get('/export/stock-valuation/groups');
        setGroups(res.data.data || []);
      } catch {
        toast.error('Could not load product groups.');
      } finally {
        setGroupsLoading(false);
      }
    };
    loadGroups();
  }, []);

  const handleGroupChange = (groupCode) => {
    setSelectedGroup(groupCode);
    setSelectedCategory('');
    if (!groupCode) {
      setCategories([]);
      return;
    }
    const found = groups.find(g => String(g.groupCode) === String(groupCode));
    setCategories(found ? found.categories : []);
  };

  const handleStockGroupChange = (groupCode) => {
    setStockGroup(groupCode);
    setStockCategory('');
    if (!groupCode) {
      setStockCategories([]);
      return;
    }
    const found = groups.find(g => String(g.groupCode) === String(groupCode));
    setStockCategories(found ? found.categories : []);
  };

  const handlePreviewSalesPDF = async () => {
    setSalesPreviewLoading(true);
    try {
      const token = localStorage.getItem('inv_token');
      const url = `/api/export/sales-pdf?fromDate=${salesFromDate}&toDate=${salesToDate}&groupCode=${selectedGroup}&categoryCode=${selectedCategory}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Sales report PDF service returned error');
      const blob = await res.blob();
      
      if (salesPdfUrl) URL.revokeObjectURL(salesPdfUrl);
      const objectUrl = URL.createObjectURL(blob);
      setSalesPdfUrl(objectUrl);
      setShowSalesPdfPreview(true);
      toast.success('Sales PDF report preview generated!');
    } catch (err) {
      toast.error(`Preview failed: ${err.message}`);
    } finally {
      setSalesPreviewLoading(false);
    }
  };

  const handleExportSales = async (format) => {
    setSalesExporting(format);
    try {
      const token = localStorage.getItem('inv_token');
      const url = `/api/export/sales-${format}?fromDate=${salesFromDate}&toDate=${salesToDate}&groupCode=${selectedGroup}&categoryCode=${selectedCategory}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export service returned error');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sales_report_${Date.now()}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Sales ${format.toUpperCase()} report exported successfully!`);
    } catch (err) {
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setSalesExporting(null);
    }
  };

  const handlePreviewSalesExcel = async () => {
    setSalesPreviewLoading(true);
    try {
      const res = await api.get(`/export/sales-data?fromDate=${salesFromDate}&toDate=${salesToDate}&groupCode=${selectedGroup}&categoryCode=${selectedCategory}`);
      setSalesExcelData(res.data.data || []);
      setShowSalesExcelPreview(true);
      toast.success('Sales Excel report preview generated!');
    } catch (err) {
      toast.error(`Preview failed: ${err.response?.data?.message || err.message}`);
    } finally {
      setSalesPreviewLoading(false);
    }
  };

  // ── Stock Report States
  const [stockDate, setStockDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showStockPdfPreview, setShowStockPdfPreview] = useState(false);
  const [stockPdfUrl, setStockPdfUrl] = useState('');
  const [showStockExcelPreview, setShowStockExcelPreview] = useState(false);
  const [stockExcelData, setStockExcelData] = useState([]);
  const [stockPreviewLoading, setStockPreviewLoading] = useState(false);
  const [stockExporting, setStockExporting] = useState(null);

  const handlePreviewStockPDF = async () => {
    setStockPreviewLoading(true);
    try {
      const token = localStorage.getItem('inv_token');
      const url = `/api/export/overall-stock-pdf?date=${stockDate}&groupCode=${stockGroup}&categoryCode=${stockCategory}&includeZero=${stockIncludeZero}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Stock report PDF service returned error');
      const blob = await res.blob();

      if (stockPdfUrl) URL.revokeObjectURL(stockPdfUrl);
      const objectUrl = URL.createObjectURL(blob);
      setStockPdfUrl(objectUrl);
      setShowStockPdfPreview(true);
      toast.success('Stock PDF report preview generated!');
    } catch (err) {
      toast.error(`Preview failed: ${err.message}`);
    } finally {
      setStockPreviewLoading(false);
    }
  };

  const handleExportStock = async (format) => {
    setStockExporting(format);
    try {
      const token = localStorage.getItem('inv_token');
      const url = `/api/export/overall-stock-${format}?date=${stockDate}&groupCode=${stockGroup}&categoryCode=${stockCategory}&includeZero=${stockIncludeZero}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export service returned error');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `overall_stock_${Date.now()}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Stock ${format.toUpperCase()} report exported successfully!`);
    } catch (err) {
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setStockExporting(null);
    }
  };

  const handlePreviewStockExcel = async () => {
    setStockPreviewLoading(true);
    try {
      const res = await api.get(`/export/overall-stock-data?date=${stockDate}&groupCode=${stockGroup}&categoryCode=${stockCategory}&includeZero=${stockIncludeZero}`);
      setStockExcelData(res.data.data || []);
      setShowStockExcelPreview(true);
      toast.success('Stock Excel report preview generated!');
    } catch (err) {
      toast.error(`Preview failed: ${err.response?.data?.message || err.message}`);
    } finally {
      setStockPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <History className="text-amber-500" size={24} />
          Sales &amp; Stock Report
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          View, preview, and export sales and stock reports on a custom period or daily basis.
        </p>
      </div>

      {/* Sales Report Card (Full Page View) ── */}
      <div className="glass-card p-6 space-y-6">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            Sales Report Generation
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Aggregate actual sales transactions from live stock ledger and historical databases.
          </p>
        </div>

        {/* Filter Selectors Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-3 border-t border-slate-800/30">
          {/* From Date */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">From Date</label>
            <div className="relative">
              <input
                type="text"
                value={toDisplayDate(salesFromDate)}
                onChange={e => {
                  const iso = parseDateInput(e.target.value);
                  if (iso) setSalesFromDate(iso);
                }}
                placeholder="DD/MM/YYYY"
                className="form-input text-xs py-2 w-full pr-10 font-bold"
              />
              <input
                type="date"
                value={salesFromDate}
                onChange={e => setSalesFromDate(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                style={{ zIndex: 1 }}
                tabIndex={-1}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" style={{ zIndex: 2 }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect width="18" height="18" x="3" y="4" rx="2" ry="2" strokeWidth="2"/>
                  <path d="M16 2v4M8 2v4M3 10h18" strokeWidth="2"/>
                </svg>
              </div>
            </div>
          </div>

          {/* To Date */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">To Date</label>
            <div className="relative">
              <input
                type="text"
                value={toDisplayDate(salesToDate)}
                onChange={e => {
                  const iso = parseDateInput(e.target.value);
                  if (iso) setSalesToDate(iso);
                }}
                placeholder="DD/MM/YYYY"
                className="form-input text-xs py-2 w-full pr-10 font-bold"
              />
              <input
                type="date"
                value={salesToDate}
                onChange={e => setSalesToDate(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                style={{ zIndex: 1 }}
                tabIndex={-1}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" style={{ zIndex: 2 }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect width="18" height="18" x="3" y="4" rx="2" ry="2" strokeWidth="2"/>
                  <path d="M16 2v4M8 2v4M3 10h18" strokeWidth="2"/>
                </svg>
              </div>
            </div>
          </div>

          {/* Product Group (Optional) */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">
              Product Group <span className="text-[8px] font-normal text-slate-500 lowercase">(optional)</span>
            </label>
            <div className="relative">
              <select
                value={selectedGroup}
                onChange={e => handleGroupChange(e.target.value)}
                disabled={groupsLoading}
                className="form-input text-xs py-2.5 w-full appearance-none pr-8 cursor-pointer"
              >
                <option value="">
                  {groupsLoading ? 'Loading groups...' : '— All Groups (Overall) —'}
                </option>
                {groups.map(g => (
                  <option key={g.groupCode} value={g.groupCode}>
                    {g.groupName}
                  </option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Category (Optional) */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">
              Category <span className="text-[8px] font-normal text-slate-500 lowercase">(optional)</span>
            </label>
            <div className="relative">
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                disabled={categories.length === 0}
                className="form-input text-xs py-2.5 w-full appearance-none pr-8 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {selectedGroup ? (categories.length === 0 ? 'No categories found' : '— All Categories —') : '← Pick a group first'}
                </option>
                {categories.map(c => (
                  <option key={c.categoryCode} value={c.categoryCode}>
                    {c.categoryName}
                  </option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="flex flex-wrap gap-2 justify-end pt-4 border-t border-slate-800/30">
          <button
            onClick={handlePreviewSalesExcel}
            disabled={salesExporting !== null || salesPreviewLoading}
            className="btn-secondary py-2.5 px-4 text-xs border-slate-800 hover:bg-slate-900 justify-center gap-1.5 whitespace-nowrap min-w-[120px]"
          >
            {salesPreviewLoading ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Preview Excel
          </button>
          <button
            onClick={() => handleExportSales('excel')}
            disabled={salesExporting !== null || salesPreviewLoading}
            className="btn-success py-2.5 px-5 text-xs justify-center gap-1.5 whitespace-nowrap min-w-[120px]"
          >
            {salesExporting === 'excel' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export Excel
          </button>
          <button
            onClick={handlePreviewSalesPDF}
            disabled={salesExporting !== null || salesPreviewLoading}
            className="btn-secondary py-2.5 px-4 text-xs border-slate-800 hover:bg-slate-900 justify-center gap-1.5 whitespace-nowrap min-w-[120px]"
          >
            {salesPreviewLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Preview PDF
          </button>
          <button
            onClick={() => handleExportSales('pdf')}
            disabled={salesExporting !== null || salesPreviewLoading}
            className="btn-danger py-2.5 px-5 text-xs bg-red-600 hover:bg-red-700 border-0 justify-center text-white gap-1.5 whitespace-nowrap min-w-[120px]"
          >
            {salesExporting === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export PDF
          </button>
        </div>
      </div>

      {/* ── Stock Report / Overall Stock Card ── */}
      <div className="glass-card p-6 space-y-6">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Boxes className="text-amber-500" size={18} />
            Stock Report / Overall Stock
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Aggregate active stock quantities and values dynamically up to the selected target date.
          </p>
        </div>

        {/* Filter Selectors Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-800/30">
          {/* Target Date */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">Target Date</label>
            <div className="relative">
              <input
                type="text"
                value={toDisplayDate(stockDate)}
                onChange={e => {
                  const iso = parseDateInput(e.target.value);
                  if (iso) setStockDate(iso);
                }}
                placeholder="DD/MM/YYYY"
                className="form-input text-xs py-2 w-full pr-10 font-bold"
              />
              <input
                type="date"
                value={stockDate}
                onChange={e => setStockDate(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                style={{ zIndex: 1 }}
                tabIndex={-1}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" style={{ zIndex: 2 }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect width="18" height="18" x="3" y="4" rx="2" ry="2" strokeWidth="2"/>
                  <path d="M16 2v4M8 2v4M3 10h18" strokeWidth="2"/>
                </svg>
              </div>
            </div>
          </div>

          {/* Group (Optional) */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">
              Group <span className="text-[8px] font-normal text-slate-500 lowercase">(optional)</span>
            </label>
            <div className="relative">
              <select
                value={stockGroup}
                onChange={e => handleStockGroupChange(e.target.value)}
                disabled={groupsLoading}
                className="form-input text-xs py-2.5 w-full appearance-none pr-8 cursor-pointer disabled:opacity-50"
              >
                <option value="">— All Groups —</option>
                {groups.map(g => (
                  <option key={g.groupCode} value={g.groupCode}>
                    {g.groupName}
                  </option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* Category (Optional) */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">
              Category <span className="text-[8px] font-normal text-slate-500 lowercase">(optional)</span>
            </label>
            <div className="relative">
              <select
                value={stockCategory}
                onChange={e => setStockCategory(e.target.value)}
                disabled={stockCategories.length === 0}
                className="form-input text-xs py-2.5 w-full appearance-none pr-8 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {stockGroup ? (stockCategories.length === 0 ? 'No categories found' : '— All Categories —') : '← Pick a group first'}
                </option>
                {stockCategories.map(c => (
                  <option key={c.categoryCode} value={c.categoryCode}>
                    {c.categoryName}
                  </option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Enable 0 QTY Toggle */}
        <div className="flex items-center gap-2 pt-3">
          <label className="relative inline-flex items-center cursor-pointer select-none">
            <input
              type="checkbox"
              checked={stockIncludeZero}
              onChange={e => setStockIncludeZero(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 peer-checked:after:bg-emerald-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-950/50 peer-checked:border peer-checked:border-emerald-800/30 border border-slate-700/50"></div>
            <span className="ml-2 text-xs font-bold text-slate-300">Enable 0 QTY</span>
          </label>
        </div>

        {/* Action Buttons Row */}
        <div className="flex flex-wrap gap-2 justify-end pt-4 border-t border-slate-800/30">
          <button
            onClick={handlePreviewStockExcel}
            disabled={stockExporting !== null || stockPreviewLoading}
            className="btn-secondary py-2.5 px-4 text-xs border-slate-800 hover:bg-slate-900 justify-center gap-1.5 whitespace-nowrap min-w-[120px]"
          >
            {stockPreviewLoading ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Preview Excel
          </button>
          <button
            onClick={() => handleExportStock('excel')}
            disabled={stockExporting !== null || stockPreviewLoading}
            className="btn-success py-2.5 px-5 text-xs justify-center gap-1.5 whitespace-nowrap min-w-[120px]"
          >
            {stockExporting === 'excel' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export Excel
          </button>
          <button
            onClick={handlePreviewStockPDF}
            disabled={stockExporting !== null || stockPreviewLoading}
            className="btn-secondary py-2.5 px-4 text-xs border-slate-800 hover:bg-slate-900 justify-center gap-1.5 whitespace-nowrap min-w-[120px]"
          >
            {stockPreviewLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Preview PDF
          </button>
          <button
            onClick={() => handleExportStock('pdf')}
            disabled={stockExporting !== null || stockPreviewLoading}
            className="btn-danger py-2.5 px-5 text-xs bg-red-600 hover:bg-red-700 border-0 justify-center text-white gap-1.5 whitespace-nowrap min-w-[120px]"
          >
            {stockExporting === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export PDF
          </button>
        </div>
      </div>

      {/* ── Sales PDF Preview Modal (Full Screen) ── */}
      {showSalesPdfPreview && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex flex-col p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-850 flex-shrink-0 bg-slate-950/35">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileText size={18} className="text-red-400" />
                  Sales Report PDF Print Preview
                </h3>
                <p className="text-[11px] text-slate-400">Verify sales aggregates and quantities before downloading the report.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = salesPdfUrl;
                    a.download = `sales_report_${Date.now()}.pdf`;
                    a.click();
                  }}
                  className="btn-primary text-xs py-2 px-4 shadow bg-red-600 hover:bg-red-700 border-0"
                >
                  <Download size={13} className="inline mr-1.5" />
                  Download PDF
                </button>
                <button
                  onClick={() => {
                    setShowSalesPdfPreview(false);
                    if (salesPdfUrl) URL.revokeObjectURL(salesPdfUrl);
                    setSalesPdfUrl('');
                  }}
                  className="text-slate-400 hover:text-white p-1 bg-slate-800 hover:bg-slate-750 border border-slate-700/60 rounded-lg transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Embedded PDF iframe */}
            <div className="flex-1 min-h-0 bg-slate-950 p-2">
              <iframe
                src={`${salesPdfUrl}#toolbar=1`}
                className="w-full h-full border-0 rounded-lg bg-slate-900"
                title="Sales PDF Report Preview"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Sales Excel Preview Modal ── */}
      {showSalesExcelPreview && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex flex-col p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-850 flex-shrink-0 bg-slate-950/35">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileSpreadsheet size={18} className="text-emerald-400" />
                  Sales Excel Worksheet Grid Preview
                </h3>
                <p className="text-[11px] text-slate-400">Preview Excel columns, sold quantities, cost amounts, and sales values.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setShowSalesExcelPreview(false);
                    handleExportSales('excel');
                  }}
                  className="btn-primary text-xs py-2 px-4 shadow bg-emerald-600 hover:bg-emerald-700 border-0"
                >
                  <Download size={13} className="inline mr-1.5" />
                  Download Excel (.xlsx)
                </button>
                <button
                  onClick={() => setShowSalesExcelPreview(false)}
                  className="text-slate-400 hover:text-white p-1 bg-slate-800 hover:bg-slate-750 border border-slate-700/60 rounded-lg transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Simulated Excel Workbook Canvas */}
            <div className="flex-1 min-h-0 bg-slate-950 overflow-auto p-6 flex justify-center">
              <div className="bg-white text-slate-800 font-sans shadow-xl border border-slate-300 w-full max-w-4xl rounded overflow-hidden min-w-[700px] flex flex-col h-fit">
                
                {/* Header Info */}
                <div className="bg-slate-100 border-b border-slate-200 text-[10px] text-slate-400 font-bold px-2 py-1 select-none flex justify-between">
                  <span>Excel Worksheet Canvas (Read-Only Preview)</span>
                  <span>Sales Report</span>
                </div>

                {/* Company Banner */}
                <div className="border-b border-slate-300 text-center py-3 bg-slate-50 font-bold text-slate-900 tracking-wider">
                  <div className="text-sm">INDIA SILK HOUSE</div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                    SALES REPORT ({toDisplayDate(salesFromDate)} TO {toDisplayDate(salesToDate)})
                  </div>
                </div>

                {/* Excel Table wrapper with horizontal scrolling */}
                <div className="overflow-x-auto w-full">
                  <table className="w-full border-collapse text-[11px] text-slate-700 min-w-[850px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300 text-center">
                        <th className="border-r border-slate-200 px-2 py-2 w-10">SL</th>
                        <th className="border-r border-slate-200 px-2 py-2 w-28">BARCODE</th>
                        <th className="border-r border-slate-200 px-2 py-2 text-left w-56">ITEM NAME</th>
                        <th className="border-r border-slate-200 px-2 py-2 w-20">SIZE NAME</th>
                        <th className="border-r border-slate-200 px-2 py-2 w-20">QUANTITY</th>
                        <th className="border-r border-slate-200 px-2 py-2 w-24">COST AMOUNT</th>
                        <th className="px-2 py-2 w-24">SALES AMOUNT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {salesExcelData.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-slate-400 italic">
                            No sales transactions found for the selected date range.
                          </td>
                        </tr>
                      ) : (
                        <>
                          {salesExcelData.map((item, idx) => {
                            const quantity = parseFloat(item.Quantity) || 0;
                            const cost = parseFloat(item.Cost) || 0;
                            const salesAmount = parseFloat(item.SalesAmount) || 0;
                            const costAmount = quantity * cost;

                            return (
                              <tr key={idx} className="hover:bg-slate-50">
                                <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-400">{idx + 1}</td>
                                <td className="border-r border-slate-200 px-2 py-2 text-center font-mono">{item.Barcode || '—'}</td>
                                <td className="border-r border-slate-200 px-2 py-2 font-semibold text-slate-800 truncate max-w-[250px]" title={item.ItemName}>{item.ItemName}</td>
                                <td className="border-r border-slate-200 px-2 py-2 text-center text-slate-500">{item.SizeName || '—'}</td>
                                <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold font-mono">{NUM(quantity, 0)}</td>
                                <td className="border-r border-slate-200 px-2 py-2 text-right font-mono">{NUM(costAmount, 2)}</td>
                                <td className="px-2 py-2 text-right font-mono font-bold text-emerald-600">{NUM(salesAmount, 2)}</td>
                              </tr>
                            );
                          })}

                          {/* Summary Totals Row */}
                          <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
                            <td colSpan={4} className="border-r border-slate-200 px-2 py-2 text-right text-slate-700 text-[10px]">TOTAL</td>
                            <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-900">
                              {NUM(salesExcelData.reduce((acc, curr) => acc + (parseFloat(curr.Quantity) || 0), 0), 0)}
                            </td>
                            <td className="border-r border-slate-200 px-2 py-2 text-right font-mono text-slate-900">
                              {NUM(salesExcelData.reduce((acc, curr) => acc + ((parseFloat(curr.Quantity) || 0) * (parseFloat(curr.Cost) || 0)), 0), 2)}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-emerald-600 font-extrabold">
                              {NUM(salesExcelData.reduce((acc, curr) => acc + (parseFloat(curr.SalesAmount) || 0), 0), 2)}
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Stock Report PDF Preview Modal (Full Screen) ── */}
      {showStockPdfPreview && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex flex-col p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-850 flex-shrink-0 bg-slate-950/35">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileText size={18} className="text-red-400" />
                  Overall Stock Report PDF Print Preview
                </h3>
                <p className="text-[11px] text-slate-400">Verify overall stock quantities, retails, and costs before downloading.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = stockPdfUrl;
                    a.download = `overall_stock_${Date.now()}.pdf`;
                    a.click();
                  }}
                  className="btn-primary text-xs py-2 px-4 shadow bg-red-600 hover:bg-red-700 border-0"
                >
                  <Download size={13} className="inline mr-1.5" />
                  Download PDF
                </button>
                <button
                  onClick={() => {
                    setShowStockPdfPreview(false);
                    if (stockPdfUrl) URL.revokeObjectURL(stockPdfUrl);
                    setStockPdfUrl('');
                  }}
                  className="text-slate-400 hover:text-white p-1 bg-slate-800 hover:bg-slate-750 border border-slate-700/60 rounded-lg transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Embedded PDF iframe */}
            <div className="flex-1 min-h-0 bg-slate-950 p-2">
              <iframe
                src={`${stockPdfUrl}#toolbar=1`}
                className="w-full h-full border-0 rounded-lg bg-slate-900"
                title="Overall Stock PDF Report Preview"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Stock Report Excel Preview Modal ── */}
      {showStockExcelPreview && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex flex-col p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-850 flex-shrink-0 bg-slate-950/35">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileSpreadsheet size={18} className="text-emerald-400" />
                  Overall Stock Excel Worksheet Grid Preview
                </h3>
                <p className="text-[11px] text-slate-400">Preview stock spreadsheet rows, retail values, and cost values.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setShowStockExcelPreview(false);
                    handleExportStock('excel');
                  }}
                  className="btn-primary text-xs py-2 px-4 shadow bg-emerald-600 hover:bg-emerald-700 border-0"
                >
                  <Download size={13} className="inline mr-1.5" />
                  Download Excel (.xlsx)
                </button>
                <button
                  onClick={() => setShowStockExcelPreview(false)}
                  className="text-slate-400 hover:text-white p-1 bg-slate-800 hover:bg-slate-750 border border-slate-700/60 rounded-lg transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Simulated Excel Workbook Canvas */}
            <div className="flex-1 min-h-0 bg-slate-950 overflow-auto p-6 flex justify-center">
              <div className="bg-white text-slate-800 font-sans shadow-xl border border-slate-300 w-full max-w-4xl rounded overflow-hidden min-w-[700px] flex flex-col h-fit">
                
                {/* Header Info */}
                <div className="bg-slate-100 border-b border-slate-200 text-[10px] text-slate-400 font-bold px-2 py-1 select-none flex justify-between">
                  <span>Excel Worksheet Canvas (Read-Only Preview)</span>
                  <span>Overall Stock Report</span>
                </div>

                {/* Company Banner */}
                <div className="border-b border-slate-300 text-center py-3 bg-slate-50 font-bold text-slate-900 tracking-wider">
                  <div className="text-sm">INDIA SILK HOUSE</div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                    OVERALL STOCK REPORT (AS OF {toDisplayDate(stockDate)})
                  </div>
                </div>

                {/* Excel Table wrapper with horizontal scrolling */}
                <div className="overflow-x-auto w-full">
                  <table className="w-full border-collapse text-[11px] text-slate-700 min-w-[850px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300 text-center">
                        <th className="border-r border-slate-200 px-2 py-2 w-10">SL</th>
                        <th className="border-r border-slate-200 px-2 py-2 w-28">BARCODE</th>
                        <th className="border-r border-slate-200 px-2 py-2 text-left w-56">ITEM NAME</th>
                        <th className="border-r border-slate-200 px-2 py-2 w-20">SIZE</th>
                        <th className="border-r border-slate-200 px-2 py-2 w-20">QTY</th>
                        <th className="border-r border-slate-200 px-2 py-2 w-24">RETAIL</th>
                        <th className="px-2 py-2 w-24">COST</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {stockExcelData.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-slate-400 italic">
                            No stock records found as of the selected date.
                          </td>
                        </tr>
                      ) : (
                        <>
                          {stockExcelData.map((item, idx) => {
                            const qty = parseFloat(item.Qty) || 0;
                            const retail = parseFloat(item.Retail) || 0;
                            const cost = parseFloat(item.Cost) || 0;

                            return (
                              <tr key={idx} className="hover:bg-slate-50">
                                <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-400">{idx + 1}</td>
                                <td className="border-r border-slate-200 px-2 py-2 text-center font-mono">{item.Barcode || '—'}</td>
                                <td className="border-r border-slate-200 px-2 py-2 font-semibold text-slate-800 truncate max-w-[250px]" title={item.ItemName}>{item.ItemName}</td>
                                <td className="border-r border-slate-200 px-2 py-2 text-center text-slate-500">{item.SizeName || '—'}</td>
                                <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold font-mono">{NUM(qty, 0)}</td>
                                <td className="border-r border-slate-200 px-2 py-2 text-right font-mono">{NUM(retail, 2)}</td>
                                <td className="px-2 py-2 text-right font-mono font-bold text-red-650">{NUM(cost, 2)}</td>
                              </tr>
                            );
                          })}

                          {/* Summary Totals Row */}
                          <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
                            <td colSpan={4} className="border-r border-slate-200 px-2 py-2 text-right text-slate-700 text-[10px]">TOTAL</td>
                            <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-900">
                              {NUM(stockExcelData.reduce((acc, curr) => acc + (parseFloat(curr.Qty) || 0), 0), 0)}
                            </td>
                            <td className="border-r border-slate-200 px-2 py-2 text-right font-mono text-emerald-600">
                              {NUM(stockExcelData.reduce((acc, curr) => acc + ((parseFloat(curr.Qty) || 0) * (parseFloat(curr.Retail) || 0)), 0), 2)}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-red-700 font-extrabold">
                              {NUM(stockExcelData.reduce((acc, curr) => acc + ((parseFloat(curr.Qty) || 0) * (parseFloat(curr.Cost) || 0)), 0), 2)}
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
