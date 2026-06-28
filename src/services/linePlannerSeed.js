/**
 * One-click seed of the three sample power-cord routings from the IE cycle-time
 * master (Reyansh_Cycle_Time_ERP_Master.xlsx). Runs IN-APP while the user is
 * authenticated, so RLS passes — no service-role key, no DB migration touching
 * the (out-of-sync) migration ledger. Idempotent: products are matched by
 * customer_code and never duplicated; a product that already has a routing is
 * left untouched unless `force` is passed.
 *
 * Cycle-time convention (matches routingCapacity.js):
 *  - labour ops  → cycle_time_sec = seconds PER PIECE, cavities = 1.
 *  - moulding ops → cycle_time_sec = SHOT time, cavities = N; the engine then
 *    computes cavities × 3600/shot × OEE (e.g. C10041 inner: 6 × 3600/72 × 0.8 = 240/hr).
 * OEE is the sheet's default 80% planned efficiency (editable per op afterwards).
 */
import mesService from './mesService';
import * as plm from './plmProductService';

const OEE = 0.8;

// Map a sheet operation to a seeded assembly_operation.operation_code.
const labour = (operation_code, step_name, cycle, opts = {}) => ({
  operation_code, step_name, department: opts.dept || 'Assembly',
  cycle_time_sec: cycle, cavities: 1, parallel_machines: 1,
  min_operators: 1, max_operators: 9, oee: OEE, scrap_pct: 0,
  quality_check_required: !!opts.qc, notes: opts.notes || null,
});
const mould = (operation_code, step_name, shot, cavities, opts = {}) => ({
  operation_code, step_name, department: 'Moulding',
  cycle_time_sec: shot, cavities, parallel_machines: 1,
  min_operators: 1, max_operators: 1, oee: OEE, scrap_pct: 0,
  quality_check_required: false, notes: opts.notes || null,
});

const ASSEMBLY = [
  labour('core_stripping', 'Stripping', 3.75),
  labour('terminal_crimping', 'Crimping', 2.40),
  labour('sleeve_fitting', 'Fiberglass sleeve fitting', 30, { notes: 'Line bottleneck — run parallel stations' }),
  labour('pin_welding', 'Pin welding', 10, { qc: true }),
  labour('heat_shrink', 'Heat-shrink', 10),
];

export const SAMPLE_PRODUCTS = [
  {
    customer_code: 'C10041',
    product_name: '3-Core Power Cord (C10041)',
    steps: [
      ...ASSEMBLY,
      mould('inner_molding', 'Moulding - Inner', 72, 6, { notes: '6-cavity mould' }),
      mould('outer_molding', 'Moulding - Outer', 45, 6, { notes: '6-cavity mould' }),
      labour('folding', 'Folding + Testing', 6.667, { dept: 'Packing', notes: 'Combined fold + test (standard mode). Split into separate ops if you run them apart.' }),
    ],
  },
  {
    customer_code: 'C10053',
    product_name: 'Power Cord C10053',
    steps: [
      ...ASSEMBLY,
      mould('inner_molding', 'Moulding - Inner', 72, 6, { notes: '6-cavity mould' }),
      mould('outer_molding', 'Moulding - Outer', 45, 6, { notes: '6-cavity mould' }),
    ],
  },
  {
    customer_code: 'C10052',
    product_name: 'Moulding Set C10052',
    steps: [
      mould('inner_molding', 'Moulding - Inner', 60, 6, { notes: '6-cavity mould' }),
      mould('outer_molding', 'Moulding - Outer', 30, 2, { notes: '2-cavity mould — capacity constraint' }),
      mould('grommet_molding', 'Moulding - Grommet', 42, 5, { notes: '5-cavity mould' }),
    ],
  },
];

/**
 * Seed (or refresh) the three sample products + routings.
 * @param {{ force?: boolean }} options force=true re-saves routing even when one already exists.
 * @returns per-product summary { customer_code, product_id, created, saved, steps, missingOps[] }.
 */
export async function seedSampleRoutings({ force = false } = {}) {
  const [ops, products] = await Promise.all([
    mesService.listOperations({ includeInactive: true }),
    plm.listProducts({ includeArchived: true }),
  ]);
  const opByCode = new Map(ops.map((o) => [o.operation_code, o]));
  const byCustomer = new Map(
    products.filter((p) => p.customer_code).map((p) => [String(p.customer_code).toUpperCase(), p])
  );

  const results = [];
  for (const sample of SAMPLE_PRODUCTS) {
    let product = byCustomer.get(sample.customer_code.toUpperCase());
    let created = false;
    if (!product) {
      product = await plm.createProduct({
        customer_code: sample.customer_code,
        product_name: sample.product_name,
        product_type: 'power_cord',
        status: 'production',
      });
      created = true;
    }

    const missingOps = sample.steps
      .filter((s) => !opByCode.get(s.operation_code))
      .map((s) => s.operation_code);

    let saved = false;
    if (created || force) {
      saved = true;
    } else {
      // Idempotent: only save if this product has no routing steps yet.
      const existing = await plm.listProcess(product.id);
      saved = !existing || existing.length === 0;
    }

    if (saved) {
      const steps = sample.steps.map(({ operation_code, ...rest }) => ({
        ...rest,
        operation_id: opByCode.get(operation_code)?.id || null,
      }));
      await plm.saveProcess(product.id, steps);
    }

    results.push({
      customer_code: sample.customer_code,
      product_id: product.id,
      created,
      saved,
      steps: sample.steps.length,
      missingOps,
    });
  }
  return results;
}

const linePlannerSeed = { SAMPLE_PRODUCTS, seedSampleRoutings };
export default linePlannerSeed;
