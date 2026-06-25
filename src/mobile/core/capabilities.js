// Pure capability helpers for the Factory Ops App.
// `caps` is the array (or set) of capability strings returned by get_my_capabilities().
// Keep this module supabase-free and IDB-free so it unit-tests trivially.

/** Normalize the capability payload (array | {capabilities:[]} | jsonb) into a plain string[]. */
export function normalizeCaps(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((c) => String(c)).filter(Boolean);
  if (Array.isArray(raw.capabilities)) return raw.capabilities.map((c) => String(c)).filter(Boolean);
  return [];
}

/** True when the caller holds `key`. Absent/empty caps → false (closed by default). */
export function hasCap(caps, key) {
  if (!key) return true; // a screen with no capability requirement is always allowed
  const list = normalizeCaps(caps);
  return list.includes(String(key));
}

/** True when the caller holds every capability in `keys`. */
export function hasAllCaps(caps, keys = []) {
  const list = normalizeCaps(caps);
  return keys.every((k) => !k || list.includes(String(k)));
}
