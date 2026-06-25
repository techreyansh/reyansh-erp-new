// KIT engagement scoring (pure). Correlates sent messages (by template
// category) with subsequent positive CRM activity to learn which message types
// drive engagement. No network.

const DAY = 86400000;

/**
 * @param messages   kit_messages rows [{template_id, account_id, sent_at, direction}]
 * @param templates  kit_templates rows [{id, category, name}]
 * @param activities crm_pipeline_activity rows [{pipeline_id, activity_type, activity_at}]
 * @param windowDays response window after a message (default 14)
 * @returns [{ category, label, sent, responded, responseRate, meetings, quotations }]
 *          sorted by responseRate desc.
 */
export function scoreByCategory({ messages = [], templates = [], activities = [], windowDays = 14 } = {}) {
  const catById = {};
  const labelByCat = {};
  templates.forEach((t) => { catById[t.id] = t.category || 'other'; labelByCat[t.category || 'other'] = t.name || t.category || 'Other'; });

  // index activities by account for quick lookup
  const actByAccount = new Map();
  for (const a of activities) {
    if (!a.pipeline_id) continue;
    if (!actByAccount.has(a.pipeline_id)) actByAccount.set(a.pipeline_id, []);
    actByAccount.get(a.pipeline_id).push(a);
  }

  const agg = {};
  const bump = (cat) => (agg[cat] ||= { category: cat, label: labelByCat[cat] || cat, sent: 0, responded: 0, meetings: 0, quotations: 0 });

  for (const m of messages) {
    const sentAt = m.sent_at ? new Date(m.sent_at).getTime() : null;
    if (m.direction && m.direction !== 'out') continue; // only outbound count as "sent"
    const cat = catById[m.template_id] || 'other';
    const a = bump(cat);
    a.sent += 1;
    if (sentAt == null) continue;
    const acts = (actByAccount.get(m.account_id) || []).filter((x) => {
      const t = new Date(x.activity_at).getTime();
      return t > sentAt && t <= sentAt + windowDays * DAY;
    });
    if (acts.length) {
      a.responded += 1;
      if (acts.some((x) => x.activity_type === 'meeting')) a.meetings += 1;
      if (acts.some((x) => x.activity_type === 'quotation')) a.quotations += 1;
    }
  }

  return Object.values(agg)
    .map((a) => ({ ...a, responseRate: a.sent ? Math.round((a.responded / a.sent) * 100) : 0 }))
    .sort((x, y) => y.responseRate - x.responseRate || y.sent - x.sent);
}
