/**
 * Shared formatting + visual constants for the dashboard kit.
 * Single source of truth so every dashboard renders money, percentages,
 * status colors, and chart palettes identically.
 */

/** Standard chart palette — keep all dashboards visually consistent. */
export const CHART_COLORS = [
  '#0D9488', '#0284C7', '#D97706', '#7C3AED',
  '#059669', '#DC2626', '#475569', '#DB2777',
];

/** Semantic colors for status / severity. */
export const SEMANTIC = {
  success: '#059669',
  warning: '#D97706',
  critical: '#DC2626',
  info: '#0284C7',
  primary: '#0D9488',
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
