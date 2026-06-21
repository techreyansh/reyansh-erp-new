/**
 * Cable Master — Phase 1 data service.
 *
 * CRUD over the LIVE Supabase `cable_master` table, plus auto-computation of
 * geometry + per-metre raw-material from the framework-free cable planner engine
 * (src/services/cablePlanner). Used by the Cable Master screen's live preview.
 *
 * Engine import style mirrors index.js's `export *` barrel — the geometry /
 * materials submodules are re-exported as flat named functions, so we import the
 * namespace objects via the barrel and call geometry.cableGeometry / materials.*.
 */
import { supabase } from '../lib/supabaseClient';
import * as geometry from './cablePlanner/geometry';
import * as materials from './cablePlanner/materials';

/**
 * Map a cable_master row to the engine's `cable` object shape.
 * strand_construction "30/0.25" → strandCount 30 (first number).
 */
export function toEngineCable(row) {
  return {
    cores: Number(row.cores) || 1,
    size: Number(row.copper_area_sqmm) || 1,
    strandCount: parseInt(String(row.strand_construction || '').split('/')[0], 10) || 1,
    insThick: Number(row.insulation_thickness) || 0.6,
    shThick: Number(row.sheath_thickness) || 0.9,
    coreColors: Array.isArray(row.colour_combination) ? row.colour_combination : [],
    isPowerCord: !!row.is_power_cord,
    cordLength: Number(row.cord_length) || 0,
  };
}

/**
 * Auto-compute geometry + per-metre RM for the form preview.
 * Returns derived ODs, weight/m, and the per-metre BOM (copper / PVC-ins / PVC-sheath).
 */
export function computeSpecs(row) {
  const cable = toEngineCable(row);
  const g = geometry.cableGeometry(cable);
  const rm = materials.perMeterRM(cable);
  return {
    conductor_od: g.conductorDia,
    core_od: g.insOd,
    finished_od: g.outerOd,
    weight_per_meter: +(((rm.copper || 0) + (rm.ins || 0) + (rm.sh || 0)).toFixed(4)),
    rm: { copper: rm.copper, ins: rm.ins, sh: rm.sh },
  };
}

/** Throw a clean Error from a Supabase { data, error } response. */
function unwrap(res, context) {
  const { data, error } = res;
  if (error) {
    const msg = error.message || 'Unknown error';
    console.warn(`[cableMasterService] ${context}:`, msg);
    throw new Error(`${context}: ${msg}`);
  }
  return data;
}

/** All cable specs, ordered by code. */
export async function listCables() {
  return (
    unwrap(
      await supabase.from('cable_master').select('*').order('cable_code'),
      'List cables'
    ) || []
  );
}

/**
 * Insert or update a cable spec (upsert by presence of id).
 * Auto-fills computed ODs + weight when the form left them blank (null/undefined);
 * a user-typed override is kept as-is.
 */
export async function saveCable(row) {
  const c = computeSpecs(row);
  const blank = (v) => v === null || v === undefined || v === '';
  const payload = {
    ...row,
    conductor_od: blank(row.conductor_od) ? c.conductor_od : Number(row.conductor_od),
    core_od: blank(row.core_od) ? c.core_od : Number(row.core_od),
    finished_od: blank(row.finished_od) ? c.finished_od : Number(row.finished_od),
    weight_per_meter: blank(row.weight_per_meter)
      ? c.weight_per_meter
      : Number(row.weight_per_meter),
  };

  if (row.id) {
    return unwrap(
      await supabase.from('cable_master').update(payload).eq('id', row.id).select().single(),
      'Update cable'
    );
  }
  return unwrap(
    await supabase.from('cable_master').insert(payload).select().single(),
    'Create cable'
  );
}

/** Delete a cable spec by id. */
export async function deleteCable(id) {
  unwrap(await supabase.from('cable_master').delete().eq('id', id), 'Delete cable');
  return true;
}

const cableMasterService = {
  toEngineCable,
  computeSpecs,
  listCables,
  saveCable,
  deleteCable,
};

export default cableMasterService;
