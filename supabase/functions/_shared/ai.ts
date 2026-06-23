// Gemini-powered email copywriter.
// Given a contact, the campaign's brief/tone, and the current step's goal,
// it writes a fresh, personalized subject + body for THIS recipient.
//
// Follows the repo pattern (extract-production-log): structured JSON output via
// the shared Gemini helper (responseSchema), then return the parsed object.
import { generateJson } from "./llm.ts";

export const EMAIL_MODEL = "auto"; // provider/model resolved by _shared/llm.ts

const EMAIL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string", description: "Compelling, specific subject line. No clickbait, no ALL CAPS, < 70 chars." },
    body: {
      type: "string",
      description:
        "The full email body as plain text with real line breaks. Personalized to the recipient. " +
        "Short paragraphs. One clear call to action. Include the sign-off/signature. No markdown, no placeholders like {{name}}.",
    },
    preview_text: { type: "string", description: "~90 char inbox preview / preheader." },
  },
  required: ["subject", "body", "preview_text"],
};

export type Contact = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  company?: string | null;
  title?: string | null;
  attributes?: Record<string, unknown> | null;
};

export type Campaign = {
  name: string;
  ai_brief?: string | null;
  ai_tone?: string | null;
  ai_signature?: string | null;
  from_name?: string | null;
};

export type Step = {
  step_order: number;
  goal: string;
  subject_hint?: string | null;
};

export type PriorMessage = { step_order: number; subject: string; body: string };

const SYSTEM = `You are an expert B2B sales copywriter writing on behalf of Reyansh International,
a manufacturer of cables, power cords and molded products. You write outbound emails that feel
1:1 and human — never like a mass blast.

Rules:
- Personalize using the recipient's name, company, title and any provided attributes. If a field is
  missing, write naturally around it — NEVER output a placeholder, bracket, or "[company]".
- Respect the requested tone. Keep it tight: 60–130 words for a cold step, shorter for follow-ups.
- Exactly one clear call to action.
- A follow-up step must acknowledge it follows earlier emails (light touch, no guilt-tripping) and
  add a NEW angle — do not repeat the previous email.
- No spammy words, no excessive exclamation, no fake urgency. Write like a real person at a real company.
- End with the provided signature/sign-off. If none is provided, use a simple professional sign-off
  from the sender name.
- Output plain text with real newlines. No markdown, no subject line inside the body.`;

export async function generateEmail(opts: {
  apiKey?: string; // deprecated/ignored — provider + key resolved by _shared/llm.ts
  contact: Contact;
  campaign: Campaign;
  step: Step;
  priorMessages?: PriorMessage[];
}): Promise<{ subject: string; body: string; preview_text: string; model: string; usage: unknown }> {
  const { contact, campaign, step, priorMessages = [] } = opts;

  const recipient = {
    first_name: contact.first_name || null,
    last_name: contact.last_name || null,
    full_name: contact.full_name || null,
    company: contact.company || null,
    title: contact.title || null,
    attributes: contact.attributes || {},
  };

  const history = priorMessages.length
    ? `\n\nEarlier emails already sent in this sequence (do NOT repeat them):\n` +
      priorMessages
        .map((m) => `[Step ${m.step_order}] Subject: ${m.subject}\n${m.body}`)
        .join("\n---\n")
    : `\n\nThis is the first email in the sequence.`;

  const userText =
    `Write email step ${step.step_order} of an outbound campaign.\n\n` +
    `CAMPAIGN: ${campaign.name}\n` +
    `WHAT WE OFFER / CONTEXT (the brief):\n${campaign.ai_brief || "(none provided)"}\n\n` +
    `TONE: ${campaign.ai_tone || "professional, warm, concise"}\n` +
    `SENDER NAME: ${campaign.from_name || "the Reyansh International team"}\n` +
    `SIGNATURE / SIGN-OFF TO USE:\n${campaign.ai_signature || "(use a simple professional sign-off from the sender name)"}\n\n` +
    `THIS STEP'S GOAL: ${step.goal}\n` +
    (step.subject_hint ? `SUBJECT HINT: ${step.subject_hint}\n` : "") +
    `\nRECIPIENT (personalize to them):\n${JSON.stringify(recipient, null, 2)}` +
    history;

  const { result, usage } = await generateJson({
    system: SYSTEM,
    parts: [{ text: userText }],
    schema: EMAIL_SCHEMA,
    maxOutputTokens: 8000,
  });
  return { ...result, model: EMAIL_MODEL, usage };
}
