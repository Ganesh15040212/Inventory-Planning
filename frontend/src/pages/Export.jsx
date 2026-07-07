import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import {
  Search, Calculator, Download, Trash2, Plus,
  RotateCcw, Loader2, ArrowDownToLine, Info, CheckSquare, Square,
  Edit2, X, FileSpreadsheet, FileText
} from 'lucide-react';

/* ─── Math Formulas Helper ─────────────────────────── */
const NUM = (v, d = 2) => {
  const num = parseFloat(v) || 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
};
const SAFE = (a, b)     => b === 0 ? 0 : a / b;

// Calculate exact day count between two YYYY-MM-DD date strings (inclusive)
const getDaysDiff = (start, end) => {
  if (!start || !end) return 30;
  const s = new Date(start);
  const e = new Date(end);
  const diff = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diff);
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

const formatMonthRangeLabel = (days) => {
  if (days < 30) return `${days}D`;
  const m = Math.floor(days / 30);
  const d = days % 30;
  return d === 0 ? `${m}M` : `${m}M ${d}D`;
};

const formatYearRangeLabel = (days) => {
  if (days < 365) return `${days}D`;
  const y = Math.floor(days / 365);
  const d = days % 365;
  return d === 0 ? `${y}Y` : `${y}Y ${d}D`;
};

const runRowCalculations = (item, monthsCount = 1, yearsCount = 1, seasonMultiplier = 1.0) => {
  const stock = parseFloat(item.stockOnHand) || 0;
  const lm    = parseFloat(item.lastOneMonthSale) || 0;
  const ly    = parseFloat(item.lastOneYearSale) || 0;
  const cost  = parseFloat(item.cost) || 0;
  const staff = parseFloat(item.staffRequirement) || 0;

  const avgPerMonth = SAFE(ly, yearsCount * 12);
  // daysCount passed as monthsCount parameter — normalise to per-30.4375-day rate
  const avgMonthSale = SAFE(lm, (monthsCount / 30.4375));
  const systemRequirement = (lm * seasonMultiplier) - stock;
  const finalRequirement = systemRequirement + staff;
  const afterPurchaseStock = stock + staff;
  const purchaseAmount = cost * staff;
  const rotation = SAFE(stock, lm);

  return {
    ...item,
    seasonMultiplier,
    averagePerMonth: parseFloat(avgPerMonth.toFixed(2)),
    systemRequirement: parseFloat(systemRequirement.toFixed(2)),
    finalRequirement: parseFloat(finalRequirement.toFixed(2)),
    afterPurchaseStock: parseFloat(afterPurchaseStock.toFixed(2)),
    purchaseAmount: parseFloat(purchaseAmount.toFixed(2)),
    rotation: parseFloat(rotation.toFixed(2)),
  };
};

/* ─── Portal Autocomplete Dropdown ────────────────── */
function SuggestionsPortal({ anchorRef, items, onSelect }) {
  const [style, setStyle] = useState({});

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, [anchorRef, items]);

  if (!items.length) return null;

  return createPortal(
    <div
      style={style}
      className="bg-slate-800 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto"
    >
      {items.map(s => (
        <button
          key={s.code}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700
                     transition-colors text-left border-b border-slate-700/30 last:border-0"
          onMouseDown={e => { e.preventDefault(); onSelect(s); }}
        >
          <span className="badge badge-blue flex-shrink-0">{s.code}</span>
          <div className="min-w-0">
            <p className="text-sm text-slate-200 truncate">{s.name}</p>
            <p className="text-xs text-slate-500 truncate">{s.upcCode}</p>
          </div>
        </button>
      ))}
    </div>,
    document.body
  );
}

