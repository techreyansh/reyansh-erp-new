// Send-window math for WhatsApp campaigns — evaluated in Asia/Kolkata (IST,
// fixed +05:30, no DST), the same timezone choice as the email module's
// `_shared/schedule.ts` (see that file's `evaluateWindow` for the email-side
// twin this was adapted from).
//
// wa_campaigns columns (see 20260701140000_whatsapp_marketing_schema.sql):
//   business_hours_start smallint (0-23, default 9)
//   business_hours_end   smallint (0-23, default 18)
//   working_days_only    boolean  (default true) — Mon-Fri only when true;
//                          note this is the INVERSE polarity of the email
//                          module's `send_on_weekends` flag.
const IST_OFFSET_MS = 330 * 60 * 1000;

const isWeekend = (dow: number) => dow === 0 || dow === 6; // Sun / Sat

/**
 * Given a wa_campaigns row (or any object with the same three fields),
 * decides whether "now" falls inside its business-hours/working-days window,
 * and if not, the next instant (ISO) the window opens.
 */
export function evaluateWaWindow(campaign: {
  business_hours_start?: number | null;
  business_hours_end?: number | null;
  working_days_only?: boolean | null;
}): { sendableNow: boolean; nextOpenIso: string } {
  const ws = campaign.business_hours_start ?? 9;
  const we = campaign.business_hours_end ?? 18;
  const workingDaysOnly = campaign.working_days_only !== false; // schema default true

  const now = new Date();
  // Shift by the IST offset so the UTC getters read IST wall-clock.
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const h = ist.getUTCHours();
  const dow = ist.getUTCDay();

  const sendableNow = h >= ws && h < we && (!workingDaysOnly || !isWeekend(dow));
  if (sendableNow) return { sendableNow: true, nextOpenIso: now.toISOString() };

  // Build the next window-open instant (as IST wall-clock, then convert to UTC).
  let openIst = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), ws, 0, 0));
  if (h >= ws) openIst = new Date(openIst.getTime() + 24 * 3600 * 1000); // past today's window → tomorrow
  while (workingDaysOnly && isWeekend(openIst.getUTCDay())) {
    openIst = new Date(openIst.getTime() + 24 * 3600 * 1000);
  }
  const openUtc = new Date(openIst.getTime() - IST_OFFSET_MS);
  return { sendableNow: false, nextOpenIso: openUtc.toISOString() };
}
