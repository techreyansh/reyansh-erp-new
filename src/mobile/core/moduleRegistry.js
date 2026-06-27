// Module registry for the Factory Ops App.
//
// Every business module is a drop-in descriptor here. Adding a module.js entry
// (with its requiredModule + screens) adds a Home tile and its routes with ZERO
// shell/nav edits — the shell renders whatever `visibleModules()` returns.
//
// Descriptor shape:
//   {
//     key:            'store',            // unique, also the URL segment (/app/store)
//     title:          'Store',
//     icon:           <MUI icon element or string>,
//     requiredModule: 'inventory',        // MODULE_KEYS value gated by get_my_rbac_access can_view
//     color:          '#...',             // optional tile accent
//     screens: [{ key, title, cap, component }],  // cap = optional capability string
//     offlineEntities: ['store_bins'],    // entities this module caches for offline reads
//   }
//
// This file stays PURE (no supabase, no React, no IDB) so visibleModules() unit-tests
// like src/services/routingCapacity.js.

import { hasCap } from './capabilities';
import demoModule from '../modules/_demo/module';
import storeModule from '../modules/store/module';
import productionModule from '../modules/production/module';
import qualityModule from '../modules/quality/module';

// The live registry. Real modules append their descriptor here as they land.
export const moduleRegistry = [storeModule, productionModule, qualityModule, demoModule];

/**
 * PURE: filter a registry down to the modules a user can actually see.
 *
 * A module is visible when:
 *   1. the user can_view its requiredModule (from get_my_rbac_access), AND
 *   2. (if the module declares a `cap`) the user holds that capability.
 *
 * Each visible module also carries a `screens` array filtered by per-screen `cap`.
 *
 * @param {Array} registry      module descriptors
 * @param {Object} access       { modules: [{ module_key, can_view, ... }], authorized }
 * @param {Array|Object} capabilities  caps payload (array | {capabilities:[]})
 * @returns {Array} visible module descriptors (with filtered screens)
 */
export function visibleModules(registry = [], access = {}, capabilities = []) {
  const viewable = new Set(
    (Array.isArray(access?.modules) ? access.modules : [])
      .filter((m) => m && m.can_view === true)
      .map((m) => String(m.module_key || '').trim().toLowerCase())
  );

  return registry
    .filter((mod) => {
      if (!mod || !mod.key) return false;
      const required = String(mod.requiredModule || '').trim().toLowerCase();
      if (required && !viewable.has(required)) return false;
      if (mod.cap && !hasCap(capabilities, mod.cap)) return false;
      return true;
    })
    .map((mod) => ({
      ...mod,
      screens: (mod.screens || []).filter((s) => !s.cap || hasCap(capabilities, s.cap)),
    }));
}

/** Lookup a (filtered) module by key from an already-computed visible list. */
export function findModule(modules, key) {
  return (modules || []).find((m) => m.key === key) || null;
}
