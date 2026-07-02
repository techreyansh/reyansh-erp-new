// Personalization / merge-field rendering for WhatsApp campaign step bodies.
//
// Placeholders use {{Token}} syntax. Unresolved placeholders are intentionally
// left as the literal "{{Token}}" rather than blanked out — a broken/missing
// merge field should be visible in the sent message (and in the Live Monitor)
// rather than silently disappearing into an empty gap.

export interface WaPersonalizationContext {
  CustomerName?: string;
  CompanyName?: string;
  ContactPerson?: string;
  SalesPerson?: string;
  Product?: string;
  City?: string;
  LastOrder?: string;
  [key: string]: string | undefined;
}

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Replaces {{Token}} placeholders in `text` using `ctx`. Pure function. */
export function renderTemplate(text: string, ctx: WaPersonalizationContext): string {
  if (!text) return text ?? "";
  return text.replace(TOKEN_RE, (match, token) => {
    const value = ctx[token];
    return value === undefined || value === null || value === "" ? match : String(value);
  });
}

/**
 * Builds the personalization context for one contact + campaign: contact row
 * fields first, campaign owner_email as the SalesPerson fallback, then
 * contact.attributes jsonb for anything not directly on the row (product,
 * city, last order, or explicit contact-person/sales-person overrides).
 */
export function buildPersonalizationContext(contact: any, campaign: any): WaPersonalizationContext {
  const attrs = (contact && contact.attributes) || {};
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = attrs[k];
      if (v !== undefined && v !== null && v !== "") return String(v);
    }
    return undefined;
  };

  return {
    CustomerName: contact?.contact_name || undefined,
    CompanyName: contact?.company || pick("company", "companyName"),
    ContactPerson: pick("contactPerson", "contact_person") || contact?.contact_name || undefined,
    SalesPerson: pick("salesPerson", "sales_person") || campaign?.owner_email || undefined,
    Product: pick("product", "Product"),
    City: pick("city", "City"),
    LastOrder: pick("lastOrder", "last_order", "LastOrder"),
  };
}

/* ---------------------------------------------------------------------------
 * Manual verification examples.
 *
 * No Deno test precedent exists anywhere in this repo as of Task 4 — grepped
 * the whole `supabase/functions/` tree for `*_test.ts` / `*.test.ts` and got
 * zero hits, so per the task brief these are documented input/output pairs
 * instead of `Deno.test` cases. Run any of them by hand with `deno eval` or a
 * scratch `deno run` script if you want to confirm behavior interactively.
 *
 * 1. renderTemplate(
 *      'Hi {{CustomerName}}, thanks for choosing {{CompanyName}}!',
 *      { CustomerName: 'Rahul', CompanyName: 'Acme Pvt Ltd' }
 *    )
 *    -> 'Hi Rahul, thanks for choosing Acme Pvt Ltd!'
 *
 * 2. renderTemplate(
 *      'Hello {{CustomerName}}, your rep is {{SalesPerson}}.',
 *      { CustomerName: 'Priya' }               // SalesPerson missing
 *    )
 *    -> 'Hello Priya, your rep is {{SalesPerson}}.'   // left literal, not blanked
 *
 * 3. renderTemplate(
 *      '{{Product}} order for {{City}} — last order {{LastOrder}}',
 *      { Product: 'PVC Wire 1.5mm', City: 'Pune', LastOrder: '2026-05-12' }
 *    )
 *    -> 'PVC Wire 1.5mm order for Pune — last order 2026-05-12'
 *
 * 4. renderTemplate('No placeholders here.', {})
 *    -> 'No placeholders here.'                       // pass-through unchanged
 *
 * 5. buildPersonalizationContext(
 *      { contact_name: 'Rahul', company: 'Acme', attributes: { city: 'Pune' } },
 *      { owner_email: 'sales@reyansh.com' }
 *    )
 *    -> {
 *         CustomerName: 'Rahul', CompanyName: 'Acme', ContactPerson: 'Rahul',
 *         SalesPerson: 'sales@reyansh.com', Product: undefined,
 *         City: 'Pune', LastOrder: undefined,
 *       }
 * ------------------------------------------------------------------------- */
