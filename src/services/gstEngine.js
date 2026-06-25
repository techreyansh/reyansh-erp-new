// GST tax-invoice engine (pure). Computes per-line taxable value + tax and
// rolls up invoice totals. Intra-state → CGST+SGST (rate split in half);
// inter-state → IGST (full rate). No network, fully testable.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param rawLines [{ product_code, product_name, hsn, qty, uom, rate, gst_rate? }]
 * @param opts     { gstRate (default per line or 18), interState (bool) }
 * @returns { lines, taxable, cgst, sgst, igst, taxTotal, roundOff, grandTotal }
 */
export function computeInvoice(rawLines = [], opts = {}) {
  const interState = !!opts.interState;
  const defRate = Number(opts.gstRate);
  const lines = rawLines.map((l, i) => {
    const qty = Number(l.qty) || 0;
    const rate = Number(l.rate) || 0;
    const gst_rate = Number.isFinite(Number(l.gst_rate)) && l.gst_rate !== '' ? Number(l.gst_rate)
      : (Number.isFinite(defRate) ? defRate : 18);
    const taxable_value = r2(qty * rate);
    const taxAmt = r2(taxable_value * gst_rate / 100);
    const cgst = interState ? 0 : r2(taxAmt / 2);
    const sgst = interState ? 0 : r2(taxAmt - cgst); // ensure cgst+sgst == taxAmt exactly
    const igst = interState ? taxAmt : 0;
    return {
      product_code: l.product_code || null, product_name: l.product_name || null, hsn: l.hsn || null,
      qty, uom: l.uom || null, rate, gst_rate, taxable_value,
      cgst, sgst, igst, amount: r2(taxable_value + cgst + sgst + igst), sequence: i,
    };
  });
  const sum = (k) => r2(lines.reduce((s, l) => s + (Number(l[k]) || 0), 0));
  const taxable = sum('taxable_value');
  const cgst = sum('cgst');
  const sgst = sum('sgst');
  const igst = sum('igst');
  const taxTotal = r2(cgst + sgst + igst);
  const preRound = r2(taxable + taxTotal);
  const grandTotal = Math.round(preRound);
  const roundOff = r2(grandTotal - preRound);
  return { lines, taxable, cgst, sgst, igst, taxTotal, roundOff, grandTotal };
}

/** Suggest inter-state when both state codes are known and differ. */
export function isInterState(sellerStateCode, customerStateCode) {
  const a = String(sellerStateCode || '').trim();
  const b = String(customerStateCode || '').trim();
  if (!a || !b) return false;
  return a !== b;
}

const gstEngine = { computeInvoice, isInterState };
export default gstEngine;
