// KIT cadence engine (pure, no network). Turns the v_kit_contacts signals
// (stage, days_since_touch, at_risk, needs_followup, engagement_score) into a
// concrete recommendation: who to contact, which message category, why, and on
// which channel. Frequency is derived from the relationship state, per the
// "stay top-of-mind without being spammy" philosophy.

const OPP_STAGE = /quotation|sample|negotiation|meeting/;

/**
 * @returns {null | { priority:1|2|3, category, label, reason, channel }}
 *   priority 3 = act today, 2 = this week, 1 = nice-to-do. null = leave alone
 *   (recently/healthily in touch — don't over-message).
 */
export function recommendCadence(c) {
  if (!c) return null;
  const channel = c.whatsapp_enabled ? 'whatsapp' : c.email_enabled ? 'email' : null;
  if (!channel) return null;

  const days = Number(c.days_since_touch);
  const hasDays = Number.isFinite(days);
  const stage = String(c.prospect_stage || c.client_stage || '').toLowerCase();
  const isClient = c.account_type === 'client';
  const eng = Number(c.engagement_score) || 0;

  // Live opportunity — move it forward (but don't pester same-day).
  if (OPP_STAGE.test(stage) && (!hasDays || days >= 2)) {
    return { priority: 3, category: 'opportunity', label: 'Opportunity', channel,
      reason: `Open ${stage.replace(/_/g, ' ')}${hasDays ? ` · ${days}d quiet` : ''} — nudge forward` };
  }
  // Dormant — warm re-engagement.
  if (hasDays && days >= 90) {
    return { priority: 3, category: 'reengagement', label: 'Re-engage', channel,
      reason: `Dormant — ${days}d since contact` };
  }
  if (c.at_risk || (hasDays && days >= 30)) {
    return { priority: 2, category: 'reengagement', label: 'Re-engage', channel,
      reason: c.at_risk ? 'At risk of disengaging' : `No contact for ${days}d` };
  }
  if (c.needs_followup) {
    return { priority: 2, category: isClient ? 'relationship' : 'opportunity', label: 'Follow-up', channel,
      reason: 'Planned follow-up due' };
  }
  // Low engagement — lead with value, not an ask.
  if (eng < 33) {
    return { priority: 1, category: 'industry_insight', label: 'Value touch', channel,
      reason: 'Low engagement — share something useful' };
  }
  // Healthy but a couple of weeks quiet — a light relationship touch.
  if (hasDays && days >= 14) {
    return { priority: 1, category: 'relationship', label: 'Stay in touch', channel,
      reason: `${days}d since last touch` };
  }
  return null; // recently engaged — leave alone to avoid over-messaging
}

/** Rank contacts for today's outreach (highest priority + longest-quiet first). */
export function rankForOutreach(contacts) {
  return (contacts || [])
    .map((c) => ({ contact: c, rec: recommendCadence(c) }))
    .filter((x) => x.rec)
    .sort((a, b) =>
      b.rec.priority - a.rec.priority ||
      (Number(b.contact.days_since_touch) || 0) - (Number(a.contact.days_since_touch) || 0));
}
