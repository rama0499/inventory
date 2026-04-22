import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inv, AlertSvc, Analytics, ActionHistory, playAlertSound, stopAlertSound, formatCurrency, formatDisplayDate, getSalesSpeed, getDaysUntilStockout } from '@/lib/services';
import type { User, Organization, BusinessMode, Product, Alert, Suggestion, ActionLog } from '@/lib/database';
import { CATEGORIES, UNITS } from '@/lib/database';
import { compareExpiryDates, getDaysUntilExpiry, parseInventoryCsvText } from '@/lib/inventory-utils';
import {
  LayoutDashboard, Package, Bell, Lightbulb, BarChart3, DollarSign,
  LogOut, Search, Plus, FileText, Upload, X, Check,
  AlertTriangle, TrendingDown, Clock, ShoppingCart,
  RefreshCw, Volume2, Menu, Tag, Truck, TrendingUp, Zap, ArrowLeft,
  Skull, Timer, PackageOpen, Gauge, Sun, History, Trash2, MinusCircle
} from 'lucide-react';

interface Props {
  user: User;
  business: Organization;
  mode: BusinessMode;
  onLogout: () => void;
  onBackToModeSelect: () => void;
}

type Tab = 'overview' | 'inventory' | 'alerts' | 'suggestions' | 'analytics' | 'financials' | 'history';
type AlertCategory = 'all' | 'expired' | 'expiring' | 'lowstock' | 'outofstock' | 'overstock' | 'salesspeed' | 'seasonal' | 'deadstock';

