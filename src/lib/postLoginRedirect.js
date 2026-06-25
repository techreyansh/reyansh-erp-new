// Preserve the page a logged-out user was heading to, across the Google OAuth
// round-trip (app → Google → Supabase → app `/`). React Router `location.state`
// is lost on that full-page cross-origin redirect, so we stash the intended path
// in localStorage (10-min TTL, taken once) and restore it after sign-in.
const KEY = 'postLoginRedirect';
const TTL_MS = 10 * 60 * 1000;
const SKIP = new Set(['/', '/login', '/home', '/access-denied']);

function valid(p) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('/login') && !SKIP.has(p);
}

/** Remember where the user was trying to go (call before redirecting to /login). */
export function rememberIntendedPath(path) {
  try {
    if (!valid(path)) return;
    localStorage.setItem(KEY, JSON.stringify({ path, t: Date.now() }));
  } catch { /* storage unavailable — ignore */ }
}

/** Read-and-clear the intended path (null if none / expired / invalid). */
export function takeIntendedPath() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const { path, t } = JSON.parse(raw);
    if (!valid(path) || !t || Date.now() - t > TTL_MS) return null;
    return path;
  } catch {
    return null;
  }
}
