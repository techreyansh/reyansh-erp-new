// AI Sales Copilot — context-aware sales intelligence for Reyansh International.
// Receives { tool, context, input } and returns structured { sections } generated
// by Gemini using a Reyansh-manufacturing system prompt + per-tool instructions.
// Activate: `supabase secrets set GEMINI_API_KEY=AIza...` then deploy this function.
import { preflight, json } from "../_shared/cors.ts";
import { generateJson } from "../_shared/gemini.ts";

const SYSTEM = `You are an expert B2B sales strategist and account manager for REYANSH INTERNATIONAL, an Indian manufacturer of:
- Power cords (2/3-pin, appliance, computer/IEC), wiring harnesses, cable assemblies, battery cables, EV harnesses
- Single-core and multi-core (2/3/4-core) PVC-insulated copper cables, flat & round
Customers are OEMs and industrial buyers in: home appliances, EV, solar, pumps, motors, consumer electronics, industrial equipment, and the electrical trade.
You understand: BIS/IS standards, copper (LME) price sensitivity, conductor sizing & strand construction, lead times, MOQs, tooling, and Indian B2B manufacturing-sales dynamics (purchase managers, sourcing heads, R&D, plant heads, quality, owners).
Use the CRM CONTEXT provided. Be specific, practical, commercially sharp, and India-appropriate. Never invent customer facts not in context; when unknown, say what to find out. Output ONLY the requested structured sections — each a clear heading + concise actionable body (use short paragraphs / bullet lists in the body text).`;

const TOOL_PROMPTS: Record<string, string> = {
  icp: `IDEAL CUSTOMER PROFILE ANALYSIS. From the customer base + won/lost signals in context, produce sections: "Best-fit Industries", "Ideal Customer Profile", "Common Buying Patterns", "High-Probability Accounts To Pursue", "Accounts To Avoid".`,
  discovery: `DISCOVERY QUESTION BUILDER for the given industry/customer type/product category. Produce sections: "Pain Questions", "Budget Questions", "Authority Questions", "Timeline Questions", "Technical Questions", "Hidden-Need Questions" — 4-6 sharp questions each; flag which uncover the real buying reason.`,
  objection: `OBJECTION HANDLING. For the stated objection (price high / need time / has supplier / not interested / send details), produce sections: "Short Response", "Detailed Response", "Relationship-Friendly Response". Reframe, don't argue.`,
  outreach: `COLD OUTREACH GENERATOR using CRM context. Produce sections: "WhatsApp", "Email (subject + body)", "LinkedIn Message", "Call Opening Script". Keep each tight, value-led, India-B2B tone.`,
  followup: `FOLLOW-UP SEQUENCE BUILDER for a prospect who went quiet. Produce sections "Day 1", "Day 3", "Day 7", "Day 14", "Day 21", "Day 30" — each specifying channel (Email/WhatsApp/Phone/LinkedIn) + the message goal/draft. Add value each touch, never pester; say when to walk away.`,
  proposal: `PROPOSAL BUILDER pulling customer/products/costing/quotation/delivery from context. Produce sections: "Executive Summary", "Business Case", "Solution & Products", "Commercial Offer", "Delivery & Next Step". Professional, no fluff.`,
  debrief: `SALES CALL DEBRIEF of the provided meeting notes/transcript. Produce sections: "What Went Well", "Missed Opportunities", "Real Customer Concerns (between the lines)", "Decision-Maker Analysis", "Recommended Next Steps".`,
  pipeline: `PIPELINE PRIORITIZATION of the open opportunities in context. Produce sections: "Hot — Likely to Close", "Need Attention", "At Risk", "Dead", and "Top 5 Accounts to Focus This Week" with why.`,
  quotation: `QUOTATION STRATEGY using costing/margin/customer-history/competitive position. Produce sections: "Target Price", "Negotiation Range", "Risk Factors", "Win Probability", "Recommended Move".`,
  relationship: `CUSTOMER RELATIONSHIP ADVISOR from order history/meetings/follow-ups/communication/complaints/revenue. Produce sections: "Relationship Health Read", "Upsell Opportunities", "Cross-Sell Opportunities", "Dormancy Risk", "Recommended Next Actions".`,
  oem_research: `OEM ACCOUNT RESEARCHER. Analyze the company for highest-probability business. Produce sections: "Company Analysis (industry, business model, likely manufacturing & product categories)", "Likely Decision Makers (Purchase/Sourcing/R&D/Plant/Ops/Quality)", "Product Opportunities (which Reyansh products — power cords/harnesses/cable assemblies/custom/battery/EV harnesses — and why)", "Business Potential (size, strategic importance, urgency)", "Recommended Entry Strategy (what to pitch first, who to approach, what problem to solve)", "Sales Talking Points (technical/commercial/operational/quality/cost)".`,
  persona: `DECISION-MAKER PERSONA ANALYZER for the given designation/department/notes. Produce sections: "Decision-Maker Type", "Primary Concerns & Likely KPIs", "Decision Criteria & Buying Motivations", "Typical Objections & Risk Factors", "Recommended Approach & Messaging", "Recommended Questions & Follow-up Style". Tailor to Purchase Manager (cost/supply/lead time/terms), R&D (specs/performance/testing/compliance), Plant Head (continuity/quality/delivery), Management (ROI/risk/growth).`,
  recovery: `LOST OPPORTUNITY / DORMANT RECOVERY ENGINE. From last activity, lost reason, history & timeline, produce sections: "Recovery Probability & Score", "Lost-Reason Classification (price/timing/competition/no-follow-up/budget/internal-delay/unknown)", "Recovery Strategy", "Recovery Plan (Week 1/2/3/4 actions)", "Re-engagement Drafts (WhatsApp / Email / Call script / Meeting request)". For dormant clients also add "Upsell/Cross-sell & Relationship-Rebuild Plan".`,
};

const SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: { type: "object", properties: { heading: { type: "string" }, body: { type: "string" } }, required: ["heading", "body"] },
    },
  },
  required: ["sections"],
};

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "AI is not configured yet — set the GEMINI_API_KEY secret on this Edge Function to activate the Copilot." }, 503);

    const { tool, context, input } = await req.json();
    const instruction = TOOL_PROMPTS[tool];
    if (!instruction) return json({ error: `Unknown tool: ${tool}` }, 400);

    const parts = [{
      text: `TOOL: ${instruction}\n\nFREE-FORM INPUT (if any):\n${input || "(none)"}\n\nCRM CONTEXT (JSON):\n${JSON.stringify(context || {}, null, 0).slice(0, 12000)}`,
    }];
    const { result, usage } = await generateJson({ apiKey, system: SYSTEM, parts, schema: SCHEMA, maxOutputTokens: 8000 });
    return json({ sections: result?.sections || [], usage });
  } catch (e) {
    return json({ error: (e as Error).message || "AI generation failed" }, 500);
  }
});
