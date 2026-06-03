/**
 * Centralized Create React App environment access.
 * All REACT_APP_* variables must be referenced here (or re-exported) for consistency.
 */

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export const appEnv = {
  supabaseUrl: readEnv('REACT_APP_SUPABASE_URL'),
  supabaseAnonKey: readEnv('REACT_APP_SUPABASE_ANON_KEY'),
  whatsappLink: readEnv('REACT_APP_WHATSAPP_LINK') || 'https://wa.me/',
  /** Canonical production URL (set in Vercel). Used only when window is unavailable. */
  appUrl: readEnv('REACT_APP_APP_URL'),
  /** Local dev origin for OAuth docs / fallbacks */
  localDevOrigin: readEnv('REACT_APP_LOCAL_DEV_ORIGIN') || 'http://localhost:3000',
};

export function isLocalhostHostname(hostname = '') {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/** True when running in the browser on localhost. */
export function isLocalDev() {
  if (typeof window === 'undefined') return false;
  return isLocalhostHostname(window.location.hostname);
}

/**
 * OAuth redirect / PKCE origin — always the current browser origin in the client.
 * Falls back to REACT_APP_APP_URL or local dev origin during build/SSR-less prerender.
 */
export function getRuntimeOrigin() {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return appEnv.appUrl || appEnv.localDevOrigin;
}

/** Production app URL for static config (no window). */
export function getConfiguredProductionUrl() {
  return appEnv.appUrl || appEnv.localDevOrigin;
}

/** Allowed OAuth / CORS origins for troubleshooting UI. */
export function getAllowedAppOrigins() {
  const origins = new Set([appEnv.localDevOrigin, 'http://localhost:3001']);
  if (appEnv.appUrl) origins.add(appEnv.appUrl);
  if (typeof window !== 'undefined') origins.add(window.location.origin);
  return Array.from(origins).filter(Boolean);
}

export default appEnv;
