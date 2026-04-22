// localStorage database layer
const PREFIX = 'srsis_';

export interface User {
  id: string;
  fullName: string;
  username: string;
  email: string;
  password: string;
  role: 'Owner' | 'Staff';
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  type: string;
  address: string;
  phone: string;
  gstin: string;
  currency: string;
  warehouse: string;
  ownerId: string;
  mode: BusinessMode;
  shared?: boolean;
  secretKey?: string;
  setupComplete: boolean;
  createdAt: string;
}

export interface Batch {
  id: string;
  quantity: number;
  expiryDate: string; // YYYY-MM-DD or ''
  addedAt: string;
}

export interface Product {
  id: string;
  businessId: string;
  name: string;
  barcode: string;
  category: string;
  quantity: number;
  costPrice: number;
  sellingPrice: number;
  unit: string;
  reorderPoint: number;
  reorderQty: number;
  hasExpiry?: boolean; // does this item have an expiry date? defaults to true if expiryDate present
  expiryDate: string; // earliest batch expiry (for backward compat / sorting)
  batches?: Batch[];  // batch-level expiry tracking
  salesCount: number;
  lastSold: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Sale {
  id: string;
  businessId: string;
  productId: string;
  productName: string;
  qty: number;
  salePrice: number;
  costPrice: number;
  profit: number;
  createdAt: string;
}

export interface ActionLog {
  id: string;
  businessId: string;
  productId: string;
  productName: string;
  actionType: 'remove' | 'discount' | 'reorder' | 'sale' | 'add';
  description: string;
  details?: string;
  createdAt: string;
}

export interface Alert {
  type: string;
  severity: 'danger' | 'warning' | 'info';
  productId: string;
  productName: string;
  message: string;
  reason?: string;
  action: string;
  actionType?: 'reorder' | 'discount' | 'remove' | 'promote';
  potentialLoss?: number;
  category: 'expired' | 'expiring' | 'lowstock' | 'outofstock' | 'overstock' | 'salesspeed' | 'seasonal' | 'deadstock' | 'highrisk';
  priorityColor?: 'red' | 'orange' | 'yellow';
  daysLeft?: number;
  discountPercent?: number;
  batchId?: string;
  batchQty?: number;
}

export interface Suggestion {
  type: string;
  productId: string;
  productName: string;
  suggestion: string;
  priority: 'high' | 'medium' | 'low';
}

export type BusinessMode = 'small' | 'medium' | 'large';

export const CATEGORIES = [
  'Grains & Cereals', 'Dairy', 'Spices & Condiments', 'Snacks & Biscuits',
  'Beverages', 'Personal Care', 'Health & Wellness', 'Instant Food',
  'Oils & Fats', 'Breakfast', 'Cleaning', 'Electronics', 'Clothing',
  'Stationery', 'Hardware', 'Other'
];

export const UNITS = [
  'unit', 'kg', 'g', 'L', 'mL', 'pack', 'bag', 'box', 'bottle', 'jar', 'tube', 'carton', 'dozen', 'set'
];

export const BUSINESS_TYPES = [
  'Retail Store', 'Wholesale', 'Restaurant / Food', 'Pharmacy',
  'Electronics', 'Clothing & Apparel', 'Supermarket', 'Warehouse', 'Other'
];

export const CURRENCIES = ['INR (₹)', 'USD ($)', 'EUR (€)', 'GBP (£)', 'AED (د.إ)'];

const DB = {
  get: <T>(table: string): T[] => {
    try { return JSON.parse(localStorage.getItem(PREFIX + table) || '[]'); }
    catch { return []; }
  },
  set: <T>(table: string, data: T[]): boolean => {
    try { localStorage.setItem(PREFIX + table, JSON.stringify(data)); return true; }
    catch { return false; }
  },
  insert: <T extends Record<string, unknown>>(table: string, record: T): T & { id: string; createdAt: string } => {
    const rows = DB.get<T>(table);
    const nr = {
      ...record,
      id: table + '_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      createdAt: new Date().toISOString()
    } as T & { id: string; createdAt: string };
    rows.push(nr as unknown as T);
    DB.set(table, rows);
    return nr;
  },
  update: <T extends { id: string }>(table: string, id: string, updates: Partial<T>): T | null => {
    const rows = DB.get<T>(table);
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return null;
    rows[i] = { ...rows[i], ...updates, updatedAt: new Date().toISOString() } as T;
    DB.set(table, rows);
    return rows[i];
  },
  findOne: <T>(table: string, fn: (r: T) => boolean): T | null => {
    return DB.get<T>(table).find(fn) || null;
  },
  findMany: <T>(table: string, fn?: (r: T) => boolean): T[] => {
    return fn ? DB.get<T>(table).filter(fn) : DB.get<T>(table);
  },
  del: <T extends { id: string }>(table: string, id: string): void => {
    DB.set(table, DB.get<T>(table).filter(r => r.id !== id));
  }
};

export default DB;
