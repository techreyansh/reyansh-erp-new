// Supabase Edge Function: email-track-open
//
// Open-tracking pixel. Sent emails (when a campaign has track_opens on) embed
//   <img src=".../email-track-open?m=<messageId>">
// When the recipient's client loads it, we stamp opened_at + log an 'opened'
// event (first open only), then return a 1x1 transparent GIF.
//
// MUST be deployed public (email clients can't authenticate):
//   supabase functions deploy email-track-open --no-verify-jwt
import { serviceClient } from "../_shared/db.ts";

// 1x1 transparent GIF
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

const pixelResponse = () =>
  new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma": "no-cache",
      "Content-Length": String(PIXEL.length),
    },
  });

Deno.serve(async (req) => {
  // Always return the pixel, even on error — never break the email render.
  try {
    const url = new URL(req.url);
    const messageId = url.searchParams.get("m");
    if (messageId) {
      const db = serviceClient();
      const { data: msg } = await db.from("email_messages")
        .select("id, contact_id, campaign_id, opened_at").eq("id", messageId).single();
      if (msg && !msg.opened_at) {
        await db.from("email_messages").update({ opened_at: new Date().toISOString() }).eq("id", msg.id);
        await db.from("email_events").insert({
          message_id: msg.id, contact_id: msg.contact_id, campaign_id: msg.campaign_id,
          type: "opened", meta: { ua: req.headers.get("user-agent") || null },
        });
      }
    }
  } catch (_e) {
    // swallow — tracking must never affect the recipient
  }
  return pixelResponse();
});
