import { useState } from 'react';
import { motion } from 'framer-motion';
import DB, { type Organization, type BusinessMode } from '@/lib/database';
import { ArrowLeft, Building, Search, ArrowRight, CheckCircle, Lock } from 'lucide-react';

interface Props {
  userId: string;
  mode: BusinessMode;
  onSelectOrg: (org: Organization) => void;
  onRegisterNew: () => void;
  onBack: () => void;
}

export default function OrgChoiceScreen({ userId, mode, onSelectOrg, onRegisterNew, onBack }: Props) {
  const [choice, setChoice] = useState<'none' | 'registered' | 'new'>('none');
  const [search, setSearch] = useState('');
  const [unlockOrg, setUnlockOrg] = useState<Organization | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyErr, setKeyErr] = useState('');

  // Visible orgs = owned by current user (matching mode) OR shared (matching mode)
  const allOrgs = DB.findMany<Organization>('businesses');
  const visibleOrgs = allOrgs.filter(o =>
    o.mode === mode && (o.ownerId === userId || o.shared === true)
  );
  const filtered = visibleOrgs.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.type?.toLowerCase().includes(search.toLowerCase())
  );

  const handleOrgClick = (org: Organization) => {
    if (org.ownerId === userId) {
      onSelectOrg(org);
      return;
    }
    // Shared org owned by someone else — require secret key
    setUnlockOrg(org);
    setKeyInput('');
    setKeyErr('');
  };

  const submitKey = () => {
    if (!unlockOrg) return;
    if (keyInput.trim() === (unlockOrg.secretKey || '')) {
      const org = unlockOrg;
      setUnlockOrg(null);
      onSelectOrg(org);
    } else {
      setKeyErr('Incorrect secret key. Please try again.');
    }
  };

  if (choice === 'none') {
    return (
      <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-5">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg">
          <button onClick={onBack}
            className="flex items-center gap-2 text-muted-foreground hover:text-primary text-sm mb-6 transition-colors">
            <ArrowLeft size={16} /> Back
          </button>

          <div className="text-center mb-8">
            <Building size={48} className="text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-black font-display text-foreground mb-2">Organization Setup</h1>
            <p className="text-muted-foreground text-sm">Is your organization already registered in the system?</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setChoice('registered')}
              className="glass p-6 text-center cursor-pointer border-primary/20 hover:border-primary/50 transition-all glow-box-cyan"
            >
              <CheckCircle size={36} className="text-primary mx-auto mb-3" />
              <h3 className="font-bold text-foreground mb-1">Already Registered</h3>
              <p className="text-xs text-muted-foreground">Find and join your existing organization</p>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => { setChoice('new'); onRegisterNew(); }}
              className="glass p-6 text-center cursor-pointer border-accent/20 hover:border-accent/50 transition-all glow-box-green"
            >
              <Building size={36} className="text-accent mx-auto mb-3" />
              <h3 className="font-bold text-foreground mb-1">Not Yet Registered</h3>
              <p className="text-xs text-muted-foreground">Register your organization details</p>
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Registered: show org search/list
  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-5">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg">
        <button onClick={() => setChoice('none')}
          className="flex items-center gap-2 text-muted-foreground hover:text-primary text-sm mb-6 transition-colors">
          <ArrowLeft size={16} /> Back
        </button>

        <h1 className="text-2xl font-black font-display text-foreground text-center mb-2">
          Select Your Organization
        </h1>
        <p className="text-muted-foreground text-center text-sm mb-6">
          Showing your organizations and shared organizations for <span className="text-primary font-bold">{mode}</span> mode
        </p>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search organization by name..."
            className="w-full bg-muted/30 border border-border rounded-xl pl-10 pr-4 py-2.5 text-foreground text-sm outline-none focus:border-primary/50 transition-all"
          />
        </div>

        {/* Org list */}
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="glass p-8 text-center">
              <p className="text-muted-foreground text-sm mb-4">
                No organizations found.
              </p>
              <button onClick={() => { setChoice('new'); onRegisterNew(); }}
                className="text-primary text-sm font-bold hover:underline flex items-center gap-1 mx-auto">
                Register New Organization <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            filtered.map(org => {
              const isOwner = org.ownerId === userId;
              const isLocked = !isOwner && org.shared;
              return (
                <motion.button
                  key={org.id}
                  whileHover={{ scale: 1.01 }}
                  onClick={() => handleOrgClick(org)}
                  className="w-full glass p-4 text-left cursor-pointer hover:border-primary/40 transition-all flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                      {isLocked && <Lock size={12} className="text-muted-foreground" />}
                      {org.name}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {isLocked ? 'Shared organization — secret key required' : `${org.type} • ${org.address}`}
                    </p>
                  </div>
                  <ArrowRight size={16} className="text-primary shrink-0 ml-2" />
                </motion.button>
              );
            })
          )}
        </div>

        {/* Secret key modal */}
        {unlockOrg && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center p-5 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass p-6 max-w-sm w-full glow-box-cyan"
            >
              <div className="text-center mb-4">
                <Lock size={36} className="text-primary mx-auto mb-2" />
                <h3 className="font-black text-foreground">{unlockOrg.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">Enter the secret key to access this organization</p>
              </div>
              <input
                type="password"
                value={keyInput}
                onChange={e => { setKeyInput(e.target.value); setKeyErr(''); }}
                onKeyDown={e => e.key === 'Enter' && submitKey()}
                placeholder="Secret key"
                autoFocus
                className="w-full bg-muted/30 border border-border rounded-xl px-4 py-2.5 text-foreground text-sm outline-none focus:border-primary/50 transition-all"
              />
              {keyErr && (
                <p className="text-destructive text-xs mt-2">⚠ {keyErr}</p>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setUnlockOrg(null)}
                  className="flex-1 bg-muted/30 border border-border hover:bg-muted/50 text-foreground font-bold py-2.5 rounded-xl text-sm transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={submitKey}
                  className="flex-1 bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary font-bold py-2.5 rounded-xl text-sm transition-all"
                >
                  Unlock
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
