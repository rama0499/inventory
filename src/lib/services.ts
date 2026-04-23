import DB, { type Product, type Alert, type Suggestion, type Sale, type ActionLog, type Batch, type BusinessMode, type Organization, type User } from './database';
import { getDaysUntilExpiry, normalizeExpiryDate, parseExpiryDate } from './inventory-utils';

function sanitizeProductInput(p: Partial<Product>): Partial<Product> {
  const out: Partial<Product> = { ...p };
  if ('expiryDate' in p) out.expiryDate = normalizeExpiryDate(p.expiryDate);
  // Backward-compat: if hasExpiry not provided, infer from expiryDate
  if (out.hasExpiry === undefined) {
    out.hasExpiry = Boolean(out.expiryDate);
  }
  // If user explicitly opted out of expiry, clear expiryDate
  if (out.hasExpiry === false) out.expiryDate = '';
  return out;
}

function sameCalendarDay(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeExpiryDate(a) === normalizeExpiryDate(b);
}

function getAtRiskUnits(batchQty: number, daysLeft: number, salesSpeed: number): number {
  if (batchQty <= 0) return 0;
  if (salesSpeed <= 0) return batchQty;

  const safetyWindow = Math.max(daysLeft - 1, 0);
  const likelyToSell = Math.floor(salesSpeed * safetyWindow);
  return Math.max(0, batchQty - likelyToSell);
}

type RiskLevel = 'none' | 'low' | 'medium' | 'high';

function getRiskLevel(unitsAtRisk: number, batchQty: number, daysLeft: number): RiskLevel {
  if (unitsAtRisk <= 0) return 'none';
  if (daysLeft <= 3 || unitsAtRisk >= Math.max(10, batchQty * 0.6)) return 'high';
  if (daysLeft <= 7 || unitsAtRisk >= Math.max(3, batchQty * 0.25)) return 'medium';
  return 'low';
}

function getSmartDiscountPercent(p: Product, batchQty: number, daysLeft: number, salesSpeed: number, risk: RiskLevel): number {
  if (risk === 'none' || risk === 'low') return 0;
  const margin = Math.max(0, p.sellingPrice - p.costPrice);
  const marginRatio = p.sellingPrice > 0 ? margin / p.sellingPrice : 0;
  const maxSafeDiscount = Math.max(5, Math.floor(marginRatio * 100 * 0.85));

  if (risk === 'high') {
    const base = daysLeft <= 1 ? 30 : daysLeft <= 3 ? 22 : 18;
    return Math.max(15, Math.min(base, maxSafeDiscount, 30));
  }
  // medium
  const base = daysLeft <= 7 ? 10 : 7;
  return Math.max(5, Math.min(base, maxSafeDiscount, 10));
}

function makeBatch(quantity: number, expiryDate: string): Batch {
  return {
    id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    quantity: Math.max(0, quantity),
    expiryDate: normalizeExpiryDate(expiryDate),
    addedAt: new Date().toISOString(),
  };
}

function getProductBatches(p: Product): Batch[] {
  if (p.batches && p.batches.length > 0) return p.batches;
  if (p.quantity > 0) {
    return [makeBatch(p.quantity, p.expiryDate || '')];
  }
  return [];
}

function recomputeProductFromBatches(p: Product): Partial<Product> {
  const batches = (p.batches || []).filter(b => b.quantity > 0);
  const totalQty = batches.reduce((s, b) => s + b.quantity, 0);
  const dated = batches.filter(b => b.expiryDate).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  return {
    batches,
    quantity: totalQty,
    expiryDate: dated.length ? dated[0].expiryDate : '',
  };
}

// Auth
export const Auth = {
  signup: (data: { fullName: string; username: string; email: string; password: string; role?: string }) => {
    if (!data.fullName || !data.username || !data.email || !data.password)
      return { error: 'All fields are required.' };
    if (DB.findOne('users', (u: any) => u.username === data.username))
      return { error: 'Username already exists.' };
    if (DB.findOne('users', (u: any) => u.email === data.email))
      return { error: 'Email already registered.' };
    if (data.password.length < 6)
      return { error: 'Password must be at least 6 characters.' };
    const user = DB.insert('users', data);
    return { user };
  },
  login: (data: { username: string; password: string }) => {
    if (!data.username || !data.password)
      return { error: 'Username and password are required.' };
    const user = DB.findOne('users', (u: any) => u.username === data.username && u.password === data.password);
    if (!user) return { error: 'Invalid username or password.' };
    return { user };
  }
};