/* ─── Unified Planning & Export Page ──────────────── */
export default function ExportPage() {
  const [itemCodeInput, setItemCodeInput] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);
  const [sugLoading, setSugLoading] = useState(false);

  // Active items planning grid (loaded synchronously from localStorage)
  const [batchItems, setBatchItems] = useState(() => {
    const saved = localStorage.getItem('inv_batch_items');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.error('Failed to parse batch items from localStorage:', e);
      }
    }
    return [];
  });

  // Checkbox row selection (all items selected by default)
  const [selectedIndices, setSelectedIndices] = useState(() => {
    const saved = localStorage.getItem('inv_batch_items');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return new Set(parsed.map((_, i) => i));
      } catch {}
    }
    return new Set();
  });

  // Date Boundaries (Months Range & Years Range)
  const [monthFromDate, setMonthFromDate] = useState(() => localStorage.getItem('inv_month_from') || '2026-06-01');
  const [monthToDate, setMonthToDate] = useState(() => localStorage.getItem('inv_month_to') || '2026-06-30');
  
  // Year range as full date pickers (Bug 4 — was year-number fields)
  const [yearFromDate, setYearFromDate] = useState(() => {
    const saved = localStorage.getItem('inv_year_from');
    // Migrate old 4-digit year values to full ISO date
    if (saved && /^\d{4}$/.test(saved)) return `${saved}-01-01`;
    return saved || '2025-01-01';
  });
  const [yearToDate, setYearToDate] = useState(() => {
    const saved = localStorage.getItem('inv_year_to');
    if (saved && /^\d{4}$/.test(saved)) return `${saved}-12-31`;
    return saved || '2026-12-31';
  });

  // Global Season Multiplier — stored as string to allow free backspace editing (Bug 5)
  const [globalSeasonMultiplier, setGlobalSeasonMultiplier] = useState(() => {
    return localStorage.getItem('inv_multiplier') || '1.0';
  });

  // Preview States
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [showExcelPreview, setShowExcelPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Stock Valuation date query context (supports manual date picking, defaults to today)
  const [svDate, setSvDate] = useState(() => new Date().toISOString().slice(0, 10));

  const salesFromDate = svDate;
  const salesToDate = svDate;

  // Inline staff requirement editing states (Bug 2)
  const [inlineEditIndex, setInlineEditIndex] = useState(null);
  const [inlineEditVal, setInlineEditVal] = useState('');

  // Bulk staff requirement paste field
  const [bulkStaffInput, setBulkStaffInput] = useState('');

  // Edit Modal States
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingStaff, setEditingStaff] = useState('');

  // Custom Delete Modal State
  const [deletingIndex, setDeletingIndex] = useState(null);

  // ── Stock Valuation State ─────────────────────────────────────────────────
  const [svGroups, setSvGroups] = useState([]);          // all groups + categories from API
  const [svGroupsLoading, setSvGroupsLoading] = useState(false);
  const [svSelectedGroup, setSvSelectedGroup] = useState('');  // groupCode string
  const [svCategories, setSvCategories] = useState([]);        // categories for selected group
  const [svSelectedCategory, setSvSelectedCategory] = useState('');// categoryCode string
  const [svRows, setSvRows] = useState(() => {               // table rows (persisted)
    try {
      const saved = localStorage.getItem('inv_sv_rows');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [svExporting, setSvExporting] = useState(null);       // 'excel'|'pdf'|null
  const [showSvPdfPreview, setShowSvPdfPreview] = useState(false);
  const [svPdfUrl, setSvPdfUrl] = useState('');
  const [showSvExcelPreview, setShowSvExcelPreview] = useState(false);
  const [svPreviewLoading, setSvPreviewLoading] = useState(false);
  const [svAddLoading, setSvAddLoading] = useState(false);

  const wrapperRef = useRef(null);

  // Save parameters to localStorage on change
  useEffect(() => { localStorage.setItem('inv_month_from', monthFromDate); }, [monthFromDate]);
  useEffect(() => { localStorage.setItem('inv_month_to', monthToDate); }, [monthToDate]);
  useEffect(() => { localStorage.setItem('inv_year_from', yearFromDate); }, [yearFromDate]);
  useEffect(() => { localStorage.setItem('inv_year_to', yearToDate); }, [yearToDate]);
  useEffect(() => { localStorage.setItem('inv_multiplier', String(globalSeasonMultiplier)); }, [globalSeasonMultiplier]);

  // Persist stock valuation rows to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('inv_sv_rows', JSON.stringify(svRows));
  }, [svRows]);

  // Load groups + categories once on page mount
  useEffect(() => {
    const loadGroups = async () => {
      setSvGroupsLoading(true);
      try {
        const res = await api.get('/export/stock-valuation/groups');
        setSvGroups(res.data.data || []);
      } catch {
        toast.error('Could not load product groups.');
      } finally {
        setSvGroupsLoading(false);
      }
    };
    loadGroups();
  }, []);

  useEffect(() => {
    const rawItems = batchItems.map(item => ({
      itemCode: item.itemCode,
      itemName: item.itemName,
      upcCode: item.upcCode,
      sizeModel: item.sizeModel,
      supplierName: item.supplierName,
      cost: item.cost,
      stockOnHand: item.stockOnHand,
      lastOneMonthSale: item.lastOneMonthSale,
      lastOneYearSale: item.lastOneYearSale,
      staffRequirement: item.staffRequirement
    }));
    localStorage.setItem('inv_batch_items', JSON.stringify(rawItems));
  }, [batchItems]);

  // Handle hash scrolling on load (e.g. going to #sales-report from dashboard)
  useEffect(() => {
    if (window.location.hash === '#sales-report') {
      const timer = setTimeout(() => {
        const el = document.getElementById('sales-report');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-amber-500/50');
          setTimeout(() => el.classList.remove('ring-2', 'ring-amber-500/50'), 2000);
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, []);

  // Bug 3: exact day count instead of calendar months
  const daysCount = getDaysDiff(monthFromDate, monthToDate);
  // Keep monthsCount alias pointing to daysCount for runRowCalculations (which uses it as the divisor)
  const monthsCount = daysCount;
  // Bug 4: year count from full date range
  const yearDays = getDaysDiff(yearFromDate, yearToDate);
  const yearsCount = Math.max(1, Math.round(yearDays / 365.25));

  // Debounced search autocomplete
  useEffect(() => {
    if (itemCodeInput.length < 2) { setSuggestions([]); setShowSug(false); return; }
    const t = setTimeout(async () => {
      try {
        setSugLoading(true);
        const res = await api.get(`/items/search?q=${encodeURIComponent(itemCodeInput)}`);
        const data = res.data.data || [];
        setSuggestions(data);
        setShowSug(data.length > 0);
      } catch { setSuggestions([]); }
      finally { setSugLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [itemCodeInput]);

  // Click outside closes suggestions dropdown
  useEffect(() => {
    const handler = e => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowSug(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Update calculations for all items when global multiplier or date counts change
  useEffect(() => {
    const mult = parseFloat(globalSeasonMultiplier) || 1.0;
    setBatchItems(prev =>
      prev.map(item => runRowCalculations(item, monthsCount, yearsCount, mult))
    );
  }, [globalSeasonMultiplier, monthFromDate, monthToDate, yearFromDate, yearToDate]);

  // Whenever dates change, re-query all items in the batch to load updated sales sums from the database
  useEffect(() => {
    if (batchItems.length === 0) return;

    const reQueryAll = async () => {
      setLoading(true);
      try {
        const mult = parseFloat(globalSeasonMultiplier) || 1.0;
        const promises = batchItems.map(async (item, idx) => {
          const res = await api.get(
            `/items/${encodeURIComponent(item.itemCode)}?monthFromDate=${monthFromDate}&monthToDate=${monthToDate}&yearFromDate=${yearFromDate}&yearToDate=${yearToDate}`
          );
          const updatedDetails = res.data.data;
          setBatchItems(prev => {
            const next = [...prev];
            next[idx] = runRowCalculations(
              {
                ...next[idx],
                stockOnHand: updatedDetails.stockOnHand,
                lastOneMonthSale: updatedDetails.lastOneMonthSale,
                lastOneYearSale: updatedDetails.lastOneYearSale,
                cost: updatedDetails.cost,
                supplierName: updatedDetails.supplierName,
              },
              monthsCount,
              yearsCount,
              mult
            );
            return next;
          });
        });
        await Promise.all(promises);
        toast.success('Sales metrics successfully updated from stock ledger.');
      } catch {
        toast.error('Failed to query new date range from database.');
      } finally {
        setLoading(false);
      }
    };
    reQueryAll();
  }, [monthFromDate, monthToDate, yearFromDate, yearToDate]);

  // Fetch full item details and add as a row in the batch planning grid
  // Bug 1: supports bulk paste (comma / newline / space separated codes)
  const handleAddItem = async (code) => {
    const rawInput = (code || itemCodeInput).trim();
    if (!rawInput) { toast.error('Please enter an item code'); return; }

    // Split by commas, newlines, AND spaces — supports all paste formats
    const codes = rawInput.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);

    const mult = parseFloat(globalSeasonMultiplier) || 1.0;

    // ── Single item (original path) ──────────────────────────────────────
    if (codes.length === 1) {
      const queryCode = codes[0];
      if (batchItems.some(i => String(i.itemCode) === queryCode || i.upcCode === queryCode)) {
        toast.error('Item already added to the list');
        setItemCodeInput('');
        setShowSug(false);
        return;
      }
      setLoading(true);
      setShowSug(false);
      setSuggestions([]);
      try {
        const res = await api.get(
          `/items/${encodeURIComponent(queryCode)}?monthFromDate=${monthFromDate}&monthToDate=${monthToDate}&yearFromDate=${yearFromDate}&yearToDate=${yearToDate}`
        );
        const details = res.data.data;
        const calculatedItem = runRowCalculations(
          { ...details, seasonMultiplier: mult, staffRequirement: 0 },
          monthsCount, yearsCount, mult
        );
        setBatchItems(prev => {
          const next = [...prev, calculatedItem];
          setSelectedIndices(prevSel => {
            const nextSel = new Set(prevSel);
            nextSel.add(next.length - 1);
            return nextSel;
          });
          return next;
        });
        setItemCodeInput('');
        toast.success(`Added: ${details.itemName}`);
      } catch (err) {
        toast.error(err.response?.data?.message || `Item "${queryCode}" not found`);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Bulk path: multiple codes ─────────────────────────────────────────
    setBulkLoading(true);
    setBulkProgress({ current: 0, total: codes.length });
    setShowSug(false);
    setSuggestions([]);
    setItemCodeInput('');

    let added = 0;
    let failed = 0;

    // Build a snapshot of already-present codes BEFORE the loop
    // (batchItems is stale inside the async loop — use a local Set instead)
    const existingCodes = new Set(batchItems.map(it => String(it.itemCode)));
    const existingUpcs  = new Set(batchItems.map(it => it.upcCode || '').filter(Boolean));
    const addedThisRun  = new Set();

    for (let i = 0; i < codes.length; i++) {
      const queryCode = codes[i];
      setBulkProgress({ current: i + 1, total: codes.length });

      // Skip exact duplicates (already in grid OR already added this run)
      if (existingCodes.has(queryCode) || existingUpcs.has(queryCode) || addedThisRun.has(queryCode)) continue;

      try {
        const res = await api.get(
          `/items/${encodeURIComponent(queryCode)}?monthFromDate=${monthFromDate}&monthToDate=${monthToDate}&yearFromDate=${yearFromDate}&yearToDate=${yearToDate}`
        );
        const details = res.data.data;
        const calculatedItem = runRowCalculations(
          { ...details, seasonMultiplier: mult, staffRequirement: 0 },
          monthsCount, yearsCount, mult
        );
        setBatchItems(prev => {
          const next = [...prev, calculatedItem];
          setSelectedIndices(prevSel => {
            const nextSel = new Set(prevSel);
            nextSel.add(next.length - 1);
            return nextSel;
          });
          return next;
        });
        addedThisRun.add(queryCode);
        if (details.upcCode) existingUpcs.add(details.upcCode);
        added++;
      } catch {
        failed++;
      }
    }

    setBulkLoading(false);
    setBulkProgress({ current: 0, total: 0 });
    if (added > 0) toast.success(`Bulk loaded ${added} item${added > 1 ? 's' : ''} successfully.${failed > 0 ? ` (${failed} not found)` : ''}`);
    else toast.error(`No items found. ${failed} code${failed > 1 ? 's' : ''} failed.`);
  };

  const handleSelectSuggestion = (s) => {
    handleAddItem(String(s.code));
  };

  // Toggle selection for a single row
  const handleToggleSelectRow = (index) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  // Toggle selection for all rows
  const handleToggleSelectAll = () => {
    if (selectedIndices.size === batchItems.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(batchItems.map((_, i) => i)));
    }
  };

  const handleRemoveRow = (index) => {
    if (inlineEditIndex === index) setInlineEditIndex(null);
    setBatchItems(prev => prev.filter((_, i) => i !== index));
    setSelectedIndices(prev => {
      const next = new Set();
      prev.forEach(i => {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      });
      return next;
    });
    toast.success('Item removed from planning grid');
  };

  // Bug 2: Save inline staff requirement edit
  const handleSaveInlineStaff = (index) => {
    const parsedStaff = Math.max(0, parseFloat(inlineEditVal) || 0);
    const mult = parseFloat(globalSeasonMultiplier) || 1.0;
    setBatchItems(prev => {
      const next = [...prev];
      if (next[index]) {
        next[index] = runRowCalculations(
          { ...next[index], staffRequirement: parsedStaff },
          monthsCount, yearsCount, mult
        );
      }
      return next;
    });
    setInlineEditIndex(null);
  };

  const handleClearGrid = () => {
    if (batchItems.length === 0) return;
    if (confirm('Clear all items from the current grid?')) {
      setBatchItems([]);
      setSelectedIndices(new Set());
      toast.success('Grid cleared');
    }
  };

  // Bulk Staff Requirement: parse paste input and apply values row-by-row in order
  const handleBulkStaffApply = () => {
    const raw = bulkStaffInput.trim();
    if (!raw) { toast.error('Please paste staff requirement values first.'); return; }
    if (batchItems.length === 0) { toast.error('The planning grid is empty. Add items first.'); return; }

    // Split by comma, whitespace, newline — accept any combo
    const values = raw.split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
    if (values.length === 0) { toast.error('No valid numbers found in input.'); return; }

    const mult = parseFloat(globalSeasonMultiplier) || 1.0;
    let applied = 0;

    const next = [...batchItems];
    for (let i = 0; i < values.length && i < next.length; i++) {
      const parsed = parseFloat(values[i]);
      if (isNaN(parsed) || parsed < 0) continue; // skip invalid tokens
      next[i] = runRowCalculations(
        { ...next[i], staffRequirement: parsed },
        monthsCount, yearsCount, mult
      );
      applied++;
    }

    if (applied > 0) {
      setBatchItems(next);
      setBulkStaffInput('');
      toast.success(`Applied staff requirements to ${applied} row${applied > 1 ? 's' : ''} in order.`);
    } else {
      toast.error('No valid numeric values were found.');
    }
  };

  // Save current grid rows to database and download file report
  const handleExport = async (format) => {
    const itemsToExport = batchItems.filter((_, idx) => selectedIndices.has(idx));
    if (itemsToExport.length === 0) {
      toast.error('No selected items to export.');
      return;
    }
    setExporting(format);
    try {
      // 1. Save selected items in the table to history
      const savePromises = itemsToExport.map(item =>
        api.post('/history', {
          itemCode: item.itemCode,
          itemName: item.itemName,
          upcCode: item.upcCode,
          stockOnHand: item.stockOnHand,
          lastOneMonthSale: item.lastOneMonthSale,
          lastOneYearSale: item.lastOneYearSale,
          cost: item.cost,
          seasonMultiplier: item.seasonMultiplier,
          averagePerMonth: item.averagePerMonth,
          systemRequirement: item.systemRequirement,
          staffRequirement: item.staffRequirement,
          finalRequirement: item.finalRequirement,
          afterPurchaseStock: item.afterPurchaseStock,
          purchaseAmount: item.purchaseAmount,
          rotation: item.rotation,
          sizeModel: item.sizeModel,
          supplierName: item.supplierName,
        })
      );
      const saveResults = await Promise.all(savePromises);
      
      // Get the IDs of the newly saved calculations
      const savedIds = saveResults.map(r => r.data?.data?.Id).filter(Boolean);

      if (savedIds.length === 0) {
        throw new Error('Failed to record grid to database calculations history');
      }

      // 2. Query file export using the exact saved history IDs
      const token = localStorage.getItem('inv_token');
      const url = `/api/export/${format}?ids=${savedIds.join(',')}&monthsCount=${monthsCount}&yearsCount=${yearsCount}&monthDays=${daysCount}&yearDays=${yearDays}&svRows=${encodeURIComponent(JSON.stringify(svRows))}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export service returned error');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `re_order_form_${Date.now()}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`${format.toUpperCase()} exported successfully!`);
    } catch (err) {
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setExporting(null);
    }
  };

  const handlePreviewPDF = async () => {
    const itemsToExport = batchItems.filter((_, idx) => selectedIndices.has(idx));
    if (itemsToExport.length === 0) {
      toast.error('No selected items to preview.');
      return;
    }
    setPreviewLoading(true);
    try {
      const savePromises = itemsToExport.map(item =>
        api.post('/history', {
          itemCode: item.itemCode,
          itemName: item.itemName,
          upcCode: item.upcCode,
          stockOnHand: item.stockOnHand,
          lastOneMonthSale: item.lastOneMonthSale,
          lastOneYearSale: item.lastOneYearSale,
          cost: item.cost,
          seasonMultiplier: item.seasonMultiplier,
          averagePerMonth: item.averagePerMonth,
          systemRequirement: item.systemRequirement,
          staffRequirement: item.staffRequirement,
          finalRequirement: item.finalRequirement,
          afterPurchaseStock: item.afterPurchaseStock,
          purchaseAmount: item.purchaseAmount,
          rotation: item.rotation,
          sizeModel: item.sizeModel,
          supplierName: item.supplierName,
        })
      );
      const saveResults = await Promise.all(savePromises);
      const savedIds = saveResults.map(r => r.data?.data?.Id).filter(Boolean);

      if (savedIds.length === 0) {
        throw new Error('Failed to record grid to database calculations history');
      }

      const token = localStorage.getItem('inv_token');
      const url = `/api/export/pdf?ids=${savedIds.join(',')}&monthsCount=${monthsCount}&yearsCount=${yearsCount}&monthDays=${daysCount}&yearDays=${yearDays}&svRows=${encodeURIComponent(JSON.stringify(svRows))}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Preview service returned error');
      const blob = await res.blob();
      
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      const objectUrl = URL.createObjectURL(blob);
      setPdfUrl(objectUrl);
      setShowPdfPreview(true);
      toast.success('PDF preview generated!');
    } catch (err) {
      toast.error(`Preview failed: ${err.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };



  // ── Stock Valuation Handlers ──────────────────────────────────────────────

  // When user selects a Group, populate the categories dropdown
  const handleSvGroupChange = (groupCode) => {
    setSvSelectedGroup(groupCode);
    setSvSelectedCategory('');
    if (!groupCode) { setSvCategories([]); return; }
    const found = svGroups.find(g => String(g.groupCode) === String(groupCode));
    setSvCategories(found ? found.categories : []);
  };

  // Fetch QTY+VALUE for the selected category and add to the table
  const handleSvAdd = async () => {
    if (!svSelectedCategory) { toast.error('Please select a category first.'); return; }
    const catObj = svCategories.find(c => String(c.categoryCode) === String(svSelectedCategory));
    if (!catObj) { toast.error('Category not found.'); return; }
    if (svRows.some(r => String(r.categoryCode) === String(svSelectedCategory))) {
      toast.error(`${catObj.categoryName} is already in the list.`); return;
    }
    setSvAddLoading(true);
    try {
      const res = await api.get(
        `/export/stock-valuation/category-stats?categoryCode=${svSelectedCategory}&fromDate=${salesFromDate}&toDate=${salesToDate}&categoryName=${encodeURIComponent(catObj.categoryName)}`
      );
      const data = res.data.data;
      setSvRows(prev => [...prev, {
        categoryCode: data.categoryCode,
        categoryName: data.categoryName,
        qty:   data.qty,
        value: data.value
      }]);
      toast.success(`Added: ${data.categoryName}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load category stats.');
    } finally {
      setSvAddLoading(false);
    }
  };

  // Remove a single row from the valuation table
  const handleSvRemove = (categoryCode) => {
    setSvRows(prev => prev.filter(r => String(r.categoryCode) !== String(categoryCode)));
  };

  // Clear all rows from the valuation table
  const handleSvClear = () => {
    if (svRows.length === 0) return;
    if (confirm('Clear all categories from Stock Valuation?')) {
      setSvRows([]);
      toast.success('Stock Valuation cleared.');
    }
  };

  // Export the valuation table as Excel or PDF
  const handleSvExport = async (format) => {
    if (svRows.length === 0) { toast.error('No categories in the valuation table.'); return; }
    setSvExporting(format);
    try {
      const token = localStorage.getItem('inv_token');
      const rowsParam = encodeURIComponent(JSON.stringify(svRows));
      const url = `/api/export/stock-valuation/${format}?rows=${rowsParam}&fromDate=${salesFromDate}&toDate=${salesToDate}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export service returned error');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `stock_valuation_${Date.now()}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Stock Valuation ${format.toUpperCase()} exported!`);
    } catch (err) {
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setSvExporting(null);
    }
  };

  // Preview PDF for Stock Valuation
  const handlePreviewSvPDF = async () => {
    if (svRows.length === 0) { toast.error('No categories in the valuation table.'); return; }
    setSvPreviewLoading(true);
    try {
      const token = localStorage.getItem('inv_token');
      const rowsParam = encodeURIComponent(JSON.stringify(svRows));
      const url = `/api/export/stock-valuation/pdf?rows=${rowsParam}&fromDate=${salesFromDate}&toDate=${salesToDate}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Preview service returned error');
      const blob = await res.blob();
      
      if (svPdfUrl) URL.revokeObjectURL(svPdfUrl);
      const objectUrl = URL.createObjectURL(blob);
      setSvPdfUrl(objectUrl);
      setShowSvPdfPreview(true);
      toast.success('Stock Valuation PDF preview generated!');
    } catch (err) {
      toast.error(`Preview failed: ${err.message}`);
    } finally {
      setSvPreviewLoading(false);
    }
  };

  // Preview Excel for Stock Valuation
  const handlePreviewSvExcel = () => {
    if (svRows.length === 0) { toast.error('No categories in the valuation table.'); return; }
    setShowSvExcelPreview(true);
    toast.success('Stock Valuation Excel preview generated!');
  };

  // Open Edit Modal for a single row item
  const handleOpenEdit = (index) => {
    const item = batchItems[index];
    if (!item) return;
    setEditingIndex(index);
    setEditingStaff(String(item.staffRequirement));
  };

  // Save changes from Edit Modal and apply to previous page grid
  const handleSaveEdit = () => {
    if (editingIndex === null) return;
    const parsedStaff = parseFloat(editingStaff) || 0;

    setBatchItems(prev => {
      const next = [...prev];
      if (next[editingIndex]) {
        next[editingIndex] = runRowCalculations(
          {
            ...next[editingIndex],
            staffRequirement: parsedStaff >= 0 ? parsedStaff : 0,
          },
          monthsCount,
          yearsCount,
          globalSeasonMultiplier
        );
      }
      return next;
    });

    setEditingIndex(null);
    toast.success('Staff requirement updated successfully!');
  };

  const allSelected = batchItems.length > 0 && selectedIndices.size === batchItems.length;

  // Render modal summary card layout (Receipt / Bill Format)
  const renderEditBillFormat = () => {
    if (editingIndex === null) return null;
    const item = batchItems[editingIndex];
    if (!item) return null;

    // Project preview values dynamically inside modal based on typed staff requirement
    const tempItem = runRowCalculations(
      {
        ...item,
        staffRequirement: parseFloat(editingStaff) || 0,
      },
      monthsCount,
      yearsCount,
      globalSeasonMultiplier
    );

    const billFields = [
      { label: 'Item Code', value: tempItem.itemCode, highlight: true },
      { label: 'Item Name', value: tempItem.itemName },
      { label: 'Size / Model', value: tempItem.sizeModel },
      { label: 'Supplier', value: tempItem.supplierName },
      { label: 'Cost', value: `₹${NUM(tempItem.cost, 2)}` },
      { label: 'Stock On Hand', value: NUM(tempItem.stockOnHand, 0) },
      { label: `Last ${monthsCount}m Sales`, value: NUM(tempItem.lastOneMonthSale, 0) },
      { label: 'Avg Per Month', value: NUM(tempItem.averagePerMonth, 0) },
      { label: `Last ${yearsCount}y Sales`, value: NUM(tempItem.lastOneYearSale, 0) },
      { label: 'System Requirement', value: tempItem.systemRequirement > 0 ? NUM(tempItem.systemRequirement, 0) : `(${NUM(Math.abs(tempItem.systemRequirement), 0)})`, color: tempItem.systemRequirement > 0 ? 'text-red-400' : 'text-emerald-400' },
      { label: 'After Purchase Stock', value: NUM(tempItem.afterPurchaseStock, 0), color: 'text-brand-300 font-bold' },
      { label: 'Purchase Amount', value: `₹${NUM(tempItem.purchaseAmount, 2)}`, color: 'text-emerald-400 font-bold' },
      { label: 'Rotation of Month', value: NUM(tempItem.rotation, 2) },
    ];

    return (
      <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-6 space-y-4 font-mono">
        <div className="border-b border-slate-800/50 pb-3 text-center">
          <p className="text-xs text-slate-500 uppercase tracking-widest">Planning Specification Bill</p>
        </div>
        <div className="divide-y divide-slate-800/30 text-sm">
          {billFields.map(f => (
            <div key={f.label} className="flex justify-between py-3 items-center gap-4">
              <span className="text-slate-400 text-left font-medium">{f.label}</span>
              <span className={`text-right font-bold truncate max-w-[360px] ${f.color || (f.highlight ? 'text-brand-400 font-bold' : 'text-slate-200')}`}>
                {f.value}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-800/50 pt-3 text-center">
          <p className="text-[11px] text-slate-500">Calculated under current parameters</p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calculator className="text-brand-400" size={24} />
            Re-Order Form
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Build inventory lists, override parameters, and generate high-quality Excel / PDF reports.
          </p>
        </div>
      </div>

      {/* Export Report Options Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center">
              <FileSpreadsheet size={20} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Export Grid to Excel</h3>
              <p className="text-xs text-slate-500">Professional .xlsx worksheet matching Excel templates</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (selectedIndices.size === 0) {
                  toast.error('No selected items to preview.');
                  return;
                }
                setShowExcelPreview(true);
              }}
              disabled={exporting !== null || selectedIndices.size === 0}
              className="btn-secondary py-2 flex-1 text-xs border-slate-800 hover:bg-slate-900"
            >
              <FileSpreadsheet size={14} />
              Preview Excel
            </button>
            <button
              id="export-excel-btn"
              onClick={() => handleExport('excel')}
              disabled={exporting !== null || selectedIndices.size === 0}
              className="btn-success flex-[2] justify-center text-xs py-2"
            >
              {exporting === 'excel' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {exporting === 'excel' ? 'Generating...' : `Export Excel (${selectedIndices.size})`}
            </button>
          </div>
        </div>

        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center">
              <FileText size={20} className="text-red-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Export Grid to PDF</h3>
              <p className="text-xs text-slate-500">Corporate-ready document for print orders &amp; invoices</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePreviewPDF}
              disabled={exporting !== null || previewLoading || selectedIndices.size === 0}
              className="btn-secondary py-2 flex-1 text-xs border-slate-800 hover:bg-slate-900"
            >
              {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              Preview PDF
            </button>
            <button
              id="export-pdf-btn"
              onClick={() => handleExport('pdf')}
              disabled={exporting !== null || previewLoading || selectedIndices.size === 0}
              className="btn-danger flex-[2] justify-center border-0 bg-red-600 hover:bg-red-700 text-white text-xs py-2"
            >
              {exporting === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {exporting === 'pdf' ? 'Generating...' : `Export PDF (${selectedIndices.size})`}
            </button>
          </div>
        </div>
      </div>



      {/* ── Stock Valuation Card ─────────────────────────── */}
      <div className="glass-card p-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="text-violet-400" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h18v4H3z"/><path d="M3 10h18v4H3z"/><path d="M3 17h18v4H3z"/>
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-400 animate-pulse"></span>
                Stock Valuation
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Select target date and categories to see dynamic closing stock quantities and valuations.
              </p>
            </div>
          </div>
          {svRows.length > 0 && (
            <button
              onClick={handleSvClear}
              className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400/50 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
            >
              <X size={12} /> Clear All
            </button>
          )}
        </div>

        {/* Selector Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[1.2fr_1.5fr_1.5fr_auto] gap-3 items-end">
          {/* Target Date */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">Target Date</label>
            <div className="relative">
              <input
                type="text"
                value={toDisplayDate(svDate)}
                onChange={e => {
                  const iso = parseDateInput(e.target.value);
                  if (iso) setSvDate(iso);
                }}
                placeholder="DD/MM/YYYY"
                className="form-input text-xs py-2 w-full pr-10 font-bold"
              />
              <input
                type="date"
                value={svDate}
                onChange={e => setSvDate(e.target.value)}
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

          {/* Group Select */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">Product Group</label>
            <div className="relative">
              <select
                id="sv-group-select"
                value={svSelectedGroup}
                onChange={e => handleSvGroupChange(e.target.value)}
                disabled={svGroupsLoading}
                className="form-input text-xs py-2 w-full appearance-none pr-8 cursor-pointer"
              >
                <option value="">
                  {svGroupsLoading ? 'Loading groups...' : '— Select a Group —'}
                </option>
                {svGroups.map(g => (
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

          {/* Category Select */}
          <div>
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider block mb-1">Category</label>
            <div className="relative">
              <select
                id="sv-category-select"
                value={svSelectedCategory}
                onChange={e => setSvSelectedCategory(e.target.value)}
                disabled={svCategories.length === 0}
                className="form-input text-xs py-2 w-full appearance-none pr-8 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {svSelectedGroup ? (svCategories.length === 0 ? 'No categories found' : '— Select a Category —') : '← Pick a group first'}
                </option>
                {svCategories.map(c => (
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

          {/* Add Button */}
          <button
            id="sv-add-btn"
            onClick={handleSvAdd}
            disabled={svAddLoading || !svSelectedCategory}
            className="btn-primary py-2 px-5 text-xs justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {svAddLoading
              ? <Loader2 size={14} className="animate-spin" />
              : <Plus size={14} />
            }
            {svAddLoading ? 'Loading...' : 'Add'}
          </button>
        </div>

        {/* Table */}
        {svRows.length > 0 && (() => {
          const totalQty   = svRows.reduce((s, r) => s + (parseFloat(r.qty)   || 0), 0);
          const totalValue = svRows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
          return (
            <div className="border border-slate-800/60 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800/60">
                      <th className="text-left px-4 py-3 font-semibold text-slate-300 uppercase tracking-wider">Category</th>
                      <th className="text-center px-4 py-3 font-semibold text-slate-300 uppercase tracking-wider">QTY</th>
                      <th className="text-right px-4 py-3 font-semibold text-slate-300 uppercase tracking-wider">VALUE ₹</th>
                      <th className="w-10 px-2 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {svRows.map((r, i) => (
                      <tr key={r.categoryCode} className={i % 2 === 0 ? 'bg-slate-900/20' : 'bg-slate-900/40'}>
                        <td className="px-4 py-3 font-medium text-slate-200">{r.categoryName}</td>
                        <td className="px-4 py-3 text-center text-slate-300 tabular-nums">
                          {NUM(r.qty, 0)}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-400 tabular-nums font-semibold">
                          ₹{NUM(r.value, 2)}
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={() => handleSvRemove(r.categoryCode)}
                            className="text-slate-500 hover:text-red-400 transition-colors rounded p-0.5 hover:bg-red-500/10"
                            title="Remove"
                          >
                            <X size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {/* TOTAL row */}
                    <tr className="bg-violet-900/20 border-t-2 border-violet-500/30">
                      <td className="px-4 py-3 font-bold text-violet-300 uppercase tracking-wide text-xs">Total</td>
                      <td className="px-4 py-3 text-center font-bold text-white tabular-nums">
                        {NUM(totalQty, 0)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-violet-300 tabular-nums text-sm">
                        ₹{NUM(totalValue, 2)}
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Export and Preview buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-3 border-t border-slate-800/60 bg-slate-900/30">
                {/* Excel Preview */}
                <button
                  onClick={handlePreviewSvExcel}
                  disabled={svExporting !== null || svPreviewLoading}
                  className="btn-secondary text-xs py-1.5 px-3 justify-center border-slate-800 hover:bg-slate-900 gap-1.5"
                >
                  <FileSpreadsheet size={13} />
                  Prev Excel
                </button>

                {/* Excel Export */}
                <button
                  id="sv-export-excel-btn"
                  onClick={() => handleSvExport('excel')}
                  disabled={svExporting !== null || svPreviewLoading}
                  className="btn-success text-xs py-1.5 px-3 justify-center gap-1.5"
                >
                  {svExporting === 'excel'
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Download size={13} />
                  }
                  Excel
                </button>

                {/* PDF Preview */}
                <button
                  onClick={handlePreviewSvPDF}
                  disabled={svExporting !== null || svPreviewLoading}
                  className="btn-secondary text-xs py-1.5 px-3 justify-center border-slate-800 hover:bg-slate-900 gap-1.5"
                >
                  {svPreviewLoading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                  Prev PDF
                </button>

                {/* PDF Export */}
                <button
                  id="sv-export-pdf-btn"
                  onClick={() => handleSvExport('pdf')}
                  disabled={svExporting !== null || svPreviewLoading}
                  className="btn-danger text-xs py-1.5 px-3 justify-center bg-red-600 hover:bg-red-700 border-0 text-white gap-1.5"
                >
                  {svExporting === 'pdf'
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Download size={13} />
                  }
                  PDF
                </button>
              </div>
            </div>
          );
        })()}

        {/* Empty state hint */}
        {svRows.length === 0 && (
          <div className="text-center py-6 text-slate-600 text-xs">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 mx-auto mb-2 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-6a2 2 0 012-2h2a2 2 0 012 2v6m-6 0h6m-3-9V4" />
            </svg>
            Select a group and category, then click <span className="text-violet-400 font-semibold">Add</span> to build your valuation table.
          </div>
        )}
      </div>

      {/* ── Item Finder Search Card (Full Width) ──────── */}
      <div className="glass-card p-5 space-y-6">
        <div className="space-y-3">
          {/* Row 1: Item Code Finder */}
          <div>
            <label className="form-label text-xs uppercase font-extrabold text-slate-300 tracking-wider mb-2 block">
              Item Code Finder
            </label>
            <div className="flex gap-3">
              <div ref={wrapperRef} className="relative flex-1 min-w-0">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
                <input
                  id="item-code-input"
                  type="text"
                  value={itemCodeInput}
                  onChange={e => setItemCodeInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setShowSug(false); handleAddItem(); } }}
                  disabled={bulkLoading}
                  onFocus={() => suggestions.length > 0 && setShowSug(true)}
                  className="form-input pl-10 w-full"
                  placeholder="Paste one or multiple codes (e.g. 59257, 11542, 51766) or Item Name..."
                  autoComplete="off"
                />
                {/* Bulk loading progress indicator */}
                {bulkLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    <Loader2 className="text-brand-400 animate-spin" size={14} />
                    <span className="text-[10px] text-brand-300 font-bold">{bulkProgress.current}/{bulkProgress.total}</span>
                  </div>
                )}
                {sugLoading && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" size={14} />
                )}

                {/* Suggestions dropdown Portal */}
                {showSug && (
                  <SuggestionsPortal
                    anchorRef={wrapperRef}
                    items={suggestions}
                    onSelect={handleSelectSuggestion}
                  />
                )}
              </div>
              <button
                onClick={() => handleAddItem()}
                disabled={loading || bulkLoading}
                className="btn-primary px-6 flex-shrink-0 animate-pulse-slow"
              >
                {(loading || bulkLoading) ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                {bulkLoading ? `${bulkProgress.current}/${bulkProgress.total}` : loading ? 'Finding...' : 'Find & Add'}
              </button>
            </div>
          </div>

          {/* Row 2: Bulk Staff Requirement paste field */}
          <div>
            <label className="form-label text-xs uppercase font-extrabold text-purple-400 tracking-wider mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400 inline-block"></span>
              Bulk Staff Requirement
              <span className="text-[9px] font-normal normal-case text-slate-500 ml-1">
                — Paste values (comma or space separated) and press Enter to apply row-by-row
              </span>
            </label>
            <div className="flex gap-3">
              <div className="relative flex-1 min-w-0">
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-500 pointer-events-none"
                  width={16} height={16} fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m4-5a4 4 0 110-8 4 4 0 010 8zm6 2a2 2 0 100-4 2 2 0 000 4zM3 15a2 2 0 100-4 2 2 0 000 4z"
                  />
                </svg>
                <input
                  id="bulk-staff-input"
                  type="text"
                  value={bulkStaffInput}
                  onChange={e => setBulkStaffInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleBulkStaffApply(); } }}
                  className="form-input pl-10 w-full border-purple-500/30 focus:border-purple-500/60 text-purple-200 placeholder:text-slate-600"
                  placeholder="e.g.  10, 25, 5, 8, 12   — applies to rows 1, 2, 3, 4, 5 in order"
                  autoComplete="off"
                />
                {bulkStaffInput.trim() && (
                  <button
                    onClick={() => setBulkStaffInput('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    title="Clear"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                id="bulk-staff-apply-btn"
                onClick={handleBulkStaffApply}
                disabled={!bulkStaffInput.trim() || batchItems.length === 0}
                className="btn-primary px-5 flex-shrink-0 bg-purple-700 hover:bg-purple-600 border-purple-600 hover:border-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg width={14} height={14} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Apply
              </button>
            </div>
            {/* Live preview token count */}
            {bulkStaffInput.trim() && (() => {
              const tokens = bulkStaffInput.trim().split(/[\s,]+/).filter(Boolean);
              const valid = tokens.filter(t => !isNaN(parseFloat(t)) && parseFloat(t) >= 0).length;
              return (
                <p className="text-[10px] text-slate-500 mt-1.5 ml-1">
                  <span className="text-purple-400 font-bold">{valid}</span> valid value{valid !== 1 ? 's' : ''} detected
                  {batchItems.length > 0 && (
                    <span> — will fill rows <span className="text-purple-400 font-bold">1</span> to <span className="text-purple-400 font-bold">{Math.min(valid, batchItems.length)}</span></span>
                  )}
                </p>
              );
            })()}
          </div>
        </div>

        {/* Global Multiplier & Date Boundaries Grid inside finder card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-slate-800/40">
          
          {/* Global Season Multiplier — Bug 5: use text input to allow backspace */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-extrabold uppercase text-brand-400 tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400"></span>
              Global Season Multiplier
            </h4>
            <div>
              <label className="text-[9px] text-slate-500 block mb-1">Applies to all products</label>
              <input
                type="text"
                inputMode="decimal"
                value={globalSeasonMultiplier}
                onChange={e => setGlobalSeasonMultiplier(e.target.value)}
                onBlur={e => {
                  const val = parseFloat(e.target.value);
                  setGlobalSeasonMultiplier(isNaN(val) || val < 0.1 ? '1.0' : String(val));
                }}
                className="form-input text-xs py-1.5 font-bold text-brand-300 border-brand-500/20 focus:border-brand-550"
                placeholder="e.g. 1.0"
              />
            </div>
          </div>

          {/* Sales Period (Months) — shows exact day count in label */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-extrabold uppercase text-amber-400 tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              Sales Period — <span className="text-amber-300">{formatMonthRangeLabel(daysCount)}</span>
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] text-slate-500 block mb-1">From Date</label>
                <div className="relative">
                  <input
                    type="text"
                    value={toDisplayDate(monthFromDate)}
                    onChange={e => {
                      const iso = parseDateInput(e.target.value);
                      if (iso) setMonthFromDate(iso);
                    }}
                    placeholder="DD/MM/YYYY"
                    className="form-input text-xs py-1.5 w-full pr-10 font-bold"
                  />
                  <input
                    type="date"
                    value={monthFromDate}
                    onChange={e => setMonthFromDate(e.target.value)}
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
              <div>
                <label className="text-[9px] text-slate-500 block mb-1">To Date</label>
                <div className="relative">
                  <input
                    type="text"
                    value={toDisplayDate(monthToDate)}
                    onChange={e => {
                      const iso = parseDateInput(e.target.value);
                      if (iso) setMonthToDate(iso);
                    }}
                    placeholder="DD/MM/YYYY"
                    className="form-input text-xs py-1.5 w-full pr-10 font-bold"
                  />
                  <input
                    type="date"
                    value={monthToDate}
                    onChange={e => setMonthToDate(e.target.value)}
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
            </div>
          </div>

          {/* Sales Period (Years) — full date pickers with manual typing */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-extrabold uppercase text-amber-400 tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              Sales Period — <span className="text-amber-300">{formatYearRangeLabel(yearDays)}</span>
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] text-slate-500 block mb-1">From Date</label>
                <div className="relative">
                  <input
                    type="text"
                    value={toDisplayDate(yearFromDate)}
                    onChange={e => {
                      const iso = parseDateInput(e.target.value);
                      if (iso) setYearFromDate(iso);
                    }}
                    placeholder="DD/MM/YYYY"
                    className="form-input text-xs py-1.5 w-full pr-10 font-bold"
                  />
                  <input
                    type="date"
                    value={yearFromDate}
                    onChange={e => setYearFromDate(e.target.value)}
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
              <div>
                <label className="text-[9px] text-slate-500 block mb-1">To Date</label>
                <div className="relative">
                  <input
                    type="text"
                    value={toDisplayDate(yearToDate)}
                    onChange={e => {
                      const iso = parseDateInput(e.target.value);
                      if (iso) setYearToDate(iso);
                    }}
                    placeholder="DD/MM/YYYY"
                    className="form-input text-xs py-1.5 w-full pr-10 font-bold"
                  />
                  <input
                    type="date"
                    value={yearToDate}
                    onChange={e => setYearToDate(e.target.value)}
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
            </div>
          </div>
        </div>
      </div>

      {/* ── Active Re-Order Batch Table ──────────────── */}
      <div className="glass-card overflow-hidden">
        {batchItems.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/40 border border-slate-700/30 flex items-center justify-center mx-auto mb-4">
              <ArrowDownToLine className="w-8 h-8 text-slate-600" />
            </div>
            <h3 className="text-base font-semibold text-slate-300 mb-1">Planning Grid is Empty</h3>
            <p className="text-slate-500 text-sm max-w-sm mx-auto mb-4">
              Enter item codes in the finder bar above to fetch sales statistics and run planning formulas.
            </p>
            <div className="flex gap-2 justify-center">
              {['59257', '11542', '51766', '900759'].map(code => (
                <button
                  key={code}
                  onClick={() => handleAddItem(code)}
                  className="badge badge-blue hover:bg-brand-600/40 transition-colors py-1.5 px-3 cursor-pointer"
                >
                  Quick Add #{code}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[1450px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/90 text-[10px] uppercase font-bold tracking-wider text-slate-400 whitespace-nowrap">
                  <th rowSpan={2} className="px-3 py-3 text-center w-[48px] min-w-[48px] max-w-[48px]">
                    <button onClick={handleToggleSelectAll} className="p-1 hover:bg-slate-800 rounded transition-colors">
                      {allSelected ? (
                        <CheckSquare className="w-4 h-4 text-brand-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500" />
                      )}
                    </button>
                  </th>
                  <th rowSpan={2} className="px-3 py-3 w-[100px] min-w-[100px] max-w-[100px] sticky left-0 bg-slate-900 border-r border-slate-800/80 z-20">ITEM CODE</th>
                  <th rowSpan={2} className="px-3 py-3 w-[130px] min-w-[130px] max-w-[130px]">BARCODE</th>
                  <th rowSpan={2} className="px-4 py-3 w-[220px] min-w-[220px] max-w-[220px]">ITEM NAME</th>
                  <th rowSpan={2} className="px-3 py-3 w-28 text-center text-red-300 bg-red-950/20 border-x border-slate-800">Sys Req</th>
                  {/* Bug 2: Staff Req header — click-to-edit inline */}
                  <th rowSpan={2} className="px-3 py-3 w-24 text-center text-purple-300 bg-purple-950/20 border-r border-slate-800 font-extrabold">Staff Req<br/><span className="text-[8px] text-purple-500 font-normal normal-case">(click to edit)</span></th>
                  <th rowSpan={2} className="px-3 py-3 w-24">Size/Model</th>
                  
                  {/* Yellow Highlights */}
                  <th rowSpan={2} className="px-3 py-3 text-amber-300 bg-amber-500/10 text-center font-extrabold border-r border-slate-800/50">Stock</th>
                  <th rowSpan={2} className="px-3 py-3 text-center">After Pur</th>
                  
                  {/* Bug 3: shows exact day count */}
                  <th rowSpan={2} className="px-3 py-3 text-amber-300 bg-amber-500/10 text-center font-extrabold border-x border-slate-800/50">
                    LAST {formatMonthRangeLabel(daysCount)} SALE
                  </th>
                  
                  {/* Merged parent header for Last One Year Sales columns */}
                  <th colSpan={2} className="px-3 py-2 text-amber-300 bg-amber-500/10 text-center font-extrabold border-r border-slate-800/50">
                    LAST {formatYearRangeLabel(yearDays)} SALES
                  </th>
                  {/* Bug 3: month header shows days */}
                  
                  <th rowSpan={2} className="px-3 py-3 text-amber-300 bg-amber-500/10 text-center font-extrabold border-r border-slate-800/50">Cost</th>
                  
                  <th rowSpan={2} className="px-3 py-3 text-center text-emerald-400 bg-emerald-950/10">Amount</th>
                  <th rowSpan={2} className="px-3 py-3 text-center">Rotation</th>
                  <th rowSpan={2} className="px-3 py-3 w-40">Supplier</th>
                  <th rowSpan={2} className="px-3 py-3 text-center w-24">Action</th>
                </tr>
                <tr className="border-b border-slate-800 bg-slate-900/90 text-[10px] uppercase font-bold tracking-wider text-slate-400 whitespace-nowrap">
                  <th className="px-3 py-2 text-amber-300 bg-amber-500/10 text-center font-extrabold border-r border-slate-800/50">Avg/Mo</th>
                  <th className="px-3 py-2 text-amber-300 bg-amber-500/10 text-center font-extrabold border-r border-slate-800/50">
                    LAST {formatYearRangeLabel(yearDays)}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {batchItems.map((item, index) => {
                  const isChecked = selectedIndices.has(index);
                  return (
                    <tr
                      key={index}
                      onClick={() => handleToggleSelectRow(index)}
                      className={`cursor-pointer transition-colors group ${
                        isChecked ? 'bg-brand-500/10 hover:bg-brand-500/15' : 'hover:bg-slate-800/25'
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-3.5 text-center w-[48px] min-w-[48px] max-w-[48px] transition-colors" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleToggleSelectRow(index)} className="p-1 rounded">
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-brand-400" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                          )}
                        </button>
                      </td>

                      {/* Item Code */}
                      <td className={`px-3 py-3.5 w-[100px] min-w-[100px] max-w-[100px] sticky left-0 z-10 border-r border-slate-800/80 transition-colors ${isChecked ? 'bg-[#121c2e] group-hover:bg-[#16253e]' : 'bg-[#0b0f19] group-hover:bg-slate-800'}`}>
                        <span className="badge badge-blue">{item.itemCode}</span>
                      </td>

                      {/* Barcode */}
                      <td className="px-3 py-3.5 w-[130px] min-w-[130px] max-w-[130px] transition-colors">
                        <span className="text-slate-400 font-mono">{item.upcCode || '—'}</span>
                      </td>

                      {/* Item Name */}
                      <td className="px-4 py-3.5 font-semibold text-slate-200 w-[220px] min-w-[220px] max-w-[220px] transition-colors whitespace-normal truncate" title={item.itemName}>
                        {item.itemName}
                      </td>

                      {/* System Requirement */}
                      <td className="px-3 py-3.5 text-center bg-red-950/5 border-x border-slate-800">
                        <span className={`font-bold text-xs ${item.systemRequirement > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                          {item.systemRequirement > 0 ? NUM(item.systemRequirement, 0) : `(${NUM(Math.abs(item.systemRequirement), 0)})`}
                        </span>
                      </td>

                      {/* Bug 2: Inline editable Staff Requirement cell */}
                      <td
                        className="px-3 py-3.5 text-center bg-purple-950/5 border-r border-slate-800 text-purple-300 font-extrabold cursor-pointer hover:bg-purple-950/20 transition-colors"
                        onClick={e => {
                          e.stopPropagation();
                          setInlineEditIndex(index);
                          setInlineEditVal(String(item.staffRequirement));
                        }}
                        title="Click to edit staff requirement"
                      >
                        {inlineEditIndex === index ? (
                          <input
                            type="number"
                            min="0"
                            value={inlineEditVal}
                            onChange={e => setInlineEditVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { handleSaveInlineStaff(index); }
                              if (e.key === 'Escape') { setInlineEditIndex(null); }
                            }}
                            onBlur={() => handleSaveInlineStaff(index)}
                            onClick={e => e.stopPropagation()}
                            autoFocus
                            className="w-16 text-center bg-purple-950/30 border border-purple-500/50 rounded px-1 py-0.5 text-purple-200 font-bold text-xs outline-none focus:ring-1 focus:ring-purple-500"
                          />
                        ) : (
                          <span>{NUM(item.staffRequirement, 0)}</span>
                        )}
                      </td>

                      {/* Size / Model */}
                      <td className="px-3 py-3.5 font-medium text-slate-300">{item.sizeModel}</td>

                      {/* Stock On Hand */}
                      <td className="px-3 py-3.5 text-center bg-amber-500/5 border-r border-slate-800/40 text-slate-200 font-semibold">
                        {NUM(item.stockOnHand, 0)}
                      </td>

                      {/* After Purchase */}
                      <td className="px-3 py-3.5 text-center font-semibold text-brand-300">
                        {NUM(item.afterPurchaseStock, 0)}
                      </td>

                      {/* Last N Months Sale */}
                      <td className="px-3 py-3.5 text-center bg-amber-500/5 border-x border-slate-800/40 text-slate-200 font-semibold">
                        {NUM(item.lastOneMonthSale, 0)}
                      </td>

                      {/* Avrage Per Month */}
                      <td className="px-3 py-3.5 text-center bg-amber-500/5 border-r border-slate-800/40 text-slate-200 font-semibold">
                        {NUM(item.averagePerMonth, 0)}
                      </td>

                      {/* Last N Years Sales */}
                      <td className="px-3 py-3.5 text-center bg-amber-500/5 border-r border-slate-800/40 text-slate-200 font-semibold">
                        {NUM(item.lastOneYearSale, 0)}
                      </td>

                      {/* Cost */}
                      <td className="px-3 py-3.5 text-center bg-amber-500/5 border-r border-slate-800/40 text-amber-300 font-bold">
                        {NUM(item.cost, 2)}
                      </td>

                      {/* Amount */}
                      <td className="px-3 py-3.5 text-center bg-emerald-950/5 font-bold text-emerald-400">
                        {NUM(item.purchaseAmount, 2)}
                      </td>

                      {/* Current Stock / Rotation of Month */}
                      <td className={`px-3 py-3.5 text-center font-medium ${item.rotation === 0 ? 'text-red-400' : item.rotation > 3 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {NUM(item.rotation, 2)}
                      </td>

                      {/* Supplier */}
                      <td className="px-3 py-3.5 text-slate-300 min-w-[150px] whitespace-normal" title={item.supplierName}>
                        {item.supplierName}
                      </td>

                      {/* Bug 2: Action column — only Delete remains; Edit removed */}
                      <td className="px-3 py-3.5 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setDeletingIndex(index)}
                            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700/50 text-slate-500 hover:text-red-400 transition-colors"
                            title="Remove row"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Totals Row */}
                {batchItems.length > 0 && (
                  <tr className="bg-slate-900/90 font-bold border-t-2 border-slate-800 text-xs text-slate-200">
                    <td className="px-3 py-3.5 w-[48px] min-w-[48px] max-w-[48px] bg-slate-900 border-b border-slate-800"></td>
                    <td className="px-3 py-3.5 w-[100px] min-w-[100px] max-w-[100px] sticky left-0 z-10 bg-slate-900 border-r border-slate-800/80 border-b border-slate-800"></td>
                    <td className="px-3 py-3.5 w-[130px] min-w-[130px] max-w-[130px] bg-slate-900 border-b border-slate-800"></td>
                    <td className="px-4 py-3.5 w-[220px] min-w-[220px] max-w-[220px] bg-slate-900 border-b border-slate-800 text-right uppercase tracking-wider font-extrabold text-slate-400">
                      Total
                    </td>
                    
                    {/* System Requirement Total */}
                    <td className="px-3 py-3.5 text-center bg-red-950/20 border-x border-slate-800">
                      {(() => {
                        const totalSys = batchItems.reduce((acc, item) => acc + (parseFloat(item.systemRequirement) || 0), 0);
                        return (
                          <span className={`font-bold ${totalSys > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {totalSys > 0 ? NUM(totalSys, 0) : `(${NUM(Math.abs(totalSys), 0)})`}
                          </span>
                        );
                      })()}
                    </td>

                    {/* Staff Requirement Total */}
                    <td className="px-3 py-3.5 text-center bg-purple-950/20 border-r border-slate-800 text-purple-300 font-extrabold">
                      {NUM(batchItems.reduce((acc, item) => acc + (parseFloat(item.staffRequirement) || 0), 0), 0)}
                    </td>

                    {/* Size/Model */}
                    <td className="px-3 py-3.5"></td>

                    {/* Stock Total */}
                    <td className="px-3 py-3.5 text-center bg-amber-500/10 border-r border-slate-800/40 text-slate-200 font-extrabold">
                      {NUM(batchItems.reduce((acc, item) => acc + (parseFloat(item.stockOnHand) || 0), 0), 0)}
                    </td>

                    {/* After Purchase Total */}
                    <td className="px-3 py-3.5 text-center font-extrabold text-brand-300">
                      {NUM(batchItems.reduce((acc, item) => acc + (parseFloat(item.afterPurchaseStock) || 0), 0), 0)}
                    </td>

                    {/* Last Month Sale */}
                    <td className="px-3 py-3.5 bg-amber-500/5 border-x border-slate-800/40"></td>

                    {/* Avg Per Month */}
                    <td className="px-3 py-3.5 bg-amber-500/5 border-r border-slate-800/40"></td>

                    {/* Last Year Sale */}
                    <td className="px-3 py-3.5 bg-amber-500/5 border-r border-slate-800/40"></td>

                    {/* Cost */}
                    <td className="px-3 py-3.5 bg-amber-500/5 border-r border-slate-800/40"></td>

                    {/* Purchase Amount Total */}
                    <td className="px-3 py-3.5 text-center bg-emerald-950/15 font-extrabold text-emerald-400">
                      ₹{NUM(batchItems.reduce((acc, item) => acc + (parseFloat(item.purchaseAmount) || 0), 0), 2)}
                    </td>

                    {/* Rotation */}
                    <td className="px-3 py-3.5"></td>

                    {/* Supplier */}
                    <td className="px-3 py-3.5"></td>

                    {/* Action */}
                    <td className="px-3 py-3.5"></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Clear Grid option if active items list exists */}
      {batchItems.length > 0 && (
        <div className="flex justify-end mt-4">
          <button
            onClick={handleClearGrid}
            className="btn-secondary text-sm border-slate-850 hover:bg-slate-900"
          >
            <RotateCcw size={14} />
            Reset Grid
          </button>
        </div>
      )}

      {/* Legend / Info */}
      <div className="flex items-start gap-2.5 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl text-xs text-slate-500">
        <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>
            <strong className="text-slate-300">Tips:</strong> Sales data queries dynamically calculate sums from the database using the customized <strong className="text-brand-300">Sales Period ranges</strong> entered above.
          </p>
          <p>
            The <strong className="text-red-400">System Requirement</strong> column displays surplus quantities in parentheses (e.g. `(15)` represents -15 surplus stock).
          </p>
        </div>
      </div>

      {/* ── Bounded, Scrollable Edit Modal (Guarantees Save Button visibility) ── */}
      {editingIndex !== null && createPortal(
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full flex flex-col max-h-[82vh] shadow-2xl overflow-hidden">
            
            {/* Modal Header (Fixed) */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800 flex-shrink-0">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit2 size={16} className="text-brand-400" />
                Update Staff Requirement
              </h3>
              <button
                onClick={() => setEditingIndex(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Prominent Staff Requirement Input on Top (Fixed) */}
            <div className="p-5 border-b border-slate-800/50 bg-slate-950/20 space-y-2 flex-shrink-0">
              <label className="text-xs uppercase font-extrabold text-purple-300 tracking-wider block">
                Enter Staff Requirement
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={editingStaff}
                onChange={e => setEditingStaff(e.target.value)}
                className="form-input text-base font-bold text-purple-300 border-purple-500/30 focus:border-purple-500 w-full py-2.5"
                placeholder="Enter required units..."
                autoFocus
              />
            </div>

            {/* Scrollable Receipt Bill Content (Flexible middle with min-h-0) */}
            <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-4">
              <label className="text-xs uppercase font-extrabold text-slate-400 tracking-wider block">
                Item Verification Bill
              </label>
              {renderEditBillFormat()}
            </div>

            {/* Modal Actions Footer (Fixed at the bottom, always visible) */}
            <div className="flex justify-end gap-3 p-5 border-t border-slate-800 bg-slate-950/40 flex-shrink-0">
              <button
                onClick={() => setEditingIndex(null)}
                className="btn-secondary py-2.5 px-6 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="btn-primary py-2.5 px-7 text-sm font-semibold shadow-lg shadow-brand-900/20"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Bounded, Gorgeous Delete Confirmation Modal ── */}
      {deletingIndex !== null && createPortal(
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full flex flex-col shadow-2xl overflow-hidden p-6 space-y-6 animate-slide-up">
            
            {/* Warning Icon & Title */}
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 shadow-lg shadow-red-950/20">
                <Trash2 size={24} className="animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">Remove Item from Grid?</h3>
                <p className="text-xs text-slate-400 max-w-xs">
                  Are you sure you want to remove this product? You will lose its calculated planning values.
                </p>
              </div>
            </div>

            {/* Mini Item Preview Box */}
            {batchItems[deletingIndex] && (
              <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-200 truncate">{batchItems[deletingIndex].itemName}</p>
                  <p className="text-slate-500 text-[10px] mt-0.5">Code: {batchItems[deletingIndex].itemCode}</p>
                </div>
                <span className="badge badge-blue flex-shrink-0">
                  {batchItems[deletingIndex].sizeModel || '—'}
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeletingIndex(null)}
                className="btn-secondary py-2.5 px-5 text-sm font-semibold flex-1 justify-center"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deletingIndex !== null) {
                    handleRemoveRow(deletingIndex);
                    setDeletingIndex(null);
                  }
                }}
                className="btn-danger py-2.5 px-6 text-sm font-semibold flex-1 justify-center border-0 bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-950/25"
              >
                Yes, Remove
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}

      {/* ── Bounded, gorgeous PDF Preview Modal (Full Screen) ── */}
      {showPdfPreview && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex flex-col p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-850 flex-shrink-0 bg-slate-950/35">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileText size={18} className="text-red-400" />
                  PDF Report Print Preview
                </h3>
                <p className="text-[11px] text-slate-400">Verify print margins, page layout, and supplier names before saving.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = pdfUrl;
                    a.download = `re_order_form_${Date.now()}.pdf`;
                    a.click();
                  }}
                  className="btn-primary text-xs py-2 px-4 shadow bg-red-600 hover:bg-red-700 border-0"
                >
                  <Download size={13} className="inline mr-1.5" />
                  Download PDF
                </button>
                <button
                  onClick={() => {
                    setShowPdfPreview(false);
                    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
                    setPdfUrl('');
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
                src={`${pdfUrl}#toolbar=1`}
                className="w-full h-full border-0 rounded-lg bg-slate-900"
                title="PDF Report Preview"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Bounded, spreadsheet-styled Excel Preview Modal ── */}
      {showExcelPreview && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex flex-col p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-850 flex-shrink-0 bg-slate-950/35">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileSpreadsheet size={18} className="text-emerald-400" />
                  Excel Worksheet Grid Preview
                </h3>
                <p className="text-[11px] text-slate-400">Verification grid displaying columns, headers, and formulas matching the exported spreadsheet.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setShowExcelPreview(false);
                    handleExport('excel');
                  }}
                  className="btn-primary text-xs py-2 px-4 shadow bg-emerald-600 hover:bg-emerald-700 border-0"
                >
                  <Download size={13} className="inline mr-1.5" />
                  Download Excel (.xlsx)
                </button>
                <button
                  onClick={() => setShowExcelPreview(false)}
                  className="text-slate-400 hover:text-white p-1 bg-slate-800 hover:bg-slate-750 border border-slate-700/60 rounded-lg transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Simulated Excel Workbook Canvas */}
            <div className="flex-1 min-h-0 bg-slate-950 overflow-auto p-6 flex justify-center">
              <div className="bg-white text-slate-800 font-sans shadow-xl border border-slate-300 w-full max-w-5xl rounded overflow-hidden min-w-[900px] flex flex-col h-fit">
                
                {/* Excel Row Index Headers (Left side numbers) and grid simulation */}
                <div className="bg-slate-100 border-b border-slate-200 text-[10px] text-slate-400 font-bold px-2 py-1 select-none flex justify-between">
                  <span>Excel Worksheet Canvas (Read-Only Preview)</span>
                  <span>Sheet1</span>
                </div>

                {/* Company Banner */}
                <div className="border-b border-slate-300 text-center py-3 bg-slate-50 font-bold text-slate-900 tracking-wider">
                  <div className="text-sm">INDIA SILK HOUSE</div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">RE-ORDER FORM - {new Date().toLocaleDateString('en-GB')}</div>
                </div>

                {/* Excel Table wrapper with horizontal scrolling */}
                <div className="overflow-x-auto w-full">
                  <table className="w-full border-collapse text-[11px] text-slate-700 min-w-[1300px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300">
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-10">SL</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-16">ITEM CODE</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-24">BARCODE</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-left w-48">ITEM NAME</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-16">Sys Req</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-16">Staff Req</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-16">Size/Model</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-16">Stock</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-16">After Pur</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-24">LAST {formatMonthRangeLabel(daysCount)} SALE</th>
                        <th colSpan={2} className="border-r border-b border-slate-200 px-2 py-1 text-center bg-slate-50">LAST {formatYearRangeLabel(yearDays)} SALES</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-16">Cost</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-20">Amount</th>
                        <th rowSpan={2} className="border-r border-slate-200 px-2 py-2 text-center w-24">Rotation</th>
                        <th rowSpan={2} className="px-2 py-2 text-left w-36">Supplier</th>
                      </tr>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300">
                        <th className="border-r border-slate-200 px-2 py-1 text-center w-20">Avg/Mo</th>
                        <th className="border-r border-slate-200 px-2 py-1 text-center w-24">LAST {formatYearRangeLabel(yearDays)}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {batchItems
                        .filter((_, idx) => selectedIndices.has(idx))
                        .map((item, idx) => {
                          const sysVal = parseFloat(item.systemRequirement) || 0;
                          return (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-400">{idx + 1}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-mono font-semibold">{item.itemCode}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-500">{item.upcCode || '—'}</td>
                              <td className="border-r border-slate-200 px-2 py-2 font-semibold text-slate-800 truncate max-w-[200px]" title={item.itemName}>{item.itemName}</td>
                              <td className={`border-r border-slate-200 px-2 py-2 text-center font-bold ${sysVal > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                {sysVal > 0 ? NUM(sysVal, 0) : `(${NUM(Math.abs(sysVal), 0)})`}
                              </td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-bold text-purple-700">{NUM(item.staffRequirement, 0)}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center text-slate-500">{item.sizeModel || '—'}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold">{NUM(item.stockOnHand, 0)}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold text-brand-600">{NUM(item.afterPurchaseStock, 0)}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold">{NUM(item.lastOneMonthSale, 0)}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center">{NUM(item.averagePerMonth, 0)}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold">{NUM(item.lastOneYearSale, 0)}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-right font-mono">₹{NUM(item.cost, 2)}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-right font-mono font-bold text-emerald-600">₹{NUM(item.purchaseAmount, 2)}</td>
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-mono">{NUM(item.rotation, 2)}</td>
                              <td className="px-2 py-2 text-slate-600 truncate max-w-[150px]" title={item.supplierName}>{item.supplierName}</td>
                            </tr>
                          );
                        })}
                      {/* Summary Totals Row for Re-Order Excel Preview */}
                      {batchItems.filter((_, idx) => selectedIndices.has(idx)).length > 0 && (
                        <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
                          <td className="border-r border-slate-200 px-2 py-2"></td>
                          <td className="border-r border-slate-200 px-2 py-2"></td>
                          <td className="border-r border-slate-200 px-2 py-2"></td>
                          <td className="border-r border-slate-200 px-2 py-2 text-right text-slate-700 text-[10px] font-extrabold uppercase">TOTAL</td>
                          <td className="border-r border-slate-200 px-2 py-2 text-center">
                            {(() => {
                              const totalSys = batchItems.filter((_, idx) => selectedIndices.has(idx)).reduce((acc, curr) => acc + (parseFloat(curr.systemRequirement) || 0), 0);
                              return (
                                <span className={totalSys > 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'}>
                                  {totalSys > 0 ? NUM(totalSys, 0) : `(${NUM(Math.abs(totalSys), 0)})`}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="border-r border-slate-200 px-2 py-2 text-center font-bold text-purple-700">
                            {NUM(batchItems.filter((_, idx) => selectedIndices.has(idx)).reduce((acc, curr) => acc + (parseFloat(curr.staffRequirement) || 0), 0), 0)}
                          </td>
                          <td className="border-r border-slate-200 px-2 py-2"></td>
                          <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold text-slate-900">
                            {NUM(batchItems.filter((_, idx) => selectedIndices.has(idx)).reduce((acc, curr) => acc + (parseFloat(curr.stockOnHand) || 0), 0), 0)}
                          </td>
                          <td className="border-r border-slate-200 px-2 py-2 text-center font-bold text-brand-600">
                            {NUM(batchItems.filter((_, idx) => selectedIndices.has(idx)).reduce((acc, curr) => acc + (parseFloat(curr.afterPurchaseStock) || 0), 0), 0)}
                          </td>
                          <td className="border-r border-slate-200 px-2 py-2"></td>
                          <td className="border-r border-slate-200 px-2 py-2"></td>
                          <td className="border-r border-slate-200 px-2 py-2"></td>
                          <td className="border-r border-slate-200 px-2 py-2"></td>
                          <td className="border-r border-slate-200 px-2 py-2 text-right font-mono font-bold text-emerald-600">
                            ₹{NUM(batchItems.filter((_, idx) => selectedIndices.has(idx)).reduce((acc, curr) => acc + (parseFloat(curr.purchaseAmount) || 0), 0), 2)}
                          </td>
                          <td className="border-r border-slate-200 px-2 py-2"></td>
                        </tr>
                      )}
                      {/* Blank separator rows and Stock Valuation table inside Re-Order Excel Preview */}
                      {svRows.length > 0 && (
                        <>
                          <tr className="h-6"><td colSpan={16} className="border-b-0"></td></tr>
                          <tr className="bg-slate-100 font-bold border-b border-slate-300">
                            <td className="border-r border-slate-200 px-2 py-1.5 text-center"></td>
                            <td className="border-r border-slate-200 px-2 py-1.5 text-center"></td>
                            <td className="border-r border-slate-200 px-2 py-1.5 text-center"></td>
                            <td className="border-r border-slate-200 px-2 py-1.5 text-left font-bold text-slate-800">CATEGORY</td>
                            <td className="border-r border-slate-200 px-2 py-1.5 text-center font-bold text-slate-800">QTY</td>
                            <td className="border-r border-slate-200 px-2 py-1.5 text-right font-bold text-slate-800">VALUE (₹)</td>
                            {Array.from({ length: 10 }).map((_, i) => (
                              <td key={i} className="border-r border-slate-200 last:border-r-0"></td>
                            ))}
                          </tr>
                          {svRows.map((r, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="border-r border-slate-200 px-2 py-1.5"></td>
                              <td className="border-r border-slate-200 px-2 py-1.5"></td>
                              <td className="border-r border-slate-200 px-2 py-1.5"></td>
                              <td className="border-r border-slate-200 px-2 py-1.5 font-semibold text-slate-800">{r.categoryName}</td>
                              <td className="border-r border-slate-200 px-2 py-1.5 text-center font-mono">{NUM(r.qty, 0)}</td>
                              <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono font-bold text-emerald-600">₹{NUM(r.value, 2)}</td>
                              {Array.from({ length: 10 }).map((_, i) => (
                                <td key={i} className="border-r border-slate-200 last:border-r-0"></td>
                              ))}
                            </tr>
                          ))}
                          <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
                            <td className="border-r border-slate-200 px-2 py-1.5"></td>
                            <td className="border-r border-slate-200 px-2 py-1.5"></td>
                            <td className="border-r border-slate-200 px-2 py-1.5"></td>
                            <td className="border-r border-slate-200 px-2 py-1.5 text-right text-slate-700 text-[10px] font-extrabold uppercase">TOTAL</td>
                            <td className="border-r border-slate-200 px-2 py-1.5 text-center font-mono text-slate-900">
                              {NUM(svRows.reduce((acc, curr) => acc + (parseFloat(curr.qty) || 0), 0), 0)}
                            </td>
                            <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono text-emerald-600 font-extrabold">
                              ₹{NUM(svRows.reduce((acc, curr) => acc + (parseFloat(curr.value) || 0), 0), 2)}
                            </td>
                            {Array.from({ length: 10 }).map((_, i) => (
                              <td key={i} className="border-r border-slate-200 last:border-r-0"></td>
                            ))}
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



      {/* ── Stock Valuation PDF Preview Modal (Full Screen) ── */}
      {showSvPdfPreview && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex flex-col p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-850 flex-shrink-0 bg-slate-950/35">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileText size={18} className="text-violet-400" />
                  Stock Valuation PDF Print Preview
                </h3>
                <p className="text-[11px] text-slate-400">Verify category aggregates, sold quantities, and values before printing.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = svPdfUrl;
                    a.download = `stock_valuation_${Date.now()}.pdf`;
                    a.click();
                  }}
                  className="btn-primary text-xs py-2 px-4 shadow bg-violet-600 hover:bg-violet-700 border-0 gap-1.5"
                >
                  <Download size={13} />
                  Download PDF
                </button>
                <button
                  onClick={() => {
                    setShowSvPdfPreview(false);
                    if (svPdfUrl) URL.revokeObjectURL(svPdfUrl);
                    setSvPdfUrl('');
                  }}
                  className="text-slate-400 hover:text-white p-1 bg-slate-850 hover:bg-slate-800 border border-slate-700/60 rounded-lg transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Embedded PDF iframe */}
            <div className="flex-1 min-h-0 bg-slate-950 p-2">
              <iframe
                src={`${svPdfUrl}#toolbar=1`}
                className="w-full h-full border-0 rounded-lg bg-slate-900"
                title="Stock Valuation PDF Preview"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Stock Valuation Excel Preview Modal ── */}
      {showSvExcelPreview && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[9999] flex flex-col p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-850 flex-shrink-0 bg-slate-950/35">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileSpreadsheet size={18} className="text-emerald-400" />
                  Stock Valuation Excel Worksheet Grid Preview
                </h3>
                <p className="text-[11px] text-slate-400">Preview Excel columns, category names, sold quantities, and sales values.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setShowSvExcelPreview(false);
                    handleSvExport('excel');
                  }}
                  className="btn-primary text-xs py-2 px-4 shadow bg-emerald-600 hover:bg-emerald-700 border-0 gap-1.5"
                >
                  <Download size={13} />
                  Download Excel (.xlsx)
                </button>
                <button
                  onClick={() => setShowSvExcelPreview(false)}
                  className="text-slate-400 hover:text-white p-1 bg-slate-850 hover:bg-slate-850 border border-slate-700/60 rounded-lg transition-all"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Simulated Excel Workbook Canvas */}
            <div className="flex-1 min-h-0 bg-slate-950 overflow-auto p-6 flex justify-center">
              <div className="bg-white text-slate-800 font-sans shadow-xl border border-slate-300 w-full max-w-2xl rounded overflow-hidden min-w-[500px] flex flex-col h-fit">
                
                {/* Header Info */}
                <div className="bg-slate-100 border-b border-slate-200 text-[10px] text-slate-400 font-bold px-2 py-1 select-none flex justify-between">
                  <span>Excel Worksheet Canvas (Read-Only Preview)</span>
                  <span>Valuation Report</span>
                </div>

                {/* Company Banner */}
                <div className="border-b border-slate-300 text-center py-3 bg-slate-50 font-bold text-slate-900 tracking-wider">
                  <div className="text-sm">INDIA SILK HOUSE</div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                    STOCK VALUATION REPORT ({toDisplayDate(salesFromDate)})
                  </div>
                </div>

                {/* Excel Table wrapper with horizontal scrolling */}
                <div className="overflow-x-auto w-full">
                  <table className="w-full border-collapse text-[11px] text-slate-700 min-w-[450px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300 text-center">
                        <th className="border-r border-slate-200 px-2 py-2 w-10">SL</th>
                        <th className="border-r border-slate-200 px-2 py-2 text-left w-56">CATEGORY</th>
                        <th className="border-r border-slate-200 px-2 py-2 w-20">QTY</th>
                        <th className="px-2 py-2 w-24">VALUE (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {svRows.map((item, idx) => {
                        const quantity = parseFloat(item.qty) || 0;
                        const value = parseFloat(item.value) || 0;

                        return (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-400">{idx + 1}</td>
                            <td className="border-r border-slate-200 px-2 py-2 font-semibold text-slate-800 truncate" title={item.categoryName}>{item.categoryName}</td>
                            <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold font-mono">{NUM(quantity, 0)}</td>
                            <td className="px-2 py-2 text-right font-mono font-bold text-emerald-600">₹{NUM(value, 2)}</td>
                          </tr>
                        );
                      })}

                      {/* Summary Totals Row */}
                      <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
                        <td colSpan={2} className="border-r border-slate-200 px-2 py-2 text-right text-slate-700 text-[10px]">TOTAL</td>
                        <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-900">
                          {NUM(svRows.reduce((acc, curr) => acc + (parseFloat(curr.qty) || 0), 0), 0)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-emerald-600 font-extrabold">
                          ₹{NUM(svRows.reduce((acc, curr) => acc + (parseFloat(curr.value) || 0), 0), 2)}
                        </td>
                      </tr>
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
