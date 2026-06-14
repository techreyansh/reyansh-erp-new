// Client-side service for the PPC ↔ ERP integration admin screen.
// Reads the sync audit tables directly (RLS-permissive) and invokes the
// ppc-integration / ppc-emit Edge Functions for health + manual master push.
import { supabase } from "../lib/supabaseClient";

const ppcIntegrationService = {
  // Recent cross-system calls (spec §6.2).
  async getSyncLog({ limit = 100, status = null, entity = null } = {}) {
    let q = supabase.from("sync_log").select("*").order("created_at", { ascending: false }).limit(limit);
    if (status) q = q.eq("status", status);
    if (entity) q = q.eq("entity", entity);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  // Watermarks per entity (spec §6.3).
  async getSyncState() {
    const { data, error } = await supabase.from("sync_state").select("*").order("entity");
    if (error) throw error;
    return data || [];
  },

  // Inbound document counts for the at-a-glance cards.
  async getInboundCounts() {
    const tables = ["ppc_invoices", "ppc_purchase_orders", "ppc_stock_journals"];
    const out = {};
    await Promise.all(tables.map(async (t) => {
      const { count } = await supabase.from(t).select("id", { count: "exact", head: true });
      out[t] = count || 0;
    }));
    return out;
  },

  // Liveness of the integration Edge Function.
  async health() {
    const { data, error } = await supabase.functions.invoke("ppc-integration", { method: "GET" });
    // functions.invoke can't always do GET cleanly; fall back to a fetch.
    if (error || !data) {
      try {
        const url = `${supabase.functionsUrl || ""}/ppc-integration/health`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${supabase?.supabaseKey || ""}` } });
        return await res.json();
      } catch (e) {
        return { ok: false, error: error?.message || String(e) };
      }
    }
    return data;
  },

  // Manually push masters to PPC (initial seed / re-sync) via ppc-emit.
  async emitMasters(entity, { all = true, id = null } = {}) {
    const { data, error } = await supabase.functions.invoke("ppc-emit", {
      body: id ? { entity, id } : { entity, all },
    });
    if (error) throw error;
    return data;
  },
};

export default ppcIntegrationService;
