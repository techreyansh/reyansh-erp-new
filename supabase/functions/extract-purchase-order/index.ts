// Supabase Edge Function: extract-purchase-order
//
// Reads an uploaded purchase order — PDF, image/scan, or Excel/CSV — and uses
// Google Gemini (vision + PDF + structured output) to extract the header and
// line items so the Sales Order Ingestion form can be auto-filled.
//
// Deploy:
//   supabase functions deploy extract-purchase-order
//   supabase secrets set GEMINI_API_KEY=AIza...   (same key as the Production Log fn)
//
// Model: gemini-2.5-flash (vision + structured outputs) — see ../_shared/gemini.ts.
import { CORS, json, generateJson, GEMINI_MODEL, type GeminiPart } from "../_shared/gemini.ts";

const PO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    buyer_name: { type: "string", description: "Company that issued the PO (the customer)" },
    po_number: { type: "string" },
    po_date: { type: "string", description: "ISO date YYYY-MM-DD if determinable, else as printed" },
    delivery_date: { type: "string" },
    payment_terms: { type: "string" },
    ship_to: { type: "string" },
    bill_to: { type: "string" },
    currency: { type: "string", description: "e.g. INR" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string", description: "Item / product description as printed" },
          product_code: { type: "string", description: "Buyer or our part/product code if present, else empty" },
          quantity: { type: "number" },
          unit: { type: "string", description: "e.g. mtr, nos, kg" },
          unit_price: { type: "number" },
          amount: { type: "number", description: "Line total if printed, else 0" },
        },
        required: ["description", "product_code", "quantity", "unit", "unit_price", "amount"],
      },
    },
    total_amount: { type: "number" },
    notes: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["buyer_name", "po_number", "po_date", "delivery_date", "payment_terms", "ship_to", "bill_to", "currency", "line_items", "total_amount", "notes", "warnings"],
};

const SYSTEM = `You are a purchase-order extraction engine for a cable / power-cord / wiring-harness manufacturer.
You receive a customer's Purchase Order as a PDF, a photo/scan, or a spreadsheet. Extract it faithfully:
- Header: buyer (the customer issuing the PO), PO number, PO date, delivery/required date, payment terms, ship-to, bill-to, currency.
- Every line item: description (verbatim), product/part code if shown, quantity, unit, unit price, and line amount.
Do NOT invent values. Use "" for missing text and 0 for missing numbers. Put anything ambiguous or low-confidence in "warnings".`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "GEMINI_API_KEY secret is not set on the Edge Function." }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) return json({ error: "No files provided." }, 400);

  try {
    const parts: GeminiPart[] = [{ text: "Extract the purchase order from the document(s) below." }];
    for (const f of files) {
      if (f.kind === "pdf" && f.dataBase64) {
        parts.push({ inlineData: { mimeType: "application/pdf", data: f.dataBase64 } });
      } else if (f.kind === "image" && f.dataBase64) {
        parts.push({ inlineData: { mimeType: f.mediaType || "image/jpeg", data: f.dataBase64 } });
      } else if (f.kind === "sheet" && Array.isArray(f.rows)) {
        parts.push({ text: `--- Spreadsheet: ${f.name || "PO"} ---\n${JSON.stringify(f.rows).slice(0, 200000)}` });
      }
    }

    const { result, usage } = await generateJson({ apiKey, system: SYSTEM, parts, schema: PO_SCHEMA });
    return json({ model: GEMINI_MODEL, result, usage });
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