// Inventory
export const Inv = {
  add: (bizId: string, p: Partial<Product>) => {
    const existing = p.barcode
      ? DB.findOne<Product>('products', x => x.barcode === p.barcode && x.businessId === bizId)
      : null;
    const qty = Number(p.quantity) || 0;
    const exp = normalizeExpiryDate(p.expiryDate);

    if (existing) {
      if (qty <= 0) return { error: 'Quantity must be greater than 0.' };

      const baseBatches = getProductBatches(existing);
      const matchedBatch = baseBatches.find(batch => sameCalendarDay(batch.expiryDate, exp));
      const batches = matchedBatch
        ? baseBatches.map(batch => batch.id === matchedBatch.id ? { ...batch, quantity: batch.quantity + qty } : batch)
        : [...baseBatches, makeBatch(qty, exp)];
      const recomputed = recomputeProductFromBatches({ ...existing, batches } as Product);
      const updated = DB.update<Product>('products', existing.id, recomputed);
      return { product: updated };
    }

    const sanitized = sanitizeProductInput({
      ...p, businessId: bizId, salesCount: 0, lastSold: null,
      batches: qty > 0 ? [makeBatch(qty, exp)] : [],
    });
    const prod = DB.insert('products', sanitized);
    return { product: prod };
  },
  get: (bizId: string): Product[] => DB.findMany<Product>('products', p => p.businessId === bizId),
  recordSale: (bizId: string, pId: string, qty: number, price: number) => {
    const p = DB.findOne<Product>('products', x => x.id === pId);
    if (!p) return { error: 'Product not found.' };
    if (p.quantity < qty) return { error: `Insufficient stock. Only ${p.quantity} units available.` };
    let remaining = qty;
    const batches = [...(p.batches || [])].sort((a, b) => {
      if (!a.expiryDate && !b.expiryDate) return 0;
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate.localeCompare(b.expiryDate);
    });
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity, remaining);
      b.quantity -= take;
      remaining -= take;
    }
    const recomputed = recomputeProductFromBatches({ ...p, batches } as Product);
    DB.update<Product>('products', pId, {
      ...recomputed,
      salesCount: (p.salesCount || 0) + qty,
      lastSold: new Date().toISOString(),
    } as Partial<Product>);
    const sale = DB.insert('sales', {
      businessId: bizId, productId: pId, productName: p.name,
      qty, salePrice: price, costPrice: p.costPrice,
      profit: (price - p.costPrice) * qty
    });
    return { sale };
  },
  bulk: (bizId: string, items: Partial<Product>[]) => {
    let added = 0;
    const errors: string[] = [];
    items.forEach((p, i) => {
      const existing = p.barcode
        ? DB.findOne<Product>('products', x => x.barcode === p.barcode && x.businessId === bizId)
        : null;

      if (existing) {
        const qty = Number(p.quantity) || 0;
        const exp = normalizeExpiryDate(p.expiryDate);
        if (qty <= 0) {
          errors.push(`Row ${i + 1}: Barcode "${p.barcode}" exists but quantity is invalid`);
          return;
        }

        const baseBatches = getProductBatches(existing);
        const matchedBatch = baseBatches.find(batch => sameCalendarDay(batch.expiryDate, exp));
        if (matchedBatch) {
          const mergedBatches = baseBatches.map(batch =>
            batch.id === matchedBatch.id ? { ...batch, quantity: batch.quantity + qty } : batch,
          );
          const recomputed = recomputeProductFromBatches({ ...existing, batches: mergedBatches } as Product);
          DB.update<Product>('products', existing.id, recomputed);
        } else {
          Inv.addBatch(existing.id, qty, exp);
        }

        added++;
        return;
      }
      const qty = Number(p.quantity) || 0;
      const exp = normalizeExpiryDate(p.expiryDate);
      const sanitized = sanitizeProductInput({
        ...p, businessId: bizId, salesCount: 0, lastSold: null,
        batches: qty > 0 ? [makeBatch(qty, exp)] : [],
      });
      DB.insert('products', sanitized);
      added++;
    });
    return { added, errors };
  },
  updateProduct: (id: string, updates: Partial<Product>) => {
    return DB.update<Product>('products', id, sanitizeProductInput(updates));
  },
  // Add a new batch (restock) WITHOUT overwriting existing batch expiry dates
  addBatch: (id: string, qty: number, expiryDate: string) => {
    const p = DB.findOne<Product>('products', x => x.id === id);
    if (!p) return { error: 'Product not found.' };
    const batches = [...getProductBatches(p), makeBatch(qty, expiryDate)];
    const recomputed = recomputeProductFromBatches({ ...p, batches } as Product);
    // Track reorder event for same-day overstock detection
    ReorderTracker.record(p.businessId, id);
    return DB.update<Product>('products', id, recomputed);
  },
  deleteProduct: (id: string) => {
    DB.del<Product>('products', id);
  },
  removeExpired: (bizId: string, productId: string) => {
    DB.del<Product>('products', productId);
  },
  // Remove a single expired batch from a product (keeping other batches)
  removeBatch: (productId: string, batchId: string) => {
    const p = DB.findOne<Product>('products', x => x.id === productId);
    if (!p) return { error: 'Product not found.' };
    const batches = (p.batches || []).filter(b => b.id !== batchId);
    if (batches.length === 0) {
      DB.del<Product>('products', productId);
      return { removed: 'product' as const };
    }
    const recomputed = recomputeProductFromBatches({ ...p, batches } as Product);
    DB.update<Product>('products', productId, recomputed);
    return { removed: 'batch' as const };
  }
};

