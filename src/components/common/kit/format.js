/**
 * Shared formatting + visual constants for the dashboard kit.
 * Single source of truth so every dashboard renders money, percentages,
 * status colors, and chart palettes identically.
 */

/** Standard chart palette — brand-led (sky blue + slate navy), then distinct hues. */
export const CHART_COLORS = [
  '#1E7DBE', '#45ADE6', '#2D3D4C', '#84D2FC',
  '#C0392B', '#81898F', '#0E9F6E', '#7C3AED',
];

/** Semantic colors for status / severity (brand kit). */
export const SEMANTIC = {
  success: '#059669',
  warning: '#D97706',
  critical: '#C0392B',
  info: '#1E7DBE',
  primary: '#45ADE6',
};

/** Compact Indian-currency formatting: ₹1.25 Cr / ₹2.45 L / ₹3.4K. */
export function inrCompact(v) {
  const n = Number(v) || 0;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}

/** Full Indian-currency formatting: ₹12,34,567. */
export function inrFull(v) {
  return `₹${(Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** Fraction (0–1) → "37%". */
export const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;

/** Time-of-day greeting. */
export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Map an arbitrary status string to an MUI Chip color. */
export function statusChipColor(status) {
  const s = String(status).toLowerCase();
  if (/deliver|paid|complete|done|won|success/.test(s)) return 'success';
  if (/pending|new|hold|open/.test(s)) return 'warning';
  if (/cancel|fail|expired|reject|lost|block/.test(s)) return 'error';
  if (/production|progress|active|sent/.test(s)) return 'info';
  return 'default';
}