export default function DashboardScreen({ user, business, mode, onLogout, onBackToModeSelect }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [products, setProducts] = useState<Product[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);
  const [financials, setFinancials] = useState<any>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertCategory, setAlertCategory] = useState<AlertCategory>('all');

  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<'single' | 'csv' | 'file'>('single');
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [saleProduct, setSaleProduct] = useState<Product | null>(null);
  const [saleForm, setSaleForm] = useState({ qty: '', price: '' });
  const [reorderProduct, setReorderProduct] = useState<Product | null>(null);
  const [reorderForm, setReorderForm] = useState({ qty: '', expiryDate: '' });
  const [productForm, setProductForm] = useState({
    name: '', barcode: '', category: '', quantity: '', costPrice: '',
    sellingPrice: '', unit: 'unit', reorderPoint: '', expiryDate: ''
  });
  const [bulkText, setBulkText] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshInterval = useRef<ReturnType<typeof setInterval>>();
  const [confirmRemove, setConfirmRemove] = useState<{ product: Product; alert?: Alert } | null>(null);
  const [discountDialog, setDiscountDialog] = useState<{ product: Product; alert?: Alert; percent: string } | null>(null);
  const [removeProductDialog, setRemoveProductDialog] = useState<{ product: Product; mode: 'all' | 'partial'; qty: string } | null>(null);

  const refresh = useCallback(() => {
    const p = Inv.get(business.id);
    setProducts(p);
    setAlerts(AlertSvc.generate(p, mode));
    setSuggestions(AlertSvc.suggestions(p, mode));
    setActionLogs(ActionHistory.get(business.id));
    setFinancials(Analytics.financials(business.id));
  }, [business.id, mode]);

  useEffect(() => {
    refresh();
    refreshInterval.current = setInterval(refresh, 5000);
    return () => { if (refreshInterval.current) clearInterval(refreshInterval.current); };
  }, [refresh]);

  const prevAlertKeysRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);
  useEffect(() => {
    const currentKeys = new Set(alerts.map(a => `${a.type}|${a.productId}|${a.batchId || ''}`));
    if (!isFirstLoadRef.current) {
      let hasNew = false;
      currentKeys.forEach(k => { if (!prevAlertKeysRef.current.has(k)) hasNew = true; });
      if (hasNew && alerts.some(a => a.severity === 'danger' || a.severity === 'warning')) {
        playAlertSound();
      }
    }
    prevAlertKeysRef.current = currentKeys;
    isFirstLoadRef.current = false;
  }, [alerts]);

  const cur = business.currency;
  const fmt = (n: number) => formatCurrency(n, cur);

  const filtered = useMemo(() => {
    let p = products;
    if (search) p = p.filter(x => x.name.toLowerCase().includes(search.toLowerCase()) || x.barcode?.includes(search));
    if (filterCat) p = p.filter(x => x.category === filterCat);
    return [...p].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'qty') return a.quantity - b.quantity;
      if (sortBy === 'expiry') return compareExpiryDates(a.expiryDate, b.expiryDate);
      return (b.costPrice * b.quantity) - (a.costPrice * a.quantity);
    });
  }, [products, search, filterCat, sortBy]);

  const dangerCount = alerts.filter(a => a.severity === 'danger').length;
  const warnCount = alerts.filter(a => a.severity === 'warning').length;
  const alertCounts = useMemo(() => ({
    expired: alerts.filter(a => a.category === 'expired').length,
    expiring: alerts.filter(a => a.category === 'expiring').length,
    lowstock: alerts.filter(a => a.category === 'lowstock').length,
    outofstock: alerts.filter(a => a.category === 'outofstock').length,
    overstock: alerts.filter(a => a.category === 'overstock').length,
    salesspeed: alerts.filter(a => a.category === 'salesspeed').length,
    seasonal: alerts.filter(a => a.category === 'seasonal').length,
    deadstock: alerts.filter(a => a.category === 'deadstock').length,
  }), [alerts]);
  const filteredAlerts = useMemo(() => alertCategory === 'all' ? alerts : alerts.filter(a => a.category === alertCategory), [alerts, alertCategory]);

  const addProduct = (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setOk('');
    const f = productForm;
    if (!f.name || !f.barcode || !f.category || !f.quantity || !f.costPrice || !f.sellingPrice) { setErr('All required fields must be filled.'); return; }
    const r = Inv.add(business.id, { name: f.name, barcode: f.barcode, category: f.category, quantity: parseInt(f.quantity), costPrice: parseFloat(f.costPrice), sellingPrice: parseFloat(f.sellingPrice), unit: f.unit, reorderPoint: parseInt(f.reorderPoint) || 10, expiryDate: f.expiryDate } as Partial<Product>);
    if (r.error) { setErr(r.error); return; }
    ActionHistory.log(business.id, (r as any).product?.id || '', f.name, 'add', `Added "${f.name}" with ${f.quantity} units`);
    setOk('Product added!');
    setProductForm({ name: '', barcode: '', category: '', quantity: '', costPrice: '', sellingPrice: '', unit: 'unit', reorderPoint: '', expiryDate: '' });
    refresh();
  };

  const doSale = () => {
    setErr(''); setOk('');
    if (!saleForm.qty || !saleForm.price || !saleProduct) { setErr('Quantity and price required.'); return; }
    const r = Inv.recordSale(business.id, saleProduct.id, parseInt(saleForm.qty), parseFloat(saleForm.price));
    if (r.error) { setErr(r.error); return; }
    ActionHistory.log(business.id, saleProduct.id, saleProduct.name, 'sale', `Sold ${saleForm.qty} units of "${saleProduct.name}"`);
    setOk('Sale recorded!'); setSaleProduct(null); setSaleForm({ qty: '', price: '' }); refresh();
  };

  const handleBulk = () => {
    setErr(''); setOk('');
    try {
      const items = parseInventoryCsvText(bulkText);
      if (!items.length) { setErr('No valid rows found. Keep expiryDate as the last CSV column.'); return; }
      const r = Inv.bulk(business.id, items as unknown as Partial<Product>[]); setOk(`Added ${r.added} products.`); setBulkText(''); refresh();
    } catch { setErr('Invalid CSV format.'); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        const items = parseInventoryCsvText(text);
        if (!items.length) { setErr('No valid rows found. Keep expiryDate as the last CSV column.'); return; }
        const r = Inv.bulk(business.id, items as unknown as Partial<Product>[]); setOk(`Imported ${r.added} products.`); refresh();
      } catch { setErr('Could not parse file.'); }
    };
    reader.readAsText(file);
  };

  const handleRemoveExpired = (product: Product, alert?: Alert) => {
    if (alert?.batchId && alert.batchId !== 'legacy') {
      Inv.removeBatch(product.id, alert.batchId);
      const removedQty = alert.batchQty || 0;
      ActionHistory.log(business.id, product.id, product.name, 'remove',
        `Removed expired batch of "${product.name}" (${removedQty} units). Other batches kept.`);
      setOk(`✅ Expired batch of "${product.name}" removed (${removedQty} units).`);
    } else {
      Inv.removeExpired(business.id, product.id);
      ActionHistory.log(business.id, product.id, product.name, 'remove',
        `Removed expired item "${product.name}" (${product.quantity} units). Now safe from contamination.`);
      setOk(`✅ "${product.name}" removed successfully!`);
    }
    setConfirmRemove(null); refresh();
  };

  const handleRemoveProduct = () => {
    if (!removeProductDialog) return;
    const { product, mode: removeMode, qty } = removeProductDialog;
    if (removeMode === 'all') {
      Inv.deleteProduct(product.id);
      ActionHistory.log(business.id, product.id, product.name, 'remove', `Completely removed "${product.name}" (${product.quantity} units) from inventory.`);
      setOk(`✅ "${product.name}" removed completely from inventory.`);
    } else {
      const removeQty = parseInt(qty);
      if (isNaN(removeQty) || removeQty <= 0) { setErr('Enter valid quantity.'); return; }
      if (removeQty >= product.quantity) {
        Inv.deleteProduct(product.id);
        ActionHistory.log(business.id, product.id, product.name, 'remove', `Removed all ${product.quantity} units of "${product.name}".`);
        setOk(`✅ "${product.name}" removed completely.`);
      } else {
        Inv.updateProduct(product.id, { quantity: product.quantity - removeQty } as Partial<Product>);
        ActionHistory.log(business.id, product.id, product.name, 'remove', `Removed ${removeQty} units of "${product.name}". Remaining: ${product.quantity - removeQty}`);
        setOk(`✅ Removed ${removeQty} units of "${product.name}".`);
      }
    }
    setRemoveProductDialog(null); refresh();
  };

  const handleApplyDiscount = () => {
    if (!discountDialog) return;
    const pct = parseFloat(discountDialog.percent);
    if (isNaN(pct) || pct <= 0 || pct > 100) { setErr('Enter valid discount % (1-100).'); return; }
    const p = discountDialog.product;
    const newPrice = Math.round(p.sellingPrice * (1 - pct / 100) * 100) / 100;
    Inv.updateProduct(p.id, { sellingPrice: newPrice } as Partial<Product>);
    ActionHistory.log(business.id, p.id, p.name, 'discount', `Applied ${pct}% discount on "${p.name}". Price: ${fmt(p.sellingPrice)} → ${fmt(newPrice)}`);
    setDiscountDialog(null); setOk(`✅ ${pct}% discount applied! "${p.name}": ${fmt(p.sellingPrice)} → ${fmt(newPrice)}`); refresh();
  };

  const handleReorder = () => {
    if (!reorderProduct || !reorderForm.qty) return;
    const qty = parseInt(reorderForm.qty);
    if (isNaN(qty) || qty <= 0) { setErr('Enter valid quantity.'); return; }
    Inv.addBatch(reorderProduct.id, qty, reorderForm.expiryDate);
    const expNote = reorderForm.expiryDate ? ` (batch expires ${formatDisplayDate(reorderForm.expiryDate)})` : '';
    ActionHistory.log(business.id, reorderProduct.id, reorderProduct.name, 'reorder',
      `Reordered ${qty} units of "${reorderProduct.name}"${expNote}. New stock: ${reorderProduct.quantity + qty}`);
    setOk(`✅ Reordered ${qty} units of "${reorderProduct.name}".`);
    setReorderProduct(null); setReorderForm({ qty: '', expiryDate: '' }); refresh();
  };

  const modeLabel = mode === 'small' ? '🏪 Small Business' : mode === 'medium' ? '🏢 Medium Business' : '🏭 Enterprise';
  const isSmall = mode === 'small';
  const showAnalytics = mode === 'medium' || mode === 'large';
  const showFinancials = mode === 'large';

  const tabsList: { id: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={18} />, show: true },
    { id: 'inventory', label: `Inventory (${products.length})`, icon: <Package size={18} />, show: true },
    { id: 'alerts', label: `Alerts${alerts.length ? ` (${alerts.length})` : ''}`, icon: <Bell size={18} />, show: true },
    { id: 'suggestions', label: 'Suggestions', icon: <Lightbulb size={18} />, show: true },
    { id: 'history', label: 'Action History', icon: <History size={18} />, show: true },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={18} />, show: showAnalytics },
    { id: 'financials', label: 'Financials', icon: <DollarSign size={18} />, show: showFinancials },
  ];

  const inputCls = "w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-foreground text-sm outline-none focus:border-primary/50 transition-all";
  const sevColors: Record<string, string> = { danger: 'text-destructive bg-destructive/10 border-destructive/30', warning: 'text-warning bg-warning/10 border-warning/30', info: 'text-info bg-info/10 border-info/30' };

  const alertCatBtns: { id: AlertCategory; label: string; icon: React.ReactNode; count: number; color: string }[] = [
    { id: 'all', label: 'All', icon: <Bell size={14} />, count: alerts.length, color: 'text-primary' },
    { id: 'expired', label: 'Expired', icon: <Skull size={14} />, count: alertCounts.expired, color: 'text-destructive' },
    { id: 'expiring', label: 'Expiring', icon: <Timer size={14} />, count: alertCounts.expiring, color: 'text-warning' },
    { id: 'outofstock', label: 'Out of Stock', icon: <PackageOpen size={14} />, count: alertCounts.outofstock, color: 'text-destructive' },
    { id: 'overstock', label: 'Overstock', icon: <PackageOpen size={14} />, count: alertCounts.overstock, color: 'text-info' },
    { id: 'lowstock', label: 'Low Stock', icon: <Truck size={14} />, count: alertCounts.lowstock, color: 'text-warning' },
    { id: 'deadstock', label: 'Dead Stock', icon: <Skull size={14} />, count: alertCounts.deadstock, color: 'text-destructive' },
    { id: 'salesspeed', label: 'Sales Speed', icon: <Gauge size={14} />, count: alertCounts.salesspeed, color: 'text-accent' },
    { id: 'seasonal', label: 'Seasonal', icon: <Sun size={14} />, count: alertCounts.seasonal, color: 'text-secondary' },
  ];

  // Computed stats for overview
  const totalItems = products.length;
  const inStock = products.filter(p => p.quantity > 0).length;
  const outOfStockCount = products.filter(p => p.quantity === 0).length;
  const lowStockCount = products.filter(p => p.quantity > 0 && p.quantity <= p.reorderPoint).length;
  const totalStockValue = products.reduce((s, p) => s + p.costPrice * p.quantity, 0);
  const totalRetailValue = products.reduce((s, p) => s + p.sellingPrice * p.quantity, 0);
  const totalSalesCount = financials.salesCount || 0;
  const totalRevenue = financials.totalRevenue || 0;
  const totalProfit = financials.totalProfit || 0;
  const totalCost = financials.totalCost || 0;
  const profitMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0';
  const potentialLoss = financials.potentialLoss || 0;
  const avgOrderValue = financials.avgOrderValue || 0;

  return (
    <div className="min-h-screen bg-background flex">
      {/* CONFIRM REMOVE DIALOG (expired) */}
      <AnimatePresence>
        {confirmRemove && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-background/70 backdrop-blur-sm z-[60]" onClick={() => setConfirmRemove(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] glass p-6 max-w-sm w-[90%]">
              <h3 className="text-lg font-bold text-destructive mb-2 flex items-center gap-2"><Trash2 size={18} /> Remove Expired Item?</h3>
              <p className="text-sm text-foreground/80 mb-1">Remove <strong>{confirmRemove.product.name}</strong>?</p>
              <p className="text-xs text-muted-foreground mb-4">{confirmRemove.product.quantity} units will be removed. This protects other items from contamination.</p>
              <div className="flex gap-2">
                <button onClick={() => handleRemoveExpired(confirmRemove.product, confirmRemove.alert)} className="flex-1 bg-destructive/20 border border-destructive/40 text-destructive font-bold py-2 rounded-xl text-sm hover:bg-destructive/30">✅ Yes, Remove</button>
                <button onClick={() => setConfirmRemove(null)} className="flex-1 bg-muted/30 border border-border text-muted-foreground font-bold py-2 rounded-xl text-sm hover:bg-muted/50">Cancel</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* REMOVE PRODUCT DIALOG (inventory) */}
      <AnimatePresence>
        {removeProductDialog && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-background/70 backdrop-blur-sm z-[60]" onClick={() => setRemoveProductDialog(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] glass p-6 max-w-sm w-[90%]">
              <h3 className="text-lg font-bold text-destructive mb-2 flex items-center gap-2"><Trash2 size={18} /> Remove Product</h3>
              <p className="text-sm text-foreground/80 mb-1"><strong>{removeProductDialog.product.name}</strong></p>
              <p className="text-xs text-muted-foreground mb-3">Current stock: {removeProductDialog.product.quantity} {removeProductDialog.product.unit}</p>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setRemoveProductDialog(d => d ? { ...d, mode: 'all' } : null)} className={`flex-1 text-xs font-bold py-2 rounded-xl border transition-all ${removeProductDialog.mode === 'all' ? 'bg-destructive/20 border-destructive/40 text-destructive' : 'bg-muted/20 border-border text-muted-foreground'}`}>Remove All</button>
                <button onClick={() => setRemoveProductDialog(d => d ? { ...d, mode: 'partial' } : null)} className={`flex-1 text-xs font-bold py-2 rounded-xl border transition-all ${removeProductDialog.mode === 'partial' ? 'bg-warning/20 border-warning/40 text-warning' : 'bg-muted/20 border-border text-muted-foreground'}`}>Remove Some</button>
              </div>
              {removeProductDialog.mode === 'partial' && (
                <div className="mb-3">
                  <label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">How many to remove?</label>
                  <input type="number" value={removeProductDialog.qty} onChange={e => setRemoveProductDialog(d => d ? { ...d, qty: e.target.value } : null)} placeholder="0" className={inputCls} autoFocus />
                </div>
              )}
              {err && <p className="text-xs text-destructive mb-2">⚠ {err}</p>}
              <div className="flex gap-2">
                <button onClick={handleRemoveProduct} className="flex-1 bg-destructive/20 border border-destructive/40 text-destructive font-bold py-2 rounded-xl text-sm hover:bg-destructive/30">✅ Confirm Remove</button>
                <button onClick={() => { setRemoveProductDialog(null); setErr(''); }} className="flex-1 bg-muted/30 border border-border text-muted-foreground font-bold py-2 rounded-xl text-sm hover:bg-muted/50">Cancel</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* DISCOUNT DIALOG */}
      <AnimatePresence>
        {discountDialog && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-background/70 backdrop-blur-sm z-[60]" onClick={() => setDiscountDialog(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] glass p-6 max-w-sm w-[90%]">
              <h3 className="text-lg font-bold text-primary mb-2 flex items-center gap-2"><Tag size={18} /> Apply Discount</h3>
              <p className="text-sm text-foreground/80 mb-1"><strong>{discountDialog.product.name}</strong></p>
              <p className="text-xs text-muted-foreground mb-3">Current price: {fmt(discountDialog.product.sellingPrice)}</p>
              <div className="mb-3">
                <label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Discount %</label>
                <input type="number" value={discountDialog.percent} onChange={e => setDiscountDialog(d => d ? { ...d, percent: e.target.value } : null)} placeholder="15" className={inputCls} autoFocus />
              </div>
              {discountDialog.percent && parseFloat(discountDialog.percent) > 0 && (
                <p className="text-xs text-accent mb-3">New price: {fmt(Math.round(discountDialog.product.sellingPrice * (1 - parseFloat(discountDialog.percent) / 100) * 100) / 100)}</p>
              )}
              {err && <p className="text-xs text-destructive mb-2">⚠ {err}</p>}
              <div className="flex gap-2">
                <button onClick={handleApplyDiscount} className="flex-1 bg-primary/20 border border-primary/40 text-primary font-bold py-2 rounded-xl text-sm hover:bg-primary/30">✅ Apply</button>
                <button onClick={() => { setDiscountDialog(null); setErr(''); }} className="flex-1 bg-muted/30 border border-border text-muted-foreground font-bold py-2 rounded-xl text-sm hover:bg-muted/50">Cancel</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* REORDER DIALOG */}
      <AnimatePresence>
        {reorderProduct && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-background/70 backdrop-blur-sm z-[60]" onClick={() => setReorderProduct(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] glass p-6 max-w-sm w-[90%]">
              <h3 className="text-lg font-bold text-warning mb-2 flex items-center gap-2"><RefreshCw size={18} /> Reorder Stock</h3>
              <p className="text-sm text-foreground/80 mb-1"><strong>{reorderProduct.name}</strong></p>
              <p className="text-xs text-muted-foreground mb-3">Current: {reorderProduct.quantity} units</p>
              <div className="mb-3">
                <label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Quantity to Order</label>
                <input type="number" value={reorderForm.qty} onChange={e => setReorderForm(f => ({ ...f, qty: e.target.value }))} placeholder="50" className={inputCls} autoFocus />
              </div>
                <div className="mb-3">
                  <label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Expiry Date (this batch)</label>
                  <input type="text" inputMode="numeric" value={reorderForm.expiryDate} onChange={e => setReorderForm(f => ({ ...f, expiryDate: e.target.value }))} placeholder="DD/MM/YYYY" className={inputCls + ' font-mono'} />
                  <p className="text-[10px] text-muted-foreground/70 mt-1">Use DD/MM/YYYY. Leave blank if not perishable.</p>
                </div>
              <div className="flex gap-2">
                <button onClick={handleReorder} className="flex-1 bg-warning/20 border border-warning/40 text-warning font-bold py-2 rounded-xl text-sm hover:bg-warning/30">✅ Reorder</button>
                <button onClick={() => setReorderProduct(null)} className="flex-1 bg-muted/30 border border-border text-muted-foreground font-bold py-2 rounded-xl text-sm hover:bg-muted/50">Cancel</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* SALE DIALOG */}
      <AnimatePresence>
        {saleProduct && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-background/70 backdrop-blur-sm z-[60]" onClick={() => setSaleProduct(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] glass p-6 max-w-sm w-[90%]">
              <h3 className="text-lg font-bold text-accent mb-2 flex items-center gap-2"><ShoppingCart size={18} /> Record Sale</h3>
              <p className="text-sm text-foreground/80 mb-1"><strong>{saleProduct.name}</strong></p>
              <p className="text-xs text-muted-foreground mb-3">Available: {saleProduct.quantity} | Price: {fmt(saleProduct.sellingPrice)}</p>
              {err && <p className="text-xs text-destructive mb-2">⚠ {err}</p>}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Qty</label><input type="number" value={saleForm.qty} onChange={e => setSaleForm(f => ({ ...f, qty: e.target.value }))} placeholder="1" className={inputCls} /></div>
                <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Sale Price</label><input type="number" step="0.01" value={saleForm.price} onChange={e => setSaleForm(f => ({ ...f, price: e.target.value }))} placeholder={String(saleProduct.sellingPrice)} className={inputCls} /></div>
              </div>
              <div className="flex gap-2">
                <button onClick={doSale} className="flex-1 bg-accent/20 border border-accent/40 text-accent font-bold py-2 rounded-xl text-sm hover:bg-accent/30">✅ Record Sale</button>
                <button onClick={() => { setSaleProduct(null); setErr(''); }} className="flex-1 bg-muted/30 border border-border text-muted-foreground font-bold py-2 rounded-xl text-sm hover:bg-muted/50">Cancel</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* SIDEBAR */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40" onClick={() => setSidebarOpen(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="w-72 bg-card/95 border-r border-border backdrop-blur-xl flex flex-col fixed h-full z-50">
              <div className="p-4 border-b border-border flex justify-between items-start">
                <div>
                  <h1 className="text-lg font-black font-display glow-text">Smart Inventory</h1>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{business.name}</p>
                  <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full mt-1 inline-block">{modeLabel}</span>
                </div>
                <button onClick={() => setSidebarOpen(false)} className="text-muted-foreground hover:text-foreground mt-1"><X size={18} /></button>
              </div>
              <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
                {tabsList.filter(t => t.show).map(t => (
                  <button key={t.id} onClick={() => { setTab(t.id); setSidebarOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${tab === t.id ? 'bg-primary/10 text-primary border border-primary/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'}`}>
                    {t.icon}<span>{t.label}</span>
                    {t.id === 'alerts' && dangerCount > 0 && <span className="ml-auto bg-destructive text-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center animate-pulse-glow">{dangerCount}</span>}
                  </button>
                ))}
              </nav>
              <div className="p-3 border-t border-border space-y-1">
                <p className="text-xs text-muted-foreground truncate mb-2">{user.fullName || user.username}</p>
                <button onClick={() => { setSidebarOpen(false); onBackToModeSelect(); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-primary hover:bg-primary/10 transition-all"><ArrowLeft size={14} /> Change Mode</button>
                <button onClick={onLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-destructive hover:bg-destructive/10 transition-all"><LogOut size={14} /> Sign Out</button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-h-screen w-full">
        <header className="bg-card/50 border-b border-border backdrop-blur-xl px-4 py-2.5 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="text-muted-foreground hover:text-foreground"><Menu size={20} /></button>
            <span className="text-sm font-bold text-foreground">{tabsList.find(t => t.id === tab)?.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-1 mr-2">
              {tabsList.filter(t => t.show).map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${tab === t.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'}`}>
                  {t.id === 'alerts' && dangerCount > 0 ? `⚠ ${t.label}` : t.label}
                </button>
              ))}
            </div>
            <button onClick={() => refresh()} className="text-muted-foreground hover:text-primary transition-colors"><RefreshCw size={16} /></button>
            <button onClick={() => { setTab('alerts'); if (alerts.length > 0) playAlertSound(); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${dangerCount > 0 ? 'bg-destructive/10 border-destructive/30 text-destructive animate-pulse-glow' : warnCount > 0 ? 'bg-warning/10 border-warning/30 text-warning' : 'bg-muted/30 border-border text-muted-foreground'}`}>
              <Bell size={14} />{alerts.length > 0 && <span>{alerts.length}</span>}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            {ok && <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-accent/10 border border-accent/30 rounded-xl p-3 text-accent text-sm mb-4 flex items-center gap-2"><Check size={16} /> {ok}<button onClick={() => setOk('')} className="ml-auto text-accent/60 hover:text-accent"><X size={14} /></button></motion.div>}

            {/* ============ OVERVIEW ============ */}
            {tab === 'overview' && (
              <div className="space-y-4">
                {/* Purpose banner */}
                <div className="glass p-3 border border-primary/20">
                  <p className="text-xs text-muted-foreground">📊 <strong className="text-foreground">Overview</strong> — Quick snapshot of your entire inventory health, stock status, and recent activity at a glance.</p>
                </div>

                {/* Key metrics */}
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                  {[
                    { label: '📦 Total Products', value: totalItems, sub: `${inStock} in stock`, color: 'text-primary' },
                    { label: '✅ In Stock', value: inStock, sub: totalItems > 0 ? `${((inStock/totalItems)*100).toFixed(0)}% available` : '—', color: 'text-accent' },
                    { label: '❌ Out of Stock', value: outOfStockCount, sub: outOfStockCount > 0 ? 'Needs reorder!' : 'All good', color: 'text-destructive' },
                    { label: '⚠️ Low Stock', value: lowStockCount, sub: lowStockCount > 0 ? 'Running low' : 'Healthy', color: 'text-warning' },
                  ].map((s, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="glass p-3 text-center perspective-card">
                      <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                      <p className={`text-2xl font-black font-display ${s.color}`}>{s.value}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
                    </motion.div>
                  ))}
                </div>

                {/* Financial snapshot */}
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                  <div className="glass p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">💰 Stock Value (Cost)</p>
                    <p className="text-lg font-black font-display text-primary">{fmt(totalStockValue)}</p>
                    <p className="text-[10px] text-muted-foreground">What you paid for inventory</p>
                  </div>
                  <div className="glass p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">🏷️ Retail Value</p>
                    <p className="text-lg font-black font-display text-accent">{fmt(totalRetailValue)}</p>
                    <p className="text-[10px] text-muted-foreground">What you can earn if sold</p>
                  </div>
                  <div className="glass p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">💵 Total Revenue</p>
                    <p className="text-lg font-black font-display text-accent">{fmt(totalRevenue)}</p>
                    <p className="text-[10px] text-muted-foreground">{totalSalesCount} sale(s) made</p>
                  </div>
                </div>

                {/* Alerts summary */}
                {alerts.length > 0 && (
                  <div className="glass p-4">
                    <h3 className="text-sm font-bold text-destructive mb-3 flex items-center gap-2"><AlertTriangle size={14} /> ⚠️ Needs Attention ({alerts.length})</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {alertCatBtns.filter(c => c.id !== 'all' && c.count > 0).map(c => (
                        <button key={c.id} onClick={() => { setTab('alerts'); setAlertCategory(c.id); playAlertSound(); }} className="rounded-xl p-3 border border-border/50 bg-muted/10 hover:bg-muted/20 transition-all text-left">
                          <div className="flex items-center gap-2 mb-1"><span className={c.color}>{c.icon}</span><span className={`text-[10px] font-bold uppercase ${c.color}`}>{c.label}</span></div>
                          <p className={`text-2xl font-black font-display ${c.color}`}>{c.count}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {alerts.length === 0 && (
                  <div className="glass p-6 text-center border border-accent/20">
                    <p className="text-accent text-lg font-bold">✅ Everything looks great!</p>
                    <p className="text-xs text-muted-foreground mt-1">No alerts — your inventory is in good shape.</p>
                  </div>
                )}

                {/* Recent actions */}
                {actionLogs.length > 0 && (
                  <div className="glass p-4">
                    <h3 className="text-sm font-bold text-primary mb-3 flex items-center gap-2"><History size={14} /> Recent Actions</h3>
                    {actionLogs.slice(0, 5).map((log, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs border-b border-border/30 pb-2 mb-2">
                          <span>{log.actionType === 'remove' ? '🗑️' : log.actionType === 'discount' ? '🏷️' : log.actionType === 'reorder' ? '📦' : log.actionType === 'sale' ? '💵' : '➕'}</span>
                          <div><p className="text-foreground/80">{log.description}</p><p className="text-muted-foreground/60 text-[10px]">{formatDisplayDate(log.createdAt, true)}</p></div>
                        </div>
                    ))}
                    {actionLogs.length > 5 && <button onClick={() => setTab('history')} className="text-xs text-primary font-bold hover:underline">View all →</button>}
                  </div>
                )}
                {actionLogs.length === 0 && (
                  <div className="glass p-4 text-center border border-muted">
                    <p className="text-muted-foreground text-sm">📋 No actions yet — start selling, reordering, or managing inventory to see activity here.</p>
                  </div>
                )}
              </div>
            )}

            {/* ============ INVENTORY ============ */}
            {tab === 'inventory' && (
              <div className="space-y-4">
                <div className="flex gap-2 flex-wrap items-center">
                  <div className="relative flex-1 min-w-[160px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="w-full bg-muted/30 border border-border rounded-xl pl-8 pr-3 py-2 text-sm text-foreground outline-none focus:border-primary/50" />
                  </div>
                  <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm text-foreground outline-none"><option value="">All</option>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm text-foreground outline-none"><option value="name">Name</option><option value="qty">Qty</option><option value="expiry">Expiry</option><option value="value">Value</option></select>
                  <button onClick={() => setAdding(!adding)} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold border transition-all ${adding ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'bg-primary/10 border-primary/30 text-primary'}`}>{adding ? <><X size={14} /> Close</> : <><Plus size={14} /> Add</>}</button>
                </div>

                <AnimatePresence>
                  {adding && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="glass p-4">
                        {/* No barcode tab */}
                        <div className="flex gap-1 mb-4 flex-wrap">
                          {([['single', '➕ Single'], ['csv', '📋 CSV'], ['file', '📁 File']] as const).map(([id, label]) => (
                            <button key={id} onClick={() => { setAddMode(id as any); setErr(''); setOk(''); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${addMode === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
                          ))}
                        </div>
                        {err && <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-2 text-destructive text-xs mb-3">⚠ {err}</div>}

                        {addMode === 'single' && (
                          <form onSubmit={addProduct} className="space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Name *</label><input value={productForm.name} onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))} required className={inputCls} /></div>
                              <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Barcode *</label><input value={productForm.barcode} onChange={e => setProductForm(f => ({ ...f, barcode: e.target.value }))} required className={inputCls + ' font-mono tabular-nums'} /></div>
                              <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Category *</label><select value={productForm.category} onChange={e => setProductForm(f => ({ ...f, category: e.target.value }))} required className={inputCls}><option value="">Select…</option>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                              <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Quantity *</label><input type="number" value={productForm.quantity} onChange={e => setProductForm(f => ({ ...f, quantity: e.target.value }))} required className={inputCls} /></div>
                              <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Cost Price *</label><input type="number" step="0.01" value={productForm.costPrice} onChange={e => setProductForm(f => ({ ...f, costPrice: e.target.value }))} required className={inputCls} /></div>
                              <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Selling Price *</label><input type="number" step="0.01" value={productForm.sellingPrice} onChange={e => setProductForm(f => ({ ...f, sellingPrice: e.target.value }))} required className={inputCls} /></div>
                              <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Unit</label><select value={productForm.unit} onChange={e => setProductForm(f => ({ ...f, unit: e.target.value }))} className={inputCls}>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                              <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Min. Threshold</label><input type="number" value={productForm.reorderPoint} onChange={e => setProductForm(f => ({ ...f, reorderPoint: e.target.value }))} placeholder="10" className={inputCls} /></div>
                              <div><label className="block text-[10px] text-muted-foreground font-bold uppercase mb-1">Expiry Date</label><input type="text" inputMode="numeric" value={productForm.expiryDate} onChange={e => setProductForm(f => ({ ...f, expiryDate: e.target.value }))} placeholder="DD/MM/YYYY" className={inputCls + ' font-mono'} /></div>
                            </div>
                            <button type="submit" className="bg-primary/10 border border-primary/30 text-primary font-bold py-2 px-6 rounded-xl text-sm hover:bg-primary/20 flex items-center gap-2"><Plus size={14} /> Add Product</button>
                          </form>
                        )}
                        {addMode === 'csv' && (<div><p className="text-xs text-muted-foreground mb-2">Paste CSV: name,barcode,category,quantity,costPrice,sellingPrice,unit,reorderPoint,expiryDate</p><textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={6} className={inputCls + " font-mono text-xs"} /><button onClick={handleBulk} className="mt-2 bg-primary/10 border border-primary/30 text-primary font-bold py-2 px-6 rounded-xl text-sm">Import</button></div>)}
                        {addMode === 'file' && (<div className="text-center py-6"><Upload size={36} className="text-primary mx-auto mb-3 opacity-60" /><input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" /><button onClick={() => fileRef.current?.click()} className="bg-primary/10 border border-primary/30 text-primary font-bold py-2 px-6 rounded-xl text-sm">Choose File</button></div>)}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Inventory table with cost price + selling price columns + remove button */}
                <div className="glass overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30"><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2.5">Product</th>
                        <th className="px-3 py-2.5">Category</th>
                        <th className="px-3 py-2.5">Qty</th>
                        <th className="px-3 py-2.5">Cost Price</th>
                        <th className="px-3 py-2.5">Selling Price</th>
                        <th className="px-3 py-2.5">Expiry</th>
                        <th className="px-3 py-2.5">Actions</th>
                      </tr></thead>
                      <tbody>
                        {filtered.map(p => {
                          const isLow = p.quantity > 0 && p.quantity <= p.reorderPoint;
                          const isOut = p.quantity === 0;
                            const isExpired = p.expiryDate ? (getDaysUntilExpiry(p.expiryDate) ?? 1) <= 0 : false;
                          return (
                            <tr key={p.id} className={`border-b border-border/30 hover:bg-muted/10 ${isExpired ? 'bg-destructive/5' : isOut ? 'bg-destructive/5' : ''}`}>
                              <td className="px-3 py-2.5"><p className="font-medium text-foreground">{p.name}</p><p className="text-[10px] text-muted-foreground font-mono tabular-nums inline-block min-w-[12ch]">{p.barcode}</p></td>
                              <td className="px-3 py-2.5 text-muted-foreground text-xs">{p.category}</td>
                              <td className="px-3 py-2.5"><span className={`font-bold ${isOut ? 'text-destructive' : isLow ? 'text-warning' : 'text-accent'}`}>{p.quantity}</span> <span className="text-[10px] text-muted-foreground">{p.unit}</span></td>
                              <td className="px-3 py-2.5 text-muted-foreground">{fmt(p.costPrice)}</td>
                              <td className="px-3 py-2.5 text-foreground font-medium">{fmt(p.sellingPrice)}</td>
                              <td className="px-3 py-2.5">{p.expiryDate ? <span className={`text-xs ${isExpired ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>{isExpired ? `❌ Expired • ${formatDisplayDate(p.expiryDate)}` : formatDisplayDate(p.expiryDate)}</span> : <span className="text-muted-foreground/40 text-xs">—</span>}</td>
                              <td className="px-3 py-2.5"><div className="flex gap-1">
                                <button onClick={() => { setSaleProduct(p); setSaleForm({ qty: '', price: String(p.sellingPrice) }); setErr(''); }} className="text-accent hover:bg-accent/10 p-1 rounded-lg" title="Sell"><ShoppingCart size={14} /></button>
                                <button onClick={() => { setReorderProduct(p); setReorderForm({ qty: String(Math.min(p.reorderPoint ? p.reorderPoint * 3 : 50, 200)), expiryDate: '' }); }} className="text-warning hover:bg-warning/10 p-1 rounded-lg" title="Reorder"><RefreshCw size={14} /></button>
                                <button onClick={() => setRemoveProductDialog({ product: p, mode: 'all', qty: '' })} className="text-destructive hover:bg-destructive/10 p-1 rounded-lg" title="Remove"><Trash2 size={14} /></button>
                              </div></td>
                            </tr>
                          );
                        })}
                        {filtered.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No products</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ============ ALERTS ============ */}
            {tab === 'alerts' && (
              <div className="space-y-4">
                <div className="glass p-3 border border-warning/20"><p className="text-xs text-warning flex items-center gap-2"><Volume2 size={14} /> 🔔 Sorted by priority — most urgent first. Take action to protect your business.</p></div>
                <div className="flex gap-2 flex-wrap">
                  {alertCatBtns.filter(c => c.id === 'all' || c.count > 0).map(c => (
                    <button key={c.id} onClick={() => { setAlertCategory(c.id); if (c.count > 0) playAlertSound(); }} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${alertCategory === c.id ? `${c.color} bg-muted/30 border-current` : 'text-muted-foreground border-border hover:bg-muted/10'}`}>{c.icon}<span>{c.label}</span>{c.count > 0 && <span className="bg-muted/30 px-1.5 py-0.5 rounded-full text-[10px]">{c.count}</span>}</button>
                  ))}
                </div>
                {filteredAlerts.length === 0 ? (
                  <div className="glass p-12 text-center"><p className="text-accent text-lg font-bold">✅ No alerts</p><p className="text-xs text-muted-foreground mt-1">Your inventory is safe and healthy.</p></div>
                ) : (
                  <div className="space-y-3">
                    {filteredAlerts.map((a, i) => {
                      const pb = a.priorityColor === 'red' ? 'border-l-4 border-l-destructive' : a.priorityColor === 'orange' ? 'border-l-4 border-l-warning' : a.priorityColor === 'yellow' ? 'border-l-4 border-l-yellow-400' : '';
                      return (
                        <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className={`glass p-4 border ${sevColors[a.severity]} ${pb}`}>
                          <div className="flex justify-between items-start flex-wrap gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.severity === 'danger' ? 'bg-destructive/20 text-destructive' : a.severity === 'warning' ? 'bg-warning/20 text-warning' : 'bg-info/20 text-info'}`}>{a.severity === 'danger' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵'} {a.type.replace(/_/g, ' ')}</span>
                                {a.daysLeft !== undefined && a.daysLeft > 0 && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.daysLeft <= 3 ? 'bg-destructive/20 text-destructive' : 'bg-warning/20 text-warning'}`}>⏰ {a.daysLeft}d</span>}
                              </div>
                              <p className="text-foreground/80 text-sm font-medium">{a.message}</p>
                              {a.reason && <p className="text-foreground/60 text-xs mt-1.5 border-l-2 border-muted-foreground/20 pl-2 whitespace-pre-line">{a.reason}</p>}
                              <p className="mt-2 font-bold text-sm whitespace-pre-line">{a.action}</p>
                              {a.category !== 'expired' && a.category !== 'expiring' && a.category !== 'outofstock' && a.potentialLoss !== undefined && a.potentialLoss > 0 && <p className="text-xs text-destructive/80 mt-1">💸 At risk: {fmt(a.potentialLoss)}</p>}
                            </div>
                            <div className="flex gap-2">
                              {a.actionType === 'reorder' && <button onClick={() => { const p = products.find(x => x.id === a.productId); if (p) { setReorderProduct(p); setReorderForm({ qty: String(Math.min(p.reorderPoint ? p.reorderPoint * 3 : 50, 200)), expiryDate: '' }); } }} className="bg-warning/10 border border-warning/30 text-warning px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-warning/20 flex items-center gap-1 shrink-0"><RefreshCw size={12} /> Reorder</button>}
                              {a.actionType === 'remove' && <button onClick={() => { const p = products.find(x => x.id === a.productId); if (p) setConfirmRemove({ product: p, alert: a }); }} className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-destructive/20 flex items-center gap-1 shrink-0"><Trash2 size={12} /> Remove</button>}
                              {a.actionType === 'discount' && <button onClick={() => { const p = products.find(x => x.id === a.productId); if (p) setDiscountDialog({ product: p, alert: a, percent: String(a.discountPercent || 15) }); }} className="bg-info/10 border border-info/30 text-info px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-info/20 flex items-center gap-1 shrink-0"><Tag size={12} /> Discount</button>}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ============ SUGGESTIONS ============ */}
            {tab === 'suggestions' && (
              <div className="space-y-4">
                <div className="glass p-4 border border-primary/20">
                  <h3 className="text-sm font-bold text-primary mb-2 flex items-center gap-2"><Lightbulb size={14} /> 💡 Smart Suggestions</h3>
                  <p className="text-xs text-muted-foreground">Overall advice on what to do with your inventory — based on expiry, stock levels, and sales speed.</p>
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2"><p className="font-bold text-destructive">⏰ Expired?</p><p className="text-foreground/60">Remove immediately</p></div>
                    <div className="bg-warning/10 border border-warning/20 rounded-lg p-2"><p className="font-bold text-warning">📦 Overstock?</p><p className="text-foreground/60">Discount + promote ads</p></div>
                    <div className="bg-info/10 border border-info/20 rounded-lg p-2"><p className="font-bold text-info">🐌 Not moving?</p><p className="text-foreground/60">Don't reorder, promote</p></div>
                    <div className="bg-accent/10 border border-accent/20 rounded-lg p-2"><p className="font-bold text-accent">📉 Low/Out?</p><p className="text-foreground/60">Reorder immediately</p></div>
                  </div>
                </div>
                {suggestions.length === 0 ? (
                  <div className="glass p-12 text-center"><p className="text-accent text-lg font-bold">✅ All good!</p><p className="text-xs text-muted-foreground mt-1">No suggestions right now.</p></div>
                ) : (
                  <>
                    {['OVERALL_EXPIRED','OVERALL_LOWSTOCK','OVERALL_OVERSTOCK','OVERALL_SLOW','URGENT_RESTOCK','REORDER_FAST_SELLER','CLEAR_EXPIRING','PROMOTE_SLOW_ITEM','CLEAR_OVERSTOCK'].map(type => {
                      const group = suggestions.filter(s => s.type === type);
                      if (!group.length) return null;
                      const labels: Record<string, { title: string; color: string }> = {
                        OVERALL_EXPIRED: { title: '⚠️ Expired Items — Remove Now', color: 'text-destructive border-destructive/20' },
                        OVERALL_LOWSTOCK: { title: '📉 Low Stock — Reorder Soon', color: 'text-warning border-warning/20' },
                        OVERALL_OVERSTOCK: { title: '📦 Overstock — Discount & Promote', color: 'text-info border-info/20' },
                        OVERALL_SLOW: { title: '🐌 Slow Moving — Promote, Don\'t Reorder', color: 'text-secondary border-secondary/20' },
                        URGENT_RESTOCK: { title: '🚨 Out of Stock — Reorder Now!', color: 'text-destructive border-destructive/20' },
                        REORDER_FAST_SELLER: { title: '🔄 Fast Sellers Running Low', color: 'text-accent border-accent/20' },
                        CLEAR_EXPIRING: { title: '⏰ Expiring Soon — Discount to Clear', color: 'text-warning border-warning/20' },
                        PROMOTE_SLOW_ITEM: { title: '📢 Promote Slow Items', color: 'text-info border-info/20' },
                        CLEAR_OVERSTOCK: { title: '📦 Clear Overstock', color: 'text-secondary border-secondary/20' },
                      };
                      const meta = labels[type] || { title: type, color: 'text-foreground' };
                      return (
                        <div key={type} className="space-y-2">
                          <h3 className={`text-sm font-bold ${meta.color.split(' ')[0]}`}>{meta.title} ({group.length})</h3>
                          {group.map((s, i) => (
                            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`glass p-4 border ${meta.color}`}>
                              <div className="flex justify-between items-start gap-3">
                                <div>{s.productName !== 'Overall' && <p className="text-foreground font-bold">{s.productName}</p>}<p className="text-sm text-muted-foreground mt-1">{s.suggestion}</p></div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${s.priority === 'high' ? 'text-destructive border-destructive/30 bg-destructive/10' : s.priority === 'medium' ? 'text-warning border-warning/30 bg-warning/10' : 'text-info border-info/30 bg-info/10'}`}>{s.priority === 'high' ? '🔴 Urgent' : s.priority === 'medium' ? '🟡 Soon' : '🔵 Low'}</span>
                              </div>
                              {(s.type === 'REORDER_FAST_SELLER' || s.type === 'URGENT_RESTOCK') && s.productId && <button onClick={() => { const p = products.find(x => x.id === s.productId); if (p) { setReorderProduct(p); setReorderForm({ qty: String(Math.min(p.reorderPoint ? p.reorderPoint * 3 : 50, 200)), expiryDate: '' }); } }} className="mt-2 bg-warning/10 border border-warning/30 text-warning px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-warning/20 flex items-center gap-1"><RefreshCw size={12} /> Reorder</button>}
                              {s.type === 'CLEAR_EXPIRING' && s.productId && <button onClick={() => { const p = products.find(x => x.id === s.productId); if (p) setDiscountDialog({ product: p, percent: '15' }); }} className="mt-2 bg-info/10 border border-info/30 text-info px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-info/20 flex items-center gap-1"><Tag size={12} /> Discount</button>}
                            </motion.div>
                          ))}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* ============ ACTION HISTORY ============ */}
            {tab === 'history' && (
              <div className="space-y-4">
                <div className="glass p-4 border border-primary/20">
                  <h3 className="text-sm font-bold text-primary mb-1 flex items-center gap-2"><History size={14} /> 📋 Action History</h3>
                  <p className="text-xs text-muted-foreground">Every action you've taken — removals, discounts, reorders, sales, additions. Full accountability log.</p>
                </div>
                {actionLogs.length === 0 ? (
                  <div className="glass p-12 text-center"><p className="text-muted-foreground">No actions yet. Start managing inventory to see your history here.</p></div>
                ) : (
                  <div className="space-y-5">
                    {(() => {
                      const groups: Record<string, ActionLog[]> = {};
                      actionLogs.forEach(log => {
                        const key = formatDisplayDate(log.createdAt);
                        (groups[key] ||= []).push(log);
                      });
                      const tc: Record<string, string> = { remove: 'border-l-destructive bg-destructive/5', discount: 'border-l-primary bg-primary/5', reorder: 'border-l-warning bg-warning/5', sale: 'border-l-accent bg-accent/5', add: 'border-l-info bg-info/5' };
                      const ti: Record<string, string> = { remove: '🗑️', discount: '🏷️', reorder: '📦', sale: '💵', add: '➕' };
                      return Object.entries(groups).map(([day, logs]) => (
                        <div key={day}>
                          <h4 className="text-xs font-bold text-primary uppercase tracking-wider mb-2 sticky top-0 bg-background/80 backdrop-blur-sm py-1">📅 {day} <span className="text-muted-foreground font-normal">({logs.length})</span></h4>
                          <div className="space-y-2">
                            {logs.map((log, i) => (
                              <motion.div key={i} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={`glass p-3 border-l-4 ${tc[log.actionType] || ''}`}>
                                <div className="flex items-start gap-3">
                                  <span className="text-lg">{ti[log.actionType] || '📌'}</span>
                                  <div><p className="text-sm text-foreground font-medium">{log.description}</p><p className="text-[10px] text-muted-foreground/60 mt-1">{formatDisplayDate(log.createdAt, true)} • {log.actionType.toUpperCase()}</p></div>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ============ ANALYTICS ============ */}
            {tab === 'analytics' && showAnalytics && (
              <div className="space-y-4">
                <div className="glass p-3 border border-primary/20">
                  <p className="text-xs text-muted-foreground">📊 <strong className="text-foreground">Analytics</strong> — Understand your sales performance, top sellers, slow movers, and category breakdown.</p>
                </div>

                {/* Sales performance */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { l: '💵 Total Revenue', v: fmt(totalRevenue), sub: 'From all sales', c: 'text-primary' },
                    { l: '💰 Total Profit', v: fmt(totalProfit), sub: `Margin: ${profitMargin}%`, c: 'text-accent' },
                    { l: '🛒 Total Sales', v: totalSalesCount, sub: avgOrderValue > 0 ? `Avg: ${fmt(avgOrderValue)}` : 'No sales yet', c: 'text-secondary' },
                    { l: '📦 Stock Value', v: fmt(totalStockValue), sub: 'Cost of inventory on hand', c: 'text-warning' },
                    { l: '🏷️ Retail Value', v: fmt(totalRetailValue), sub: 'If all stock is sold', c: 'text-primary' },
                    { l: '⚠️ At Risk', v: fmt(potentialLoss), sub: 'Expiring within 30 days', c: 'text-destructive' },
                  ].map((s, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass p-4 text-center perspective-card">
                      <p className="text-xs text-muted-foreground mb-1">{s.l}</p>
                      <p className={`text-xl font-black font-display ${s.c}`}>{s.v}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>
                    </motion.div>
                  ))}
                </div>

                {/* Top sellers & slow movers */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="glass p-4">
                    <h3 className="text-sm font-bold text-accent mb-3">🏆 Top Sellers (by speed)</h3>
                    {products.filter(p => getSalesSpeed(p) > 0).sort((a, b) => getSalesSpeed(b) - getSalesSpeed(a)).slice(0, 5).map((p, i) => (
                      <div key={i} className="flex justify-between py-1.5 border-b border-border/30 text-xs"><span className="text-foreground/70">{p.name}</span><span className="text-accent font-bold">{getSalesSpeed(p).toFixed(1)} units/day</span></div>
                    ))}
                    {!products.some(p => getSalesSpeed(p) > 0) && <p className="text-xs text-muted-foreground">No sales recorded yet. Start selling to see top performers.</p>}
                  </div>
                  <div className="glass p-4">
                    <h3 className="text-sm font-bold text-warning mb-3">🐌 Slow Moving Items</h3>
                    {products.filter(p => p.lastSold && Math.ceil((Date.now() - new Date(p.lastSold).getTime()) / 86400000) > 30).slice(0, 5).map((p, i) => {
                      const daysSince = Math.ceil((Date.now() - new Date(p.lastSold!).getTime()) / 86400000);
                      return (
                        <div key={i} className="flex justify-between py-1.5 border-b border-border/30 text-xs"><span className="text-foreground/70">{p.name}</span><span className="text-warning font-bold">{daysSince}d idle • {fmt(p.costPrice * p.quantity)}</span></div>
                      );
                    })}
                    {!products.some(p => p.lastSold && Math.ceil((Date.now() - new Date(p.lastSold).getTime()) / 86400000) > 30) && <p className="text-xs text-muted-foreground">No slow movers. All items are active.</p>}
                  </div>
                </div>

                {/* Category breakdown */}
                <div className="glass p-4">
                  <h3 className="text-sm font-bold text-primary mb-3">📂 Category Breakdown</h3>
                  {Analytics.categories(business.id).length > 0 ? (
                    <div className="space-y-2">
                      {Analytics.categories(business.id).map((c, i) => (
                        <div key={i} className="flex justify-between items-center py-1.5 border-b border-border/30 text-xs">
                          <span className="text-foreground/70">{c.name}</span>
                          <div className="flex gap-4">
                            <span className="text-muted-foreground">{c.count} items</span>
                            <span className="text-primary font-bold">{fmt(c.value)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-muted-foreground">No products added yet.</p>}
                </div>
              </div>
            )}

            {/* ============ FINANCIALS ============ */}
            {tab === 'financials' && showFinancials && (
              <div className="space-y-4">
                <div className="glass p-3 border border-primary/20">
                  <p className="text-xs text-muted-foreground">💰 <strong className="text-foreground">Financials</strong> — Detailed profit & loss statement. Understand where your money goes.</p>
                </div>

                <div className="glass p-4">
                  <h3 className="text-sm font-bold text-accent mb-4">📊 Profit & Loss Statement</h3>
                  <table className="w-full text-sm"><tbody>
                    {[
                      ['💵 Total Revenue', fmt(totalRevenue), 'text-primary', 'Money earned from sales'],
                      ['💸 Total Cost of Goods Sold', fmt(totalCost), 'text-destructive', 'What you paid for items sold'],
                      ['💰 Gross Profit', fmt(totalProfit), 'text-accent', 'Revenue minus cost'],
                      ['📊 Profit Margin', profitMargin + '%', totalProfit > 0 ? 'text-accent' : 'text-destructive', 'Profit as % of revenue'],
                    ].map(([l, v, c, desc], i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-3"><p className="text-foreground">{l}</p><p className="text-[10px] text-muted-foreground">{desc}</p></td>
                        <td className={`py-3 text-right font-black text-lg ${c}`}>{v}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>

                <div className="glass p-4">
                  <h3 className="text-sm font-bold text-warning mb-4">📦 Inventory Valuation</h3>
                  <table className="w-full text-sm"><tbody>
                    {[
                      ['📦 Inventory at Cost', fmt(totalStockValue), 'text-warning', 'Total cost of all stock on hand'],
                      ['🏷️ Inventory at Retail', fmt(totalRetailValue), 'text-primary', 'Potential revenue if everything sells'],
                      ['📈 Potential Gross Profit', fmt(totalRetailValue - totalStockValue), 'text-accent', 'Max profit from current inventory'],
                      ['⚠️ At Risk (Expiring 30d)', fmt(potentialLoss), 'text-destructive', 'Value of items expiring within 30 days'],
                    ].map(([l, v, c, desc], i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-3"><p className="text-foreground">{l}</p><p className="text-[10px] text-muted-foreground">{desc}</p></td>
                        <td className={`py-3 text-right font-black text-lg ${c}`}>{v}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>

                <div className="glass p-4">
                  <h3 className="text-sm font-bold text-primary mb-4">🛒 Sales Summary</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center p-3 bg-muted/10 rounded-xl">
                      <p className="text-xs text-muted-foreground">Total Transactions</p>
                      <p className="text-2xl font-black font-display text-primary">{totalSalesCount}</p>
                    </div>
                    <div className="text-center p-3 bg-muted/10 rounded-xl">
                      <p className="text-xs text-muted-foreground">Avg. Order Value</p>
                      <p className="text-2xl font-black font-display text-accent">{fmt(avgOrderValue)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