// Action History
export const ActionHistory = {
  log: (bizId: string, productId: string, productName: string, actionType: ActionLog['actionType'], description: string, details?: string) => {
    DB.insert('action_logs', { businessId: bizId, productId, productName, actionType, description, details: details || '' });
  },
  get: (bizId: string): ActionLog[] => {
    return DB.findMany<ActionLog>('action_logs', a => a.businessId === bizId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
};

// === REORDER TRACKER ===
// Tracks how many times a product was reordered today (per business).
// Used to detect over-eager reordering when no sales have happened.
const REORDER_KEY = 'srsis_reorder_tracker';
type ReorderMap = Record<string, Record<string, { date: string; count: number }>>;

export const ReorderTracker = {
  read(): ReorderMap {
    try { return JSON.parse(localStorage.getItem(REORDER_KEY) || '{}'); }
    catch { return {}; }
  },
  write(data: ReorderMap) {
    try { localStorage.setItem(REORDER_KEY, JSON.stringify(data)); } catch { /* noop */ }
  },
  todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  },
  record(bizId: string, productId: string) {
    const data = this.read();
    const today = this.todayKey();
    data[bizId] = data[bizId] || {};
    const entry = data[bizId][productId];
    if (entry && entry.date === today) {
      entry.count += 1;
    } else {
      data[bizId][productId] = { date: today, count: 1 };
    }
    this.write(data);
  },
  // How many times product was reordered today
  todayCount(bizId: string, productId: string): number {
    const data = this.read();
    const today = this.todayKey();
    const entry = data[bizId]?.[productId];
    if (!entry || entry.date !== today) return 0;
    return entry.count;
  },
  clear(bizId: string) {
    const data = this.read();
    delete data[bizId];
    this.write(data);
  }
};

// === ORGANIZATION SERVICE ===
// Owner-only updates and full delete (org + products + sales + logs).
export const OrgSvc = {
  update: (orgId: string, userId: string, updates: Partial<Organization>) => {
    const org = DB.findOne<Organization>('businesses', o => o.id === orgId);
    if (!org) return { error: 'Organization not found.' };
    if (org.ownerId !== userId) return { error: 'Only the owner can update this organization.' };
    // Whitelist editable fields — never let UI overwrite ownerId/mode/createdAt/id
    const safe: Partial<Organization> = {};
    if (updates.name !== undefined) safe.name = String(updates.name).trim();
    if (updates.type !== undefined) safe.type = updates.type;
    if (updates.address !== undefined) safe.address = updates.address;
    if (updates.phone !== undefined) safe.phone = updates.phone;
    if (updates.gstin !== undefined) safe.gstin = updates.gstin;
    if (updates.currency !== undefined) safe.currency = updates.currency;
    if (updates.warehouse !== undefined) safe.warehouse = updates.warehouse;
    if (updates.shared !== undefined) safe.shared = updates.shared;
    if (updates.secretKey !== undefined) safe.secretKey = updates.secretKey;
    if (!safe.name) delete safe.name; // don't blank name
    const updated = DB.update<Organization>('businesses', orgId, safe);
    return { org: updated };
  },
  changePassword: (userId: string, oldPassword: string, newPassword: string) => {
    const u = DB.findOne<{ id: string; password: string }>('users', x => x.id === userId);
    if (!u) return { error: 'User not found.' };
    if (u.password !== oldPassword) return { error: 'Current password is incorrect.' };
    if (!newPassword || newPassword.length < 6) return { error: 'New password must be at least 6 characters.' };
    DB.update('users', userId, { password: newPassword });
    return { ok: true };
  },
  changeSecretKey: (orgId: string, userId: string, password: string, newKey: string) => {
    const u = DB.findOne<{ id: string; password: string }>('users', x => x.id === userId);
    if (!u || u.password !== password) return { error: 'Password is incorrect.' };
    const org = DB.findOne<Organization>('businesses', o => o.id === orgId);
    if (!org) return { error: 'Organization not found.' };
    if (org.ownerId !== userId) return { error: 'Only the owner can change the secret key.' };
    DB.update('businesses', orgId, { secretKey: newKey, shared: Boolean(newKey) });
    return { ok: true };
  },
  // Full destructive delete — org + its products + sales + action logs.
  // Does NOT touch other organizations of the same user.
  delete: (orgId: string, userId: string, password: string) => {
    const u = DB.findOne<{ id: string; password: string }>('users', x => x.id === userId);
    if (!u || u.password !== password) return { error: 'Password is incorrect.' };
    const org = DB.findOne<Organization>('businesses', o => o.id === orgId);
    if (!org) return { error: 'Organization not found.' };
    if (org.ownerId !== userId) return { error: 'Only the owner can delete this organization.' };

    // Cascade: products, sales, action_logs scoped to this org only
    const products = DB.findMany<Product>('products', p => p.businessId === orgId);
    products.forEach(p => DB.del<Product>('products', p.id));
    const sales = DB.findMany<Sale>('sales', s => s.businessId === orgId);
    sales.forEach(s => DB.del<Sale>('sales', s.id));
    const logs = DB.findMany<ActionLog>('action_logs', a => a.businessId === orgId);
    logs.forEach(l => DB.del<ActionLog>('action_logs', l.id));
    DB.del<Organization>('businesses', orgId);
    ReorderTracker.clear(orgId);
    return { ok: true };
  }
};

// Helper: sales speed
export function getSalesSpeed(p: Product): number {
  if (!p.salesCount || p.salesCount === 0) return 0;
  const daysSinceCreated = Math.max(1, Math.ceil((Date.now() - new Date(p.createdAt).getTime()) / 86400000));
  return p.salesCount / daysSinceCreated;
}

export function getDaysUntilStockout(p: Product): number {
  const speed = getSalesSpeed(p);
  if (speed === 0) return Infinity;
  return Math.ceil(p.quantity / speed);
}

// Calculate a sensible reorder quantity based on sales speed and reorder point
// Reorder = avg daily sales × cover days (default 30)
function sensibleReorderQty(p: Product, coverDays = 30): number {
  const speed = getSalesSpeed(p);
  if (speed > 0) {
    const qty = Math.ceil(speed * coverDays);
    return Math.max(p.reorderPoint || 10, Math.min(qty, Math.max(200, (p.reorderPoint || 10) * 5)));
  }
  // No sales data: use reorder point * 2 or a reasonable default
  const rp = p.reorderPoint || 10;
  return Math.min(rp * 3, 200);
}

// === CATEGORY CLASSIFIER ===
// Maps any free-text category/name to a behavior bucket so reasoning can adapt.
export type CategoryClass = 'food' | 'pharmacy' | 'cosmetics' | 'beverages' | 'clothing' | 'electronics' | 'generic';

export function classifyCategory(p: Pick<Product, 'category' | 'name'>): CategoryClass {
  const c = (p.category || '').toLowerCase();
  const n = (p.name || '').toLowerCase();
  const has = (k: string) => c.includes(k) || n.includes(k);
  if (['medicine', 'pharma', 'health', 'supplement', 'tablet', 'syrup', 'drug'].some(has)) return 'pharmacy';
  if (['food', 'dairy', 'bakery', 'snack', 'grocery', 'grain', 'cereal', 'oil', 'spice', 'instant food', 'breakfast'].some(has)) return 'food';
  if (['cosmetic', 'beauty', 'skincare', 'personal care'].some(has)) return 'cosmetics';
  if (['beverage', 'drink', 'juice', 'water', 'soda', 'cola', 'tea', 'coffee'].some(has)) return 'beverages';
  if (['clothing', 'apparel', 'wear', 'shirt', 'jeans', 'jacket', 'sweater', 'dress'].some(has)) return 'clothing';
  if (['electronic', 'gadget', 'appliance', 'ac', 'cooler', 'fan', 'heater', 'tv', 'mobile', 'laptop'].some(has)) return 'electronics';
  return 'generic';
}

// === SEASONAL INTELLIGENCE ===
export type Season = 'summer' | 'monsoon' | 'autumn' | 'winter' | 'spring';

export function getCurrentSeason(d = new Date()): Season {
  const m = d.getMonth(); // 0-11
  if (m >= 2 && m <= 4) return 'summer';        // Mar-May
  if (m >= 5 && m <= 7) return 'monsoon';       // Jun-Aug
  if (m === 8 || m === 9) return 'autumn';      // Sep-Oct
  if (m === 10 || m === 11 || m === 0) return 'winter'; // Nov-Jan
  return 'spring';                              // Feb
}

// Returns 'high' | 'low' | 'neutral' demand context for an item in current season.
function getSeasonalDemand(p: Product, season: Season): 'high' | 'low' | 'neutral' {
  const cls = classifyCategory(p);
  // Seasonal logic only applies to clothing, electronics, beverages
  if (!['clothing', 'electronics', 'beverages'].includes(cls)) return 'neutral';
  const n = (p.name + ' ' + p.category).toLowerCase();
  const summerHot = ['cooler', 'fan', 'ac', 'air conditioner', 'ice', 'cold', 'juice', 'water', 'lemon', 'lassi', 'buttermilk', 'sunscreen', 'umbrella', 't-shirt', 'shorts', 'cotton'];
  const winterHot = ['heater', 'blanket', 'sweater', 'jacket', 'warm', 'hot chocolate', 'soup', 'tea', 'coffee', 'wool', 'thermal'];
  if (season === 'summer') {
    if (summerHot.some(k => n.includes(k))) return 'high';
    if (winterHot.some(k => n.includes(k))) return 'low';
  }
  if (season === 'winter') {
    if (winterHot.some(k => n.includes(k))) return 'high';
    if (summerHot.some(k => n.includes(k))) return 'low';
  }
  if (season === 'monsoon' && ['umbrella', 'raincoat'].some(k => n.includes(k))) return 'high';
  return 'neutral';
}

// Short, plain-language seasonal phrase for use inside reasoning.
function seasonalReasonPhrase(p: Product, season: Season): string {
  const demand = getSeasonalDemand(p, season);
  if (demand === 'high') return `This item is in high demand during ${season}.`;
  if (demand === 'low') return `This item is in low demand during ${season}.`;
  return '';
}

// === STRUCTURED ALERT BUILDER ===
// Builds a multi-line "reason" block following the spec:
//   💡 Problem — what's happening
//   📌 Why — reason (category/season aware)
//   💸 Impact — what you may lose
function buildReason(parts: { problem?: string; why?: string; impact?: string }): string {
  const lines: string[] = [];
  if (parts.problem) lines.push(`💡 ${parts.problem}`);
  if (parts.why) lines.push(`📌 ${parts.why}`);
  if (parts.impact) lines.push(`💸 ${parts.impact}`);
  return lines.join('\n');
}

// Builds the "action" block:
//   👉 Action — what to do
//   ✅ Benefit — what you can recover/earn
function buildAction(action: string, benefit?: string): string {
  return benefit ? `👉 ${action}\n✅ ${benefit}` : `👉 ${action}`;
}

// Alerts - categorized. Mode-aware: 'small' = basic, 'medium' = smart with reasoning + ₹ risk,
// 'large' = advanced with predictions + financial impact.
export const AlertSvc = {
  generate: (products: Product[], mode: BusinessMode = 'large'): Alert[] => {
    const alerts: Alert[] = [];
    const today = new Date();
    const isSmall = mode === 'small';
    const isMedium = mode === 'medium';
    const isLarge = mode === 'large';
    const season = getCurrentSeason(today);

    products.forEach(p => {
      // Skip expiry tracking entirely if user marked item as non-expiry
      const expiryEnabled = p.hasExpiry !== false;
      const batches = expiryEnabled
        ? ((p.batches && p.batches.length > 0)
            ? p.batches
            : (p.expiryDate ? [{ id: 'legacy', quantity: p.quantity, expiryDate: p.expiryDate, addedAt: p.createdAt }] : []))
        : [];

      batches.forEach(batch => {
        if (!batch.expiryDate || batch.quantity <= 0) return;
        const d = getDaysUntilExpiry(batch.expiryDate, today);
        if (d === null) return;

        // EXPIRED batch — terminology: "Loss incurred"
        if (d <= 0) {
          const lossAmount = p.costPrice * batch.quantity;

          if (isSmall) {
            alerts.push({
              type: 'EXPIRED', severity: 'danger', productId: p.id, productName: p.name,
              category: 'expired',
              message: `${p.name} — ${batch.quantity} units expired.`,
              reason: `Expired — remove items.`,
              action: '👉 Remove now',
              actionType: 'remove',
              batchId: batch.id,
              batchQty: batch.quantity,
            });
            return;
          }

          // Medium / Large — category-aware reasoning + structured format
          const cls = classifyCategory(p);
          let why = 'Past expiry date — unsafe to sell and blocks shelf space.';
          if (cls === 'pharmacy') {
            why = 'Illegal to sell expired medicine. May lead to penalties and loss of customer trust.';
          } else if (cls === 'food' || cls === 'beverages') {
            why = 'Health risk — may cause food poisoning and damage your shop reputation.';
          } else if (cls === 'cosmetics') {
            why = 'May cause skin reactions. Selling expired beauty products hurts customer trust.';
          } else if (cls === 'electronics') {
            why = 'Risk of leakage or malfunction. Selling can lead to returns and bad reviews.';
          }
          alerts.push({
            type: 'EXPIRED', severity: 'danger', productId: p.id, productName: p.name,
            category: 'expired',
            message: `${p.name} — ${batch.quantity} units, expired ${Math.abs(d)} day(s) ago.`,
            reason: buildReason({
              problem: `${batch.quantity} unit(s) already expired.`,
              why,
              impact: `Loss incurred: ${formatCurrency(lossAmount)} (cost of unsold stock).`,
            }),
            action: buildAction(
              'Remove these units immediately and update records.',
              'Protects other stock, frees shelf space, and avoids penalties.'
            ),
            potentialLoss: lossAmount > 0 ? lossAmount : undefined,
            actionType: 'remove',
            batchId: batch.id,
            batchQty: batch.quantity,
          });
        }
        // EXPIRING SOON — 10-day window
        else if (d <= 10) {
          const speed = getSalesSpeed(p);
          const unitsAtRisk = getAtRiskUnits(batch.quantity, d, speed);
          const risk = getRiskLevel(unitsAtRisk, batch.quantity, d);

          if (risk === 'none') return;

          // SMALL MODE — minimal info
          if (isSmall) {
            alerts.push({
              type: 'EXPIRING_SOON', severity: 'warning', productId: p.id, productName: p.name,
              category: 'expiring',
              message: `${p.name} — ${batch.quantity} unit(s), ${d} day(s) left.`,
              reason: `Expiring soon — sell quickly.`,
              action: '👉 Move stock to front / promote',
              daysLeft: d,
              batchId: batch.id,
              batchQty: batch.quantity,
            });
            return;
          }

          const lossAmount = p.costPrice * unitsAtRisk;
          const expectedRevenue = p.sellingPrice * batch.quantity;
          const discount = getSmartDiscountPercent(p, batch.quantity, d, speed, risk);
          const cls = classifyCategory(p);

          // Category-aware "why" phrasing — pharmacy/food = urgency, others = time-based
          const urgencyWhy = cls === 'pharmacy'
            ? `Medicine nearing expiry — needs urgent action before it becomes illegal to sell.`
            : (cls === 'food' || cls === 'beverages')
              ? `Item is nearing expiry — once expired, it cannot be sold and becomes a full loss.`
              : cls === 'cosmetics'
                ? `Beauty product nearing expiry — quality drops and customers avoid old stock.`
                : `Item nearing expiry — value drops sharply once the date passes.`;

          let priorityColor: 'red' | 'orange' | 'yellow' = 'yellow';
          if (risk === 'high') priorityColor = 'red';
          else if (risk === 'medium') priorityColor = 'orange';

          // LOW RISK — likely to sell in time, no discount needed
          if (risk === 'low' || discount === 0) {
            alerts.push({
              type: 'EXPIRING_SOON', severity: 'info', productId: p.id, productName: p.name,
              category: 'expiring',
              message: `${p.name} — ${batch.quantity} unit(s), ${d} day(s) left.`,
              reason: buildReason({
                problem: `${batch.quantity} unit(s) expire in ${d} day(s).`,
                why: `Selling at current pace (~${speed.toFixed(1)}/day) should clear the batch in time.`,
                impact: `Small risk: ${formatCurrency(lossAmount)} if pace slows.`,
              }),
              action: buildAction(
                'Continue normal selling. Place stock at the front for visibility.',
                `Earn the full expected revenue of ${formatCurrency(expectedRevenue)}.`
              ),
              priorityColor,
              daysLeft: d,
              batchId: batch.id,
              batchQty: batch.quantity,
            });
            return;
          }

          // MEDIUM / HIGH RISK
          const discountedPrice = Math.round(p.sellingPrice * (1 - discount / 100));
          const recoverable = Math.max(0, discountedPrice * batch.quantity);
          const neededPerDay = Math.ceil(batch.quantity / Math.max(1, d));
          const paceLine = speed > 0
            ? `Selling ~${speed.toFixed(1)}/day but need ~${neededPerDay}/day to clear before expiry.`
            : `No recent sales — need ~${neededPerDay}/day to clear before expiry.`;

          // Reason — structured: problem / why (urgency + pace) / impact
          const reasonText = buildReason({
            problem: `${unitsAtRisk} of ${batch.quantity} unit(s) likely to expire unsold (${d} day(s) left).`,
            why: `${urgencyWhy} ${paceLine}`,
            impact: `If no action: you may lose ${formatCurrency(lossAmount)} of ${formatCurrency(expectedRevenue)} expected revenue.`,
          });

          // Action + Benefit — loss vs recovery framing
          const actionText = (isMedium && risk !== 'high')
            ? buildAction(
                `Try a promotion first. If sales stay slow, apply ${discount}% discount.`,
                `If discounted, you can still recover around ${formatCurrency(recoverable)} instead of losing ${formatCurrency(lossAmount)}.`
              )
            : buildAction(
                `Apply ${discount}% discount now for optimal recovery.`,
                `You may not achieve full revenue (${formatCurrency(expectedRevenue)}), but you can still recover around ${formatCurrency(recoverable)}.`
              );

          alerts.push({
            type: 'EXPIRING_SOON', severity: risk === 'high' ? 'danger' : 'warning', productId: p.id, productName: p.name,
            category: 'expiring',
            message: `${p.name} — ${batch.quantity} units, ${d} day(s) left.`,
            reason: reasonText,
            action: actionText,
            potentialLoss: lossAmount > 0 ? lossAmount : undefined,
            actionType: 'discount',
            priorityColor,
            daysLeft: d,
            discountPercent: discount,
            batchId: batch.id,
            batchQty: batch.quantity,
          });
        }
      });

      // === OUT OF STOCK — terminology: "missing profit" ===
      if (p.quantity === 0) {
        const speed = getSalesSpeed(p);
        const missingProfitPerDay = speed * Math.max(0, p.sellingPrice - p.costPrice);
        const reorderQty = sensibleReorderQty(p);
        const seasonPhrase = seasonalReasonPhrase(p, season);

        if (isSmall) {
          alerts.push({
            type: 'OUT_OF_STOCK', severity: 'danger', productId: p.id, productName: p.name,
            category: 'outofstock',
            message: `${p.name} is out of stock.`,
            reason: `Out of stock — restock soon.`,
            action: '👉 Reorder now',
            actionType: 'reorder'
          });
        } else {
          const why = speed > 0
            ? `Was selling ~${speed.toFixed(1)} units/day. ${seasonPhrase} Customers may switch to a competitor while you're out.`.trim()
            : `Item is unavailable. ${seasonPhrase} Customers may switch to a competitor.`.trim();
          const impact = speed > 0
            ? `Missing profit: ~${formatCurrency(missingProfitPerDay)}/day until you restock.`
            : `Potential profit missed every day this stays out of stock.`;
          alerts.push({
            type: 'OUT_OF_STOCK', severity: 'danger', productId: p.id, productName: p.name,
            category: 'outofstock',
            message: `${p.name} is out of stock.`,
            reason: buildReason({
              problem: `0 units left.`,
              why,
              impact,
            }),
            action: buildAction(
              speed > 0
                ? `Reorder ${reorderQty} units now (~${speed.toFixed(1)}/day × 30 days cover).`
                : `Reorder based on expected demand (~${reorderQty} units).`,
              speed > 0
                ? `Restocking earns back ~${formatCurrency(missingProfitPerDay)}/day in profit.`
                : `Avoid losing customers to competitors.`
            ),
            actionType: 'reorder'
          });
        }
      }
      // LOW STOCK
      else if (p.quantity <= p.reorderPoint) {
        const speed = getSalesSpeed(p);
        const daysLeft = speed > 0 ? Math.ceil(p.quantity / speed) : 999;
        const reorderQty = sensibleReorderQty(p);
        const seasonPhrase = seasonalReasonPhrase(p, season);

        if (isSmall) {
          alerts.push({
            type: 'LOW_STOCK', severity: 'warning', productId: p.id, productName: p.name,
            category: 'lowstock',
            message: `${p.name} — only ${p.quantity} units left.`,
            reason: `Low stock — reorder soon.`,
            action: '👉 Reorder',
            actionType: 'reorder',
            daysLeft
          });
        } else {
          const why = speed > 0
            ? `Selling ~${speed.toFixed(1)}/day. ${seasonPhrase} Stock will run out in ~${daysLeft} day(s).`.trim()
            : `Stock is below your reorder point. ${seasonPhrase}`.trim();
          alerts.push({
            type: 'LOW_STOCK', severity: 'warning', productId: p.id, productName: p.name,
            category: 'lowstock',
            message: `${p.name} — only ${p.quantity} units left (reorder point: ${p.reorderPoint}).`,
            reason: buildReason({
              problem: `Only ${p.quantity} unit(s) left.`,
              why,
              impact: `If stock runs out, you may miss daily sales until you restock.`,
            }),
            action: buildAction(
              speed > 0
                ? `Reorder ${reorderQty} units (~${speed.toFixed(1)}/day × 30 days cover).`
                : `Reorder ~${reorderQty} units based on expected demand.`,
              `Keeps sales flowing and avoids running out.`
            ),
            actionType: 'reorder',
            daysLeft
          });
        }
      }

      // === MEDIUM/LARGE-ONLY ALERTS — overstock, dead stock, slow moving, seasonal ===
      if (isSmall) return;

      // === OVERSTOCK ===
      // Smart trigger: needs (a) significant time passed since item was added,
      // (b) low sales activity, AND (c) stock well above reorder point.
      const ageDays = Math.ceil((today.getTime() - new Date(p.createdAt).getTime()) / 86400000);
      const overstockSpeed = getSalesSpeed(p);
      if (
        ageDays >= 7 &&
        p.quantity > (p.reorderPoint || 10) * 5 &&
        p.salesCount < p.quantity * 0.1 &&
        overstockSpeed < 1
      ) {
        const capitalBlocked = p.costPrice * p.quantity;
        const daysToSell = overstockSpeed > 0 ? Math.ceil(p.quantity / overstockSpeed) : Infinity;
        const seasonPhrase = seasonalReasonPhrase(p, season);
        const whyParts = [
          `Items are not selling and stock is high (${ageDays} day(s) old, only ${p.salesCount} unit(s) sold).`,
        ];
        if (seasonPhrase) whyParts.push(seasonPhrase);
        if (overstockSpeed > 0) whyParts.push(`At current pace it will take ~${daysToSell} day(s) to clear.`);

        alerts.push({
          type: 'OVERSTOCK', severity: 'info', productId: p.id, productName: p.name,
          category: 'overstock',
          message: `${p.name}: ${p.quantity} units in stock (${Math.round(p.quantity / (p.reorderPoint || 10))}× your reorder point).`,
          reason: buildReason({
            problem: `${p.quantity} unit(s) in stock — well above what's needed.`,
            why: whyParts.join(' '),
            impact: `Money used to buy these items (${formatCurrency(capitalBlocked)}) is not yet returned by sales.`,
          }),
          action: buildAction(
            isLarge
              ? `Don't reorder. Apply 10–15% discount or bundle deals to move stock.`
              : `Don't reorder. Try a promotion or small discount.`,
            `Free up ${formatCurrency(capitalBlocked)} for items that actually sell.`
          ),
          actionType: 'discount',
          potentialLoss: capitalBlocked
        });
      }

      // === DEAD STOCK (>45 days no sale) ===
      if (p.lastSold) {
        const daysSinceLastSale = Math.ceil((today.getTime() - new Date(p.lastSold).getTime()) / 86400000);
        if (daysSinceLastSale > 45 && p.quantity > 0) {
          const blocked = p.costPrice * p.quantity;
          const recoverable = Math.round(p.sellingPrice * 0.75) * p.quantity;
          alerts.push({
            type: 'DEAD_STOCK', severity: 'danger', productId: p.id, productName: p.name,
            category: 'deadstock',
            message: `${p.name}: No sale in ${daysSinceLastSale} days. ${p.quantity} units idle.`,
            reason: buildReason({
              problem: `No sale in ${daysSinceLastSale} days.`,
              why: `Item has stopped moving. Money used to buy it is not coming back through sales.`,
              impact: `Blocked money: ${formatCurrency(blocked)}. Risk grows the longer it sits.`,
            }),
            action: buildAction(
              `Apply 20–30% discount or bundle with a fast-selling item.`,
              `If discounted, you can recover around ${formatCurrency(recoverable)} instead of losing ${formatCurrency(blocked)}.`
            ),
            actionType: 'discount',
            potentialLoss: blocked
          });
        }
        else if (daysSinceLastSale >= 15 && daysSinceLastSale <= 45 && p.quantity > 0) {
          const blocked = p.costPrice * p.quantity;
          alerts.push({
            type: 'SLOW_MOVING', severity: 'warning', productId: p.id, productName: p.name,
            category: 'salesspeed',
            message: `${p.name}: No sale in ${daysSinceLastSale} days.`,
            reason: buildReason({
              problem: `No sale in ${daysSinceLastSale} days — sales are slowing.`,
              why: seasonalReasonPhrase(p, season) || `Demand for this item has dropped recently.`,
              impact: `${formatCurrency(blocked)} of money is at risk of getting stuck.`,
            }),
            action: buildAction(
              `Promote with a 10–15% discount or bundle offer.`,
              `Restart sales before it becomes dead stock.`
            ),
            actionType: 'discount',
            potentialLoss: blocked
          });
        }
      }

      // === HIGH INVESTMENT RISK — only for non-expiry items (medium/large) ===
      // Triggered when an expensive item sits unsold for too long, tying up significant capital.
      if (!expiryEnabled && p.quantity > 0) {
        const capitalBlocked = p.costPrice * p.quantity;
        const speed = getSalesSpeed(p);
        const daysSinceCreated = Math.ceil((today.getTime() - new Date(p.createdAt).getTime()) / 86400000);
        // "Expensive" = cost per unit >= 500 (currency-agnostic threshold) OR total blocked capital >= 25,000
        const isExpensive = p.costPrice >= 500 || capitalBlocked >= 25000;
        const isUnsold = (p.salesCount || 0) === 0 && daysSinceCreated >= 21;
        const isSlowAndCostly = speed > 0 && speed < 0.2 && capitalBlocked >= 10000;
        if (isExpensive && (isUnsold || isSlowAndCostly)) {
          const recoverable = Math.round(p.sellingPrice * 0.85) * p.quantity;
          alerts.push({
            type: 'HIGH_INVESTMENT_RISK', severity: 'warning', productId: p.id, productName: p.name,
            category: 'highrisk',
            message: `${p.name}: ${formatCurrency(capitalBlocked)} tied up in ${p.quantity} unsold unit(s).`,
            reason: buildReason({
              problem: isUnsold
                ? `No sales in ${daysSinceCreated} day(s) for a high-value item.`
                : `Selling ~${speed.toFixed(2)}/day — too slow for a high-value item.`,
              why: `Expensive items tie up a lot of money. ${seasonalReasonPhrase(p, season)}`.trim(),
              impact: `Money used to buy this stock (${formatCurrency(capitalBlocked)}) is not coming back.`,
            }),
            action: buildAction(
              isLarge
                ? `Reduce reorder qty, run a targeted promotion, or apply a 10–15% discount.`
                : `Avoid restocking. Promote or apply a small discount.`,
              `Recover around ${formatCurrency(recoverable)} and free up money for faster-selling items.`
            ),
            actionType: 'discount',
            potentialLoss: capitalBlocked
          });
        }
      }

      // === SEASONAL — only for relevant categories (Electronics, Clothing, Beverages) ===
      const seasonalDemand = getSeasonalDemand(p, season);
      if (seasonalDemand === 'high' && p.quantity <= p.reorderPoint * 2) {
        const reorderQty = sensibleReorderQty(p) * 2;
        alerts.push({
          type: 'SEASONAL_DEMAND', severity: 'warning', productId: p.id, productName: p.name,
          category: 'seasonal',
          message: `${season.charAt(0).toUpperCase() + season.slice(1)} demand: ${p.name} only ${p.quantity} units left.`,
          reason: buildReason({
            problem: `Only ${p.quantity} unit(s) left of a seasonal hot-seller.`,
            why: `This item is in high demand during ${season}. Demand is rising due to weather and usage patterns.`,
            impact: `Running out now means missing peak-season sales.`,
          }),
          action: buildAction(
            `Stock up! Reorder at least ${reorderQty} units to cover peak demand.`,
            `Captures peak-season profit while demand is high.`
          ),
          actionType: 'reorder'
        });
      } else if (seasonalDemand === 'low' && p.quantity > p.reorderPoint * 3) {
        const blocked = p.costPrice * p.quantity;
        const recoverable = Math.round(p.sellingPrice * 0.8) * p.quantity;
        alerts.push({
          type: 'SEASONAL_DEMAND', severity: 'info', productId: p.id, productName: p.name,
          category: 'seasonal',
          message: `Off-season: ${p.name} has ${p.quantity} units while demand is low.`,
          reason: buildReason({
            problem: `${p.quantity} unit(s) of an off-season item in stock.`,
            why: `This item is in low demand during ${season}. Sales typically slow until the season returns.`,
            impact: `Money used to buy this stock (${formatCurrency(blocked)}) may stay tied up for months.`,
          }),
          action: buildAction(
            `Apply 15–20% off-season discount or bundle with seasonal items.`,
            `Recover around ${formatCurrency(recoverable)} now instead of waiting months.`
          ),
          actionType: 'discount',
          potentialLoss: blocked
        });
      }
    });

    const sevOrder: Record<string, number> = { danger: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => {
      const sa = sevOrder[a.severity] ?? 3;
      const sb = sevOrder[b.severity] ?? 3;
      if (sa !== sb) return sa - sb;
      const da = a.daysLeft ?? 999;
      const db = b.daysLeft ?? 999;
      return da - db;
    });
    return alerts;
  },

  // Suggestions - distinct from alerts, overall actionable advice. Mode-aware.
  suggestions: (products: Product[], mode: BusinessMode = 'large'): Suggestion[] => {
    const s: Suggestion[] = [];
    const today = new Date();
    const isSmall = mode === 'small';

    // SMALL MODE — only basic, plain-language overall suggestions
    if (isSmall) {
      const expired = products.filter(p => {
        if (p.hasExpiry === false) return false;
        const d = getDaysUntilExpiry(p.expiryDate, today);
        return d !== null && d <= 0;
      });
      const lowStock = products.filter(p => p.quantity > 0 && p.quantity <= p.reorderPoint);
      const outOfStock = products.filter(p => p.quantity === 0);

      if (expired.length > 0) {
        s.push({
          type: 'OVERALL_EXPIRED', productId: '', productName: 'Overall',
          suggestion: `${expired.length} item(s) have expired. Remove them to keep your shop safe.`,
          priority: 'high'
        });
      }
      if (outOfStock.length > 0) {
        s.push({
          type: 'URGENT_RESTOCK', productId: '', productName: 'Overall',
          suggestion: `${outOfStock.length} item(s) are out of stock. Reorder soon.`,
          priority: 'high'
        });
      }
      if (lowStock.length > 0) {
        s.push({
          type: 'OVERALL_LOWSTOCK', productId: '', productName: 'Overall',
          suggestion: `${lowStock.length} item(s) are running low. Reorder soon.`,
          priority: 'medium'
        });
      }
      return s;
    }

    // Overall inventory health suggestions
    const totalValue = products.reduce((sum, p) => sum + p.costPrice * p.quantity, 0);
    const outOfStock = products.filter(p => p.quantity === 0);
    const overstocked = products.filter(p => p.quantity > (p.reorderPoint || 10) * 5);
    const expiringItems = products.filter(p => {
      if (p.hasExpiry === false) return false;
      const d = getDaysUntilExpiry(p.expiryDate, today);
      if (d === null) return false;
      return d > 0 && d <= 10;
    });
    const slowMovers = products.filter(p => p.lastSold && Math.ceil((today.getTime() - new Date(p.lastSold).getTime()) / 86400000) >= 15 && p.quantity > 0);
    const fastMovers = products.filter(p => getSalesSpeed(p) > 0).sort((a, b) => getSalesSpeed(b) - getSalesSpeed(a));

    // Fast movers running low - reorder suggestion (formula: avg daily sales × 30)
    fastMovers.forEach(p => {
      const speed = getSalesSpeed(p);
      const daysLeft = getDaysUntilStockout(p);
      if (daysLeft < 14 && p.quantity > 0) {
        const qty = Math.max(sensibleReorderQty(p), Math.ceil(speed * 30));
        s.push({
          type: 'REORDER_FAST_SELLER',
          productId: p.id, productName: p.name,
          suggestion: `${p.name} sells at ~${speed.toFixed(1)} units/day and will run out in ~${daysLeft} day(s). 👉 Reorder ${qty} units (~${speed.toFixed(1)}/day × 30 days cover). ✅ Keeps sales flowing for the next month.`,
          priority: daysLeft < 7 ? 'high' : 'medium'
        });
      }
    });

    // Expiring items - discount + bundle strategy with loss-vs-recovery framing
    expiringItems.forEach(p => {
      const d = getDaysUntilExpiry(p.expiryDate, today);
      if (d === null) return;
      const discount = d <= 3 ? 40 : d <= 7 ? 30 : d <= 14 ? 20 : 15;
      const discountedPrice = p.sellingPrice * (1 - discount / 100);
      const recoverable = discountedPrice * p.quantity;
      const fullLoss = p.costPrice * p.quantity;
      s.push({
        type: 'CLEAR_EXPIRING',
        productId: p.id, productName: p.name,
        suggestion: `${p.name} expires in ${d} day(s). 👉 Apply ${discount}% discount (${formatCurrency(discountedPrice)}/unit) or run a Buy 1 Get 1 deal. ✅ If discounted, you can recover around ${formatCurrency(recoverable)} instead of losing ${formatCurrency(fullLoss)}.`,
        priority: d <= 7 ? 'high' : 'medium'
      });
    });

    // Slow movers - promotion strategy
    slowMovers.forEach(p => {
      const daysSince = Math.ceil((today.getTime() - new Date(p.lastSold!).getTime()) / 86400000);
      const blocked = p.costPrice * p.quantity;
      s.push({
        type: 'PROMOTE_SLOW_ITEM',
        productId: p.id, productName: p.name,
        suggestion: `${p.name} hasn't sold in ${daysSince} days. 👉 Promote with ads, eye-level placement, or a 10–15% discount. ✅ Restart sales before ${formatCurrency(blocked)} of money used to buy this stock gets stuck.`,
        priority: daysSince > 60 ? 'high' : 'medium'
      });
    });

    // Overstock - don't reorder + clear strategy
    overstocked.forEach(p => {
      const blocked = p.costPrice * p.quantity;
      const recoverable = Math.round(p.sellingPrice * 0.85) * p.quantity;
      s.push({
        type: 'CLEAR_OVERSTOCK',
        productId: p.id, productName: p.name,
        suggestion: `${p.name} is overstocked (${p.quantity} units, ${Math.round(p.quantity / (p.reorderPoint || 10))}× reorder point). 👉 Do NOT reorder. Offer bundle deals or 10% discount. ✅ Recover around ${formatCurrency(recoverable)} of the ${formatCurrency(blocked)} tied up.`,
        priority: 'medium'
      });
    });

    // Out of stock - urgent reorder
    outOfStock.forEach(p => {
      const speed = getSalesSpeed(p);
      const qty = sensibleReorderQty(p);
      const missingProfitPerDay = speed * Math.max(0, p.sellingPrice - p.costPrice);
      s.push({
        type: 'URGENT_RESTOCK',
        productId: p.id, productName: p.name,
        suggestion: speed > 0
          ? `${p.name} is OUT OF STOCK! Was selling ${speed.toFixed(1)} units/day. 👉 Reorder ${qty} units (~${speed.toFixed(1)}/day × 30 days). ✅ Restocking earns back ~${formatCurrency(missingProfitPerDay)}/day in missed profit.`
          : `${p.name} is OUT OF STOCK! 👉 Reorder ~${qty} units based on expected demand. ✅ Avoid losing customers to competitors.`,
        priority: 'high'
      });
    });

    // Overall summary suggestions
    const expiredItems = products.filter(p => {
      if (p.hasExpiry === false) return false;
      const d = getDaysUntilExpiry(p.expiryDate, today);
      return d !== null && d <= 0;
    });
    if (expiredItems.length > 0) {
      s.unshift({
        type: 'OVERALL_EXPIRED',
        productId: '', productName: 'Overall',
        suggestion: `⚠️ You have ${expiredItems.length} expired item(s). Remove them immediately to prevent contamination and health risks. Go to Alerts → Expired to take action.`,
        priority: 'high'
      });
    }
    if (overstocked.length > 0) {
      s.unshift({
        type: 'OVERALL_OVERSTOCK',
        productId: '', productName: 'Overall',
        suggestion: `📦 ${overstocked.length} item(s) are overstocked. Apply discounts (10-15%), create bundle offers, and promote via ads to clear stock and free up capital.`,
        priority: 'medium'
      });
    }
    if (slowMovers.length > 0) {
      s.unshift({
        type: 'OVERALL_SLOW',
        productId: '', productName: 'Overall',
        suggestion: `🐌 ${slowMovers.length} item(s) are not moving. Consider promotions, shelf repositioning, or discounts. If stock is not selling, do NOT reorder — focus on clearing existing inventory.`,
        priority: 'medium'
      });
    }
    const lowStockFast = products.filter(p => p.quantity > 0 && p.quantity <= p.reorderPoint);
    if (lowStockFast.length > 0) {
      s.unshift({
        type: 'OVERALL_LOWSTOCK',
        productId: '', productName: 'Overall',
        suggestion: `📉 ${lowStockFast.length} item(s) are running low. Place reorders soon to avoid stockouts and lost sales.`,
        priority: 'high'
      });
    }

    return s;
  }
};

// Analytics
export const Analytics = {
  financials: (bizId: string) => {
    const sales = DB.findMany<Sale>('sales', s => s.businessId === bizId);
    const prods = DB.findMany<Product>('products', p => p.businessId === bizId);
    return {
      totalRevenue: sales.reduce((s, x) => s + x.salePrice * x.qty, 0),
      totalCost: sales.reduce((s, x) => s + x.costPrice * x.qty, 0),
      totalProfit: sales.reduce((s, x) => s + x.profit, 0),
      inventoryValue: prods.reduce((s, p) => s + p.costPrice * p.quantity, 0),
      potentialLoss: prods.reduce((s, p) => {
        if (p.hasExpiry === false) return s;
        const d = getDaysUntilExpiry(p.expiryDate);
        if (d !== null && d <= 10)
          return s + p.costPrice * p.quantity;
        return s;
      }, 0),
      salesCount: sales.length,
      avgOrderValue: sales.length > 0 ? sales.reduce((s, x) => s + x.salePrice * x.qty, 0) / sales.length : 0
    };
  },
  weekly: (bizId: string) => {
    const sales = DB.findMany<Sale>('sales', s => s.businessId === bizId);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const data = days.map(d => ({ day: d, revenue: 0, profit: 0 }));
    sales.forEach(s => {
      const d = new Date(s.createdAt).getDay();
      data[d].revenue += s.salePrice * s.qty;
      data[d].profit += s.profit;
    });
    return data;
  },
  categories: (bizId: string) => {
    const prods = DB.findMany<Product>('products', p => p.businessId === bizId);
    const c: Record<string, { count: number; value: number }> = {};
    prods.forEach(p => {
      if (!c[p.category]) c[p.category] = { count: 0, value: 0 };
      c[p.category].count++;
      c[p.category].value += p.costPrice * p.quantity;
    });
    return Object.entries(c).map(([name, d]) => ({ name, ...d }));
  }
};

// Alert Sound - plays uploaded WAV file
let alertAudio: HTMLAudioElement | null = null;

export function playAlertSound() {
  try {
    // Stop any currently playing alert
    if (alertAudio) {
      alertAudio.pause();
      alertAudio.currentTime = 0;
    }
    alertAudio = new Audio('/alert-sound.wav');
    alertAudio.volume = 1.0;
    alertAudio.play().catch(() => {});
  } catch { /* silent */ }
}

export function stopAlertSound() {
  if (alertAudio) {
    alertAudio.pause();
    alertAudio.currentTime = 0;
    alertAudio = null;
  }
}

// Currency formatter
export function getCurrencySymbol(currency?: string): string {
  if (!currency) return '₹';
  if (currency.includes('$')) return '$';
  if (currency.includes('€')) return '€';
  if (currency.includes('£')) return '£';
  return '₹';
}

export function formatCurrency(amount: number, currency?: string): string {
  const sym = getCurrencySymbol(currency);
  return sym + (amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function formatDisplayDate(dateStr?: string | null, includeTime = false): string {
  if (!dateStr) return '';

  const parsedExpiry = parseExpiryDate(dateStr);
  if (parsedExpiry) {
    const day = String(parsedExpiry.getUTCDate()).padStart(2, '0');
    const month = String(parsedExpiry.getUTCMonth() + 1).padStart(2, '0');
    const year = parsedExpiry.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }

  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return '';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  if (!includeTime) return `${day}/${month}/${year}`;

  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}
