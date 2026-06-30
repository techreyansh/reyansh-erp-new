// Bridge: map an AI-extracted purchase order (from extract-purchase-order) into
// the SalesOrderWizard `initial` prefill shape. Best-effort matching only — the
// human confirms customer + product matches in the wizard before release. Pure
// (no async / no DB); the wizard fetches released costing for matched lines.

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const codeNorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Find the best account for a buyer name: exact company match, else contains.
function matchCustomer(buyerName, accounts = []) {
  const b = norm(buyerName);
  if (!b) return null;
  const exact = accounts.find((a) => norm(a.company_name) === b);
  if (exact) return exact;
  // contains either way (buyer "ABC Industries" vs account "ABC Industries Pvt Ltd")
  return accounts.find((a) => {
    const c = norm(a.company_name);
    return c && (c.includes(b) || b.includes(c));
  }) || null;
}

// Find a product for a PO line: code exact, customer-part-no exact, else name contains.
function matchProduct(line, products = []) {
  const code = codeNorm(line.product_code);
  if (code) {
    const byCode = products.find((p) => codeNorm(p.product_code) === code);
    if (byCode) return byCode;
    const byPart = products.find((p) => p.customer_part_no && codeNorm(p.customer_part_no) === code);
    if (byPart) return byPart;
  }
  const desc = norm(line.description);
  if (desc.length >= 4) {
    return products.find((p) => {
      const n = norm(p.product_name);
      return n && (n.includes(desc) || desc.includes(n));
    }) || null;
  }
  return null;
}

// Normalize a loose date string ("2026-06-30", "30/06/2026", "30-06-2026") to YYYY-MM-DD, or ''.
function normDate(s) {
  if (!s) return '';
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/**
 * @param {object} po  extract-purchase-order output { buyer_name, po_number, po_date, delivery_date, payment_terms, line_items[] }
 * @param {{products:array, accounts:array}} ctx
 * @returns initial shape for SalesOrderWizard: { po, customerCode, customerName, lines, unmatchedCount }
 */
export function mapPoToWizardInitial(po = {}, { products = [], accounts = [] } = {}) {
  const acct = matchCustomer(po.buyer_name, accounts);
  const lines = (po.line_items || []).map((li) => {
    const prod = matchProduct(li, products);
    return {
      product_id: prod ? prod.id : null,
      product_code: prod?.product_code || li.product_code || '',
      product_name: prod?.product_name || li.description || '(unmatched item)',
      customer_part_no: prod?.customer_part_no || li.product_code || '',
      qty: Number(li.quantity) || 1,
      uom: li.unit || 'pc',
      unit_price: Number(li.unit_price) || 0,
      revision: prod?.current_revision || '',
      needs_match: !prod, // human must pick a product before this line has costing
    };
  });
  return {
    po: {
      po_number: po.po_number || '',
      po_date: normDate(po.po_date) || '',
      payment_terms: po.payment_terms || '',
      expected_delivery_date: normDate(po.delivery_date) || '',
      buyer_name: po.buyer_name || '',
    },
    customerCode: acct?.customer_code || null,
    customerName: po.buyer_name || '',
    lines,
    unmatchedCount: lines.filter((l) => l.needs_match).length,
  };
}

const poToSalesOrder = { mapPoToWizardInitial };
export default poToSalesOrder;
