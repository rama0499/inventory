import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Inv } from '@/lib/services';
import type { Organization, Product } from '@/lib/database';
import { CATEGORIES, UNITS } from '@/lib/database';
import { parseInventoryCsvText } from '@/lib/inventory-utils';
import { ArrowLeft, ArrowRight, Package, Upload, FileText, Plus, X, Check } from 'lucide-react';

interface Props {
  business: Organization;
  onDone: () => void;
  onBack: () => void;
}

type AddMode = 'single' | 'bulk_csv' | 'file_upload';

export default function InventorySetupScreen({ business, onDone, onBack }: Props) {
  const [tab, setTab] = useState<AddMode>('single');
  const [form, setForm] = useState({
    name: '', barcode: '', category: '', quantity: '', costPrice: '',
    sellingPrice: '', unit: 'unit', reorderPoint: '', expiryDate: '', hasExpiry: 'yes'
  });
  const [bulkText, setBulkText] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [products, setProducts] = useState<Product[]>(() => Inv.get(business.id));
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setProducts(Inv.get(business.id));

  const update = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const addSingle = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setOk('');
    if (!form.name || !form.barcode || !form.category || !form.quantity || !form.costPrice || !form.sellingPrice) {
      setErr('Name, barcode, category, quantity, cost price, and selling price are required.'); return;
    }
    const wantsExpiry = form.hasExpiry === 'yes';
    if (wantsExpiry && !form.expiryDate.trim()) {
      setErr('Expiry date is required when "Has expiry" is Yes.'); return;
    }
    const r = Inv.add(business.id, {
      name: form.name, barcode: form.barcode, category: form.category,
      quantity: parseInt(form.quantity), costPrice: parseFloat(form.costPrice),
      sellingPrice: parseFloat(form.sellingPrice), unit: form.unit,
      reorderPoint: parseInt(form.reorderPoint) || 10,
      hasExpiry: wantsExpiry,
      expiryDate: wantsExpiry ? form.expiryDate : '',
    } as Partial<Product>);
    if (r.error) { setErr(r.error); return; }
    setOk(`${form.name} added successfully!`);
    setForm({ name: '', barcode: '', category: '', quantity: '', costPrice: '', sellingPrice: '', unit: 'unit', reorderPoint: '', expiryDate: '', hasExpiry: 'yes' });
    refresh();
  };

  const uploadBulk = () => {
    setErr(''); setOk('');
    try {
      const items = parseInventoryCsvText(bulkText);
      if (!items.length) { setErr('No valid rows found. Keep expiryDate as the last CSV column.'); return; }
      const r = Inv.bulk(business.id, items as unknown as Partial<Product>[]);
      setOk(`Added ${r.added} products.${r.errors.length ? ' Errors: ' + r.errors.join('; ') : ''}`);
      refresh();
    } catch { setErr('Invalid CSV format. Check the template above.'); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(''); setOk('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) { setErr('Could not read file.'); return; }
      try {
        const items = parseInventoryCsvText(text);
        if (!items.length) { setErr('No valid rows found. Keep expiryDate as the last CSV column.'); return; }
        const r = Inv.bulk(business.id, items as unknown as Partial<Product>[]);
        setOk(`Imported ${r.added} products from file.${r.errors.length ? ' Errors: ' + r.errors.join('; ') : ''}`);
        refresh();
      } catch { setErr('Could not parse file. Make sure it follows the CSV format.'); }
    };
    reader.readAsText(file);
  };

  const inputCls = "w-full bg-muted/30 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all";

  const tabs: { id: AddMode; label: string; icon: React.ReactNode }[] = [
    { id: 'single', label: 'Single Entry', icon: <Plus size={14} /> },
    { id: 'bulk_csv', label: 'Paste CSV', icon: <FileText size={14} /> },
    { id: 'file_upload', label: 'Upload File', icon: <Upload size={14} /> },
  ];

  return (
    <div className="min-h-screen bg-background bg-grid p-5">
      <div className="max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <button onClick={onBack}
            className="flex items-center gap-2 text-muted-foreground hover:text-primary text-sm mb-6 transition-colors">
            <ArrowLeft size={16} /> Back
          </button>

          <div className="text-center mb-6">
            <Package size={40} className="text-primary mx-auto mb-3" />
            <h1 className="text-2xl font-black font-display text-foreground">Add Your Inventory</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Add products so the system can start tracking for you
            </p>
          </div>

          <div className="glass p-1 mb-4 flex rounded-xl overflow-hidden">
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setErr(''); setOk(''); }}
                className={`flex-1 py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5 rounded-lg ${
                  tab === t.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {err && <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-destructive text-sm mb-4">⚠ {err}</div>}
          {ok && <div className="bg-accent/10 border border-accent/30 rounded-xl p-3 text-accent text-sm mb-4 flex items-center gap-2"><Check size={14} /> {ok}</div>}

          {/* SINGLE ENTRY FORM - no reorder qty, no barcode scan */}
          {tab === 'single' && (
            <div className="glass p-6 mb-4">
              <form onSubmit={addSingle} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Product Name <span className="text-destructive">*</span></label>
                    <input value={form.name} onChange={update('name')} required placeholder="Product name" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Barcode <span className="text-destructive">*</span></label>
                    <input value={form.barcode} onChange={update('barcode')} required placeholder="Barcode number" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Category <span className="text-destructive">*</span></label>
                    <select value={form.category} onChange={update('category')} required className={inputCls}>
                      <option value="">Select…</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Unit</label>
                    <select value={form.unit} onChange={update('unit')} className={inputCls}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Quantity <span className="text-destructive">*</span></label>
                    <input type="number" value={form.quantity} onChange={update('quantity')} required placeholder="0" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Cost Price <span className="text-destructive">*</span></label>
                    <input type="number" step="0.01" value={form.costPrice} onChange={update('costPrice')} required placeholder="0.00" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Selling Price <span className="text-destructive">*</span></label>
                    <input type="number" step="0.01" value={form.sellingPrice} onChange={update('sellingPrice')} required placeholder="0.00" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Has Expiry?</label>
                    <select value={form.hasExpiry} onChange={e => setForm(f => ({ ...f, hasExpiry: e.target.value, expiryDate: e.target.value === 'no' ? '' : f.expiryDate }))} className={inputCls}>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                  {form.hasExpiry === 'yes' && (
                    <div>
                      <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1">Expiry Date <span className="text-destructive">*</span></label>
                      <input value={form.expiryDate} onChange={update('expiryDate')} required placeholder="DD/MM/YYYY" className={inputCls + ' font-mono'} />
                    </div>
                  )}
                </div>

                <button type="submit"
                  className="w-full bg-primary/10 border border-primary/30 text-primary font-bold py-2.5 rounded-xl text-sm hover:bg-primary/20 transition-all flex items-center justify-center gap-2">
                  <Plus size={14} /> Add Product
                </button>
              </form>
            </div>
          )}

          {/* BULK CSV */}
          {tab === 'bulk_csv' && (
            <div className="glass p-6 mb-4">
              <p className="text-xs text-muted-foreground mb-3">
                Paste CSV data with header: name,barcode,category,quantity,costPrice,sellingPrice,unit,reorderPoint,expiryDate (use DD/MM/YYYY)
              </p>
              <textarea value={bulkText} onChange={e => setBulkText(e.target.value)}
                placeholder="name,barcode,category,quantity,costPrice,sellingPrice,unit,reorderPoint,expiryDate&#10;Rice,1001,Grains & Cereals,100,40,55,kg,20,31/12/2025"
                rows={8} className={inputCls + " font-mono text-xs"} />
              <button onClick={uploadBulk}
                className="mt-3 w-full bg-primary/10 border border-primary/30 text-primary font-bold py-2.5 rounded-xl text-sm hover:bg-primary/20 transition-all flex items-center justify-center gap-2">
                <FileText size={14} /> Import CSV Data
              </button>
            </div>
          )}

          {/* FILE UPLOAD */}
          {tab === 'file_upload' && (
            <div className="glass p-6 mb-4 text-center">
              <Upload size={48} className="text-primary mx-auto mb-4 opacity-60" />
              <p className="text-sm text-muted-foreground mb-4">Upload a .csv file with your inventory data and expiry dates in DD/MM/YYYY</p>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
              <button onClick={() => fileRef.current?.click()}
                className="bg-primary/10 border border-primary/30 text-primary font-bold py-2.5 px-8 rounded-xl text-sm hover:bg-primary/20 transition-all flex items-center justify-center gap-2 mx-auto">
                <Upload size={14} /> Choose CSV File
              </button>
            </div>
          )}

          {/* Product list */}
          {products.length > 0 && (
            <div className="glass p-4 mb-4">
              <h3 className="text-sm font-bold text-primary mb-3 flex items-center gap-2">
                <Package size={14} /> Added Products ({products.length})
              </h3>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {products.map(p => (
                  <div key={p.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/20 text-sm">
                    <div>
                      <span className="font-bold text-foreground">{p.name}</span>
                      <span className="text-muted-foreground text-xs ml-2">({p.barcode})</span>
                    </div>
                    <span className="text-primary text-xs font-bold">{p.quantity} {p.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Continue */}
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              {products.length === 0 ? 'Add at least one product to continue' : `${products.length} product(s) added`}
            </p>
            <button onClick={onDone} disabled={products.length === 0}
              className="bg-accent/10 border border-accent/30 text-accent font-bold py-2.5 px-8 rounded-xl text-sm hover:bg-accent/20 transition-all flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed">
              Continue to Dashboard <ArrowRight size={14} />
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
