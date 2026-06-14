// Send-window math, evaluated in Asia/Kolkata (IST, fixed +05:30, no DST).
// Decides whether a campaign may send right now, and if not, the next instant it can.
const IST_OFFSET_MS = 330 * 60 * 1000;

const isWeekend = (dow: number) => dow === 0 || dow === 6; // Sun / Sat

export function evaluateWindow(campaign: {
  send_window_start?: number | null;
  send_window_end?: number | null;
  send_on_weekends?: boolean | null;
}): { sendableNow: boolean; nextOpenIso: string } {
  const ws = campaign.send_window_start ?? 9;
  const we = campaign.send_window_end ?? 18;
  const weekendOk = !!campaign.send_on_weekends;

  const now = new Date();
  // Shift by the IST offset so the UTC getters read IST wall-clock.
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const h = ist.getUTCHours();
  const dow = ist.getUTCDay();

  const sendableNow = h >= ws && h < we && (weekendOk || !isWeekend(dow));
  if (sendableNow) return { sendableNow: true, nextOpenIso: now.toISOString() };

  // Build the next window-open instant (as IST wall-clock, then convert to UTC).
  let openIst = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), ws, 0, 0));
  if (h >= ws) openIst = new Date(openIst.getTime() + 24 * 3600 * 1000); // past today's window → tomorrow
  while (!weekendOk && isWeekend(openIst.getUTCDay())) {
    openIst = new Date(openIst.getTime() + 24 * 3600 * 1000);
  }
  const openUtc = new Date(openIst.getTime() - IST_OFFSET_MS);
  return { sendableNow: false, nextOpenIso: openUtc.toISOString() };
}

// next_send_at for a step given its delay, measured from `from` (default now).
export function delayToIso(step: { delay_days?: number | null; delay_hours?: number | null }, from = new Date()): string {
  const ms = (step.delay_days ?? 0) * 86400_000 + (step.delay_hours ?? 0) * 3600_000;
  return new Date(from.getTime() + ms).toISOString();
}
