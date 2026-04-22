import { motion } from 'framer-motion';
import type { BusinessMode } from '@/lib/database';
import { Store, Building2, Factory, ArrowLeft, ArrowRight, Check, X } from 'lucide-react';

interface Props {
  onSelect: (mode: BusinessMode) => void;
  onBack: () => void;
}

const modes = [
  {
    id: 'small' as BusinessMode,
    label: 'Small Business',
    icon: Store,
    desc: 'Perfect for single-location shops, kirana stores, small retail outlets.',
    features: ['Basic inventory tracking', 'Stock alerts & reorder', 'Simple dashboard', 'Manual & barcode entry'],
    excluded: ['Analytics & reports', 'Financial statements', 'Multi-warehouse'],
    color: 'text-accent border-accent/30 bg-accent/5 hover:border-accent/60',
    glowClass: 'glow-box-green',
  },
  {
    id: 'medium' as BusinessMode,
    label: 'Medium Business',
    icon: Building2,
    desc: 'Growing businesses with multiple product lines. Analytics & category insights.',
    features: ['Everything in Small', 'Category analytics', 'Sales tracking', 'Bulk CSV import', 'Smart suggestions'],
    excluded: ['Full P&L statements', 'Multi-warehouse'],
    color: 'text-primary border-primary/30 bg-primary/5 hover:border-primary/60',
    glowClass: 'glow-box-cyan',
  },
  {
    id: 'large' as BusinessMode,
    label: 'Enterprise',
    icon: Factory,
    desc: 'Full-featured inventory management with financials, trends, multi-warehouse support.',
    features: ['Everything in Medium', 'Profit & Loss statements', 'Trend forecasting', 'Multi-warehouse', 'Dead stock analysis', 'Full financial reports'],
    excluded: [],
    color: 'text-secondary border-secondary/30 bg-secondary/5 hover:border-secondary/60',
    glowClass: 'glow-box-purple',
  },
];

export default function ModeSelectScreen({ onSelect, onBack }: Props) {
  return (
    <div className="min-h-screen bg-background bg-grid flex flex-col items-center justify-center p-5">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl"
      >
        <button onClick={onBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-primary text-sm mb-6 transition-colors">
          <ArrowLeft size={16} /> Back to Sign In
        </button>

        <h1 className="text-3xl font-black font-display text-foreground text-center mb-2">
          Select Business Scale
        </h1>
        <p className="text-muted-foreground text-center text-sm mb-10">
          Choose the mode that fits your business. This determines which features and analytics you'll see.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {modes.map((m, i) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => onSelect(m.id)}
              className={`glass p-6 cursor-pointer transition-all duration-300 perspective-card ${m.color} ${m.glowClass}`}
            >
              <div className="flex flex-col items-center text-center mb-4">
                <m.icon size={42} className="mb-3 opacity-80" />
                <h2 className="text-xl font-bold font-display">{m.label}</h2>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{m.desc}</p>
              </div>

              <div className="space-y-1.5 mb-4">
                {m.features.map(f => (
                  <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check size={12} className="text-accent shrink-0" /> {f}
                  </div>
                ))}
                {m.excluded.map(f => (
                  <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground/40">
                    <X size={12} className="text-destructive/40 shrink-0" /> {f}
                  </div>
                ))}
              </div>

              <button className={`w-full border rounded-xl py-2.5 text-sm font-bold transition-all flex items-center justify-center gap-2 ${m.color}`}>
                Select <ArrowRight size={14} />
              </button>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
