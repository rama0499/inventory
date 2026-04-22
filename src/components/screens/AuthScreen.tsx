import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Auth } from '@/lib/services';
import type { User } from '@/lib/database';
import { LogIn, UserPlus, Eye, EyeOff, ArrowRight } from 'lucide-react';

interface Props {
  onAuth: (user: User) => void;
}

export default function AuthScreen({ onAuth }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({ fullName: '', username: '', email: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const update = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setOk('');
    if (mode === 'signup') {
      const r = Auth.signup({ ...form, role: 'Owner' });
      if (r.error) { setErr(r.error); return; }
      setOk('Account created! You can now sign in.');
      setMode('login');
      setForm(f => ({ ...f, fullName: '', email: '', password: '' }));
    } else {
      const r = Auth.login({ username: form.username, password: form.password });
      if (r.error) { setErr(r.error); return; }
      onAuth(r.user as User);
    }
  };

  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-5 relative overflow-hidden">
      <div className="absolute w-96 h-96 rounded-full bg-glow-purple/5 -top-24 -left-24 animate-float-slow blur-3xl" />
      <div className="absolute w-64 h-64 rounded-full bg-primary/5 -bottom-16 -right-16 animate-float blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-black font-display glow-text text-shadow-glow tracking-tight leading-tight">
            Smart Inventory Tracker
          </h1>
        </div>

        <div className="glass p-6 glow-box-cyan">
          <div className="flex rounded-xl overflow-hidden border border-border mb-6">
            {(['login', 'signup'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setErr(''); setOk(''); }}
                className={`flex-1 py-3 text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                  mode === m ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'login' ? <LogIn size={14} /> : <UserPlus size={14} />}
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          {err && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-destructive text-sm mb-4 flex items-center gap-2">
              ⚠ {err}
            </motion.div>
          )}
          {ok && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="bg-accent/10 border border-accent/30 rounded-xl p-3 text-accent text-sm mb-4 flex items-center gap-2">
              ✓ {ok}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">
                    Full Name <span className="text-destructive">*</span>
                  </label>
                  <input value={form.fullName} onChange={update('fullName')} required
                    placeholder="Your full name"
                    className="w-full bg-muted/30 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">
                    Email <span className="text-destructive">*</span>
                  </label>
                  <input type="email" value={form.email} onChange={update('email')} required
                    placeholder="you@business.com"
                    className="w-full bg-muted/30 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">
                Username <span className="text-destructive">*</span>
              </label>
              <input value={form.username} onChange={update('username')} required
                placeholder="Your username"
                className="w-full bg-muted/30 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground font-bold uppercase tracking-wider mb-1.5">
                Password <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password} onChange={update('password')} required
                  placeholder={mode === 'signup' ? 'Min 6 characters' : '••••••••'}
                  className="w-full bg-muted/30 border border-border rounded-xl px-4 py-2.5 pr-10 text-foreground text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit"
              className="w-full bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-[0_0_20px_hsl(var(--primary)/0.2)]">
              {mode === 'login' ? 'Sign In' : 'Create Account'}
              <ArrowRight size={16} />
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground/30 mt-4">
          Smart Inventory Tracker v2.0
        </p>
      </motion.div>
    </div>
  );
}
