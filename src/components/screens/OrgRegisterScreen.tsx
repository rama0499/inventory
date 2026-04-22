import { useState } from 'react';
import { motion } from 'framer-motion';
import DB, { type Organization, type User, type BusinessMode, BUSINESS_TYPES, CURRENCIES } from '@/lib/database';
import { ArrowLeft, ArrowRight, CheckCircle2, Lock } from 'lucide-react';

interface Props {
  user: User;
  mode: BusinessMode;
  onDone: (org: Organization) => void;
  onBack: () => void;
}

export default function OrgRegisterScreen({ user, mode, onDone, onBack }: Props) {
  const [form, setForm] = useState({
    name: '', type: '', address: '', phone: '', gstin: '', currency: 'INR (₹)', warehouse: ''
  });
  const [shared, setShared] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState(false);
  const [newOrg, setNewOrg] = useState<Organization | null>(null);

  const update = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!form.name || !form.type || !form.address) {
      setErr('Business name, type, and address are required.');
      return;
    }
    if (shared && secretKey.trim().length < 4) {
      setErr('Secret key must be at least 4 characters when sharing is enabled.');
      return;
    }
    const org = DB.insert('businesses', {
      ...form, ownerId: user.id, mode,
      shared, secretKey: shared ? secretKey.trim() : '',
      setupComplete: true
    }) as unknown as Organization;
    setNewOrg(org);
    setSuccess(true);
  };

  if (success && newOrg) {
    return (
      <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-5">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="glass p-10 max-w-md text-center glow-box-green">
          <CheckCircle2 size={64} className="text-accent mx-auto mb-4" />
          <h2 className="text-2xl font-black font-display text-foreground mb-2">
            Organization Registered!
          </h2>
          <p className="text-muted-foreground text-sm mb-2">
            <span className="text-accent font-bold">{newOrg.name}</span> has been successfully added to the system.
          </p>
          <p className="text-muted-foreground/60 text-xs mb-6">
            Your organization is now visible to team members under "Already Registered".
          </p>
          <button onClick={() => onDone(newOrg)}
            className="w-full bg-accent/10 border border-accent/30 hover:bg-accent/20 text-accent font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
            Continue to Add Inventory <ArrowRight size={16} />
          </button>
        </motion.div>
      </div>
    );
  }

  const inputCls = "w-full bg-muted/30 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all";

  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-5">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl">
        <button onClick={onBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-primary text-sm mb-6 transition-colors">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="text-center mb-6">
          <h1 className="text-2xl font-black font-display text-foreground">🏢 Register Organization</h1>
          <p className="text-muted-foreground text-sm mt-1">Fill in your business details</p>
        </div>

        <div className="glass p-6 glow-box-cyan">
          {err && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-destructive text-sm mb-4">
              ⚠ {err}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">
                Business Name <span className="text-destructive">*</span>
              </label>
              <input value={form.name} onChange={update('name')} required placeholder="Your business name" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">
                Business Type <span className="text-destructive">*</span>
              </label>
              <select value={form.type} onChange={update('type')} required className={inputCls}>
                <option value="">Select type…</option>
                {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">
                Address <span className="text-destructive">*</span>
              </label>
              <input value={form.address} onChange={update('address')} required placeholder="Full business address" className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">Phone</label>
                <input value={form.phone} onChange={update('phone')} type="tel" placeholder="+91 98765 43210" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">GSTIN</label>
                <input value={form.gstin} onChange={update('gstin')} placeholder="Optional" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">Currency</label>
                <select value={form.currency} onChange={update('currency')} className={inputCls}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">Primary Warehouse</label>
                <input value={form.warehouse} onChange={update('warehouse')} placeholder="Main Store" className={inputCls} />
              </div>
            </div>

            <div className="border border-border/50 rounded-xl p-4 bg-muted/20 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shared}
                  onChange={e => setShared(e.target.checked)}
                  className="mt-1 accent-primary"
                />
                <div>
                  <div className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Lock size={14} /> Allow other users to discover this organization
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When enabled, your organization name will be visible to others, but they will need a secret key to access it.
                  </p>
                </div>
              </label>
              {shared && (
                <div>
                  <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">
                    Secret Key <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={secretKey}
                    onChange={e => setSecretKey(e.target.value)}
                    placeholder="Share this key only with trusted team members"
                    className={inputCls}
                  />
                </div>
              )}
            </div>

            <button type="submit"
              className="w-full bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 mt-2">
              Register Organization <ArrowRight size={16} />
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
