// BOM access for auto-costing — reads company_bom_data (the canonical BOM) and
// flattens its material arrays into costing-ready lines, with a fuzzy match to
// the central material_rate codes.
import { supabase } from '../lib/supabaseClient';

export async function listBoms() {
  const { data, error } = await supabase.from('company_bom_data')
    .select('pk_id, id, productCode, productDescription, cableMaterials, mouldingMaterials')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };

/** Flatten a BOM's cable + moulding material arrays → [{ rawMaterial, units, qty }]. */
export function bomMaterialLines(bom) {
  const out = [];
  const take = (arr) => (Array.isArray(arr) ? arr : []).forEach((m) => {
    const name = m.rawMaterial || m.material || m.name || m.item;
    if (!name) return;
    out.push({ rawMaterial: String(name), units: m.units || m.uom || '', qty: num(m.qtyPerPc ?? m.qty_per_pc ?? m.qty ?? m.totalQty) });
  });
  take(bom?.cableMaterials);
  take(bom?.mouldingMaterials);
  return out;
}

const KEYWORDS = [
  [/copper|conductor/i, 'COPPER'], [/sheath/i, 'PVC_SHEATH'], [/insulation|core\s*pvc|pvc/i, 'PVC_INS'],
  [/pin|plug/i, 'PIN_6A'], [/terminal/i, 'TERMINAL'], [/connector/i, 'CONNECTOR'],
  [/sleeve/i, 'SLEEVE'], [/label|sticker/i, 'LABEL'], [/pack|carton|box/i, 'PACKING'],
];

/** Best-guess material_rate code for a raw-material name. */
export function matchRateCode(rawMaterial, rates = []) {
  const name = String(rawMaterial || '');
  // exact-ish name/code match first
  const exact = rates.find((r) => r.material_name && name.toLowerCase().includes(r.material_name.toLowerCase()));
  if (exact) return exact.material_code;
  for (const [re, code] of KEYWORDS) if (re.test(name) && rates.some((r) => r.material_code === code)) return code;
  return null;
}

/** Build costing material lines from a BOM + the rate master. */
export function bomToCostingLines(bom, rates = []) {
  return bomMaterialLines(bom).map((m, i) => {
    const code = matchRateCode(m.rawMaterial, rates);
    const rate = code ? (rates.find((r) => r.material_code === code)?.rate ?? '') : '';
    return {
      section: 'material', category: m.rawMaterial, material_code: code || '',
      qty: m.qty || '', uom: m.units || '', rate, amount: '', is_percentage: false, sequence: i,
    };
  });
}

const bomService = { listBoms, bomMaterialLines, matchRateCode, bomToCostingLines };
export default bomService;
