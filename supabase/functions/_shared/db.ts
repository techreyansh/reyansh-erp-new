// Service-role Supabase client for the email-* Edge Functions.
// The service role bypasses RLS — these functions run trusted background work
// (generating drafts, sending, advancing sequences) on behalf of the whole team.
import { createClient } from "npm:@supabase/supabase-js@2";

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on the Edge Function.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
