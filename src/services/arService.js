import { supabase } from "../lib/supabaseClient";

/**
 * Accounts-Receivable / Collections service.
 *
 * Talks directly to the live Supabase view + RPCs. RLS auto-filters rows to the
 * caller (CEO sees all; others see their own + unassigned). These helpers are
 * defensive: they log and return []/null on error rather than throwing, so the
 * Collections UI never hard-crashes on a transient backend hiccup.
 */

const nullable = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
};

/** All AR invoices, soonest due first. */
export async function listInvoices() {
  try {
    const { data, error } = await supabase
      .from("v_ar_invoices")
      .select("*")
      .order("due_date", { ascending: true });
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    console.error("[arService.listInvoices]", e);
    return [];
  }
}

/** Dashboard rollup: totals, aging buckets, status counts, top debtors. */
export async function dashboard() {
  try {
    const { data, error } = await supabase.rpc("ar_dashboard");
    if (error) throw error;
    return data;
  } catch (e) {
    console.error("[arService.dashboard]", e);
    return null;
  }
}

/** Create a new invoice. Blank optional fields map to null. */
export async function createInvoice({
  customerCode,
  customerName,
  invoiceNumber,
  invoiceDate,
  amount,
  termsDays,
  poRef,
  dispatchId,
  owner,
} = {}) {
  try {
    const { data, error } = await supabase.rpc("ar_create_invoice", {
      p_customer_code: nullable(customerCode),
      p_customer_name: nullable(customerName),
      p_invoice_number: nullable(invoiceNumber),
      p_invoice_date: nullable(invoiceDate),
      p_amount: amount == null || amount === "" ? null : Number(amount),
      p_terms_days:
        termsDays == null || termsDays === "" ? null : Number(termsDays),
      p_po_ref: nullable(poRef),
      p_dispatch_id: nullable(dispatchId),
      p_owner: nullable(owner),
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.error("[arService.createInvoice]", e);
    return null;
  }
}

/** Record a payment against an invoice. */
export async function recordPayment(invoiceId, { amount, paidOn, method, note } = {}) {
  try {
    const { data, error } = await supabase.rpc("ar_record_payment", {
      p_invoice_id: invoiceId,
      p_amount: amount == null || amount === "" ? null : Number(amount),
      p_paid_on: nullable(paidOn),
      p_method: nullable(method),
      p_note: nullable(note),
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.error("[arService.recordPayment]", e);
    return null;
  }
}

/** Collections worklist for an owner (null = all / RLS-scoped). */
export async function collections(owner) {
  try {
    const { data, error } = await supabase.rpc("ar_collections", {
      p_owner: owner || null,
    });
    if (error) throw error;
    return data ?? [];
  } catch (e) {
    console.error("[arService.collections]", e);
    return [];
  }
}

const arService = {
  listInvoices,
  dashboard,
  createInvoice,
  recordPayment,
  collections,
};

export default arService;
