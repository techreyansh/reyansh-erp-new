// Persistent navigation preferences: sidebar collapse, pinned favorites, and
// recently-visited screens. All stored in localStorage so they survive reloads.
import { useState, useEffect, useCallback } from "react";

const COLLAPSE_KEY = "nav.collapsed";
const FAV_KEY = "nav.favorites";
const RECENT_KEY = "nav.recents";
const RECENT_MAX = 6;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function useNavPrefs() {
  const [collapsed, setCollapsedState] = useState(() => read(COLLAPSE_KEY, false));
  const [favorites, setFavorites] = useState(() => read(FAV_KEY, [])); // array of paths
  const [recents, setRecents] = useState(() => read(RECENT_KEY, [])); // array of { path, label }

  useEffect(() => write(COLLAPSE_KEY, collapsed), [collapsed]);
  useEffect(() => write(FAV_KEY, favorites), [favorites]);
  useEffect(() => write(RECENT_KEY, recents), [recents]);

  const setCollapsed = useCallback((v) => {
    setCollapsedState((prev) => (typeof v === "function" ? v(prev) : v));
  }, []);
  const toggleCollapsed = useCallback(() => setCollapsedState((p) => !p), []);

  const isFavorite = useCallback((path) => favorites.includes(path), [favorites]);
  const toggleFavorite = useCallback((path) => {
    setFavorites((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  }, []);

  // Record a visited screen at the top of the recents list (deduped, capped).
  const pushRecent = useCallback((entry) => {
    if (!entry || !entry.path) return;
    setRecents((prev) => {
      const next = [entry, ...prev.filter((r) => r.path !== entry.path)];
      return next.slice(0, RECENT_MAX);
    });
  }, []);

  return {
    collapsed,
    setCollapsed,
    toggleCollapsed,
    favorites,
    isFavorite,
    toggleFavorite,
    recents,
    pushRecent,
  };
}
