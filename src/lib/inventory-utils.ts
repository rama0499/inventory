import type { Product } from './database';

const DAY_MS = 86_400_000;

const cleanCell = (value: string) => value.trim().replace(/^"(.*)"$/, '$1');

function toUtcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    return null;
  }

  return result;
}

export function parseExpiryDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;

  const value = cleanCell(dateStr);
  if (!value) return null;

  const dmy = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const day = Number.parseInt(dmy[1], 10);
    const month = Number.parseInt(dmy[2], 10);
    let year = Number.parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    return toUtcDate(year, month, day);
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return toUtcDate(
      Number.parseInt(iso[1], 10),
      Number.parseInt(iso[2], 10),
      Number.parseInt(iso[3], 10),
    );
  }

  return null;
}

export function normalizeExpiryDate(dateStr?: string | null): string {
  const parsed = parseExpiryDate(dateStr);
  if (!parsed) return '';

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatExpiryDate(dateStr?: string | null): string {
  const parsed = parseExpiryDate(dateStr);
  if (!parsed) return '';

  const day = String(parsed.getUTCDate()).padStart(2, '0');
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const year = parsed.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

export function getDaysUntilExpiry(dateStr?: string | null, baseDate = new Date()): number | null {
  const expiry = parseExpiryDate(dateStr);
  if (!expiry) return null;

  const todayUtc = Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  return Math.ceil((expiry.getTime() - todayUtc) / DAY_MS);
}

export function compareExpiryDates(a?: string | null, b?: string | null): number {
  const aDate = parseExpiryDate(a);
  const bDate = parseExpiryDate(b);

  if (!aDate && !bDate) return 0;
  if (!aDate) return 1;
  if (!bDate) return -1;
  return aDate.getTime() - bDate.getTime();
}

export function parseInventoryCsvText(text: string): Partial<Product>[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map<Partial<Product> | null>((line) => {
      const parts = line.split(',').map(cleanCell);
      if (!parts[0]) return null;

      // Supported columns (in order):
      // name,barcode,category,quantity,costPrice,sellingPrice,unit,reorderPoint,[reorderQty,]expiryDate[,hasExpiry]
      const hasReorderQty = parts.length >= 10 && /^\d+$/.test(parts[8] || '');
      const expiryIdx = hasReorderQty ? 9 : 8;
      const expiryDate = parts[expiryIdx] || '';
      const hasExpiryRaw = (parts[expiryIdx + 1] || '').toLowerCase().trim();
      const hasExpiry = hasExpiryRaw
        ? !['no', 'false', '0', 'n'].includes(hasExpiryRaw)
        : Boolean(expiryDate);

      return {
        name: parts[0],
        barcode: parts[1] || '',
        category: parts[2] || '',
        quantity: Number.parseInt(parts[3] || '0', 10) || 0,
        costPrice: Number.parseFloat(parts[4] || '0') || 0,
        sellingPrice: Number.parseFloat(parts[5] || '0') || 0,
        unit: parts[6] || 'unit',
        reorderPoint: Number.parseInt(parts[7] || '10', 10) || 10,
        reorderQty: hasReorderQty ? Number.parseInt(parts[8] || '50', 10) || 50 : 50,
        hasExpiry,
        expiryDate: hasExpiry ? normalizeExpiryDate(expiryDate) : '',
      } satisfies Partial<Product>;
    })
    .filter((item): item is Partial<Product> => item !== null);
}
