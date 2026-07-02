// Provider registry — the single place that maps a wa_provider_settings.provider_key
// to its WaAdapter implementation.
//
// To add a new provider:
//   1. Create supabase/functions/_shared/wa/<provider>.ts implementing WaAdapter
//      (see meta.ts for the reference implementation).
//   2. Import it here and replace its `null` entry with `new <Provider>Adapter()`.
//   3. No other file needs to change — wa-send (and later wa-scheduler /
//      wa-webhook) only ever look up PROVIDERS[settings.provider_key].
//
// Only 'meta_cloud' is real in V1; every other provider_key the schema allows
// (see the wa_provider_settings check constraint) resolves to null so wa-send
// can fail fast with a clear 'provider_not_implemented' error instead of
// silently doing nothing.
import type { WaAdapter } from "./types.ts";
import { MetaCloudApiAdapter } from "./meta.ts";

export const PROVIDERS: Record<string, WaAdapter | null> = {
  meta_cloud: new MetaCloudApiAdapter(),
  twilio: null,
  interakt: null,
  aisensy: null,
  wati: null,
  "360dialog": null,
};
