// Supabase Edge Function: email-generate
//
// Generates a fresh, personalized email (subject + body) for one contact toward
// one campaign step's goal, using Gemini. Stateless — the caller passes the
// contact / campaign / step inline (the frontend "preview draft" button and the
// scheduler both use it).
//
// Deploy:
//   supabase functions deploy email-generate
//   supabase secrets set GEMINI_API_KEY=AIza...
//
// POST body: { contact, campaign, step, priorMessages? }   (see _shared/ai.ts types)
import { preflight, json } from "../_shared/cors.ts";
import { generateEmail } from "../_shared/ai.ts";
import { aiConfigured, AI_NOT_CONFIGURED } from "../_shared/llm.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!aiConfigured()) return json({ error: AI_NOT_CONFIGURED }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const { contact, campaign, step, priorMessages } = body || {};
  if (!contact?.email) return json({ error: "contact.email is required" }, 400);
  if (!campaign) return json({ error: "campaign is required" }, 400);
  if (!step?.goal) return json({ error: "step.goal is required" }, 400);

  try {
    const result = await generateEmail({ contact, campaign, step, priorMessages });
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
