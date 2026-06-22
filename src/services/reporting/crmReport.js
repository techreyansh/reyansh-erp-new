// CRM Action Report builder. Pulls the live crm_pipeline data via
// crmPipelineService (the canonical source) + one bulk activity query, then
// hands it to the PURE `composeCrmReport` derivation (separately unit-tested).
import { supabase } from "../../lib/supabaseClient";
import {
  listProspects,
  listClients,
  listAssignableUsers,
  PROSPECT_STAGE_LABELS,
  CLIENT_STAGE_LABELS,
  STAGE_LABELS,
} from "../crmPipelineService";
import { inrFull, inrCompact } from "../../components/common/kit/format";

const DAY = 86400000;
const STALE_DAYS = 30; // "not contacted for 30+ days"
const STUCK_DAYS = 21; // "stuck in the same stage"

const daysSince = (dateLike, now = Date.now()) => {
  if (!dateLike) return null;
  const t = new Date(dateLike).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / DAY);
};
const fmtDate = (dateLike) => {
  if (!dateLike) return "—";
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const ownerName = (email, map) => {
  if (!email) return "Unassigned";
  if (map[email]) return map[email];
  const base = email.split("@")[0].replace(/[._-]+/g, " ");
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
};
const stageLabel = (acc) => {
  if (acc.account_type === "prospect") return PROSPECT_STAGE_LABELS[acc.prospect_stage] || STAGE_LABELS[acc.stage] || acc.prospect_stage || acc.stage || "—";
  if (acc.account_type === "client") return CLIENT_STAGE_LABELS[acc.client_stage] || acc.client_stage || "Active Client";
  return STAGE_LABELS[acc.stage] || acc.stage || "—";
};

// Predefined date ranges for the UI quick filters.
export function rangeFor(key, custom) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (key === "today") return { key, from: start, to: end, label: "Today" };
  if (key === "week") {
    const dow = (start.getDay() + 6) % 7; // Monday = 0
    start.setDate(start.getDate() - dow);
    return { key, from: start, to: end, label: "This week" };
  }
  if (key === "month") {
    start.setDate(1);
    return { key, from: start, to: end, label: "This month" };
  }
  if (key === "custom" && custom?.from && custom?.to) {
    const f = new Date(custom.from); f.setHours(0, 0, 0, 0);
    const t = new Date(custom.to); t.setHours(23, 59, 59, 999);
    return { key, from: f, to: t, label: `${fmtDate(f)} – ${fmtDate(t)}` };
  }
  return { key: "all", from: null, to: null, label: "All time" };
}

/**
 * PURE derivation — given raw rows, produce the Report object. No network.
 * @param accounts   crm_pipeline rows (prospects + clients)
 * @param activities crm_pipeline_activity rows (any order)
 * @param users      [{ email, full_name }]
 * @param range      { from, to, label } (Dates or null)
 * @param now        injectable clock (ms) for testing
 */
export function composeCrmReport({ accounts = [], activities = [], users = [], range, now = Date.now() } = {}) {
  const r = range || { from: null, to: null, label: "All time" };
  const userMap = {};
  (users || []).forEach((u) => { if (u.email) userMap[u.email] = u.full_name || u.email; });

  const actByAcc = new Map();
  for (const a of activities) {
    if (!actByAcc.has(a.pipeline_id)) actByAcc.set(a.pipeline_id, []);
    actByAcc.get(a.pipeline_id).push(a);
  }
  // newest-first within each account
  for (const list of actByAcc.values()) {
    list.sort((x, y) => new Date(y.activity_at).getTime() - new Date(x.activity_at).getTime());
  }

  const inRange = (dateLike) => {
    if (!r.from || !r.to) return true;
    const t = new Date(dateLike).getTime();
    return t >= new Date(r.from).getTime() && t <= new Date(r.to).getTime();
  };
  const today0 = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); })();

  const enriched = accounts.map((acc) => {
    const acts = actByAcc.get(acc.id) || [];
    const completed = acts.filter((a) => a.status === "completed" || a.completed_at);
    const lastAct = completed[0] || acts[0] || null;
    const lastContact = lastAct?.activity_at || acc.stage_entered_at || acc.created_at || null;
    const dsc = daysSince(lastContact, now);

    const openFollow = acts
      .filter((a) => a.next_follow_up_date && a.status !== "completed")
      .map((a) => a.next_follow_up_date)
      .sort();
    const nextFollow = acc.next_action_date || openFollow[0] || null;
    const nextFollowT = nextFollow ? new Date(nextFollow).getTime() : null;
    const overdue = nextFollowT != null && nextFollowT < today0;
    const dueToday = nextFollowT != null && nextFollowT >= today0 && nextFollowT < today0 + DAY;

    const inactive = acc.is_active === false;
    const stuckDays = daysSince(acc.stage_entered_at, now);
    const stuck = acc.account_type === "prospect" && stuckDays != null && stuckDays >= STUCK_DAYS;
    const stale = dsc != null && dsc >= STALE_DAYS;

    let status = "On Track";
    if (inactive) status = "Inactive";
    else if (overdue || stale) status = "Action Required";
    else if (dueToday) status = "Due Today";
    else if ((acc.account_type === "prospect" && (acc.value || 0) > 0) || completed.length) status = "In Progress";

    const lastActivityText = lastAct
      ? `${lastAct.subject || lastAct.activity_type || "Activity"}${lastAct.activity_at ? " · " + fmtDate(lastAct.activity_at) : ""}`
      : "No activity logged";
    const weighted = (Number(acc.value) || 0) * (Number(acc.probability) || 0) / 100;

    return {
      _acc: acc,
      _flags: { overdue, dueToday, stale, stuck, inactive, dsc, stuckDays, weighted, completedCount: completed.length, lastAct },
      company: acc.company_name || "—",
      type: acc.account_type === "client" ? "Client" : "Prospect",
      salesperson: ownerName(acc.owner_email, userMap),
      stage: stageLabel(acc),
      lastActivity: lastActivityText,
      nextAction: acc.next_action || (lastAct?.activity_type === "quotation" ? "Follow up on quotation" : "—"),
      nextFollowup: fmtDate(nextFollow),
      value: acc.value ? inrFull(acc.value) : "—",
      probability: acc.probability != null && acc.account_type === "prospect" ? `${acc.probability}%` : "—",
      daysSince: dsc == null ? "—" : `${dsc} day${dsc === 1 ? "" : "s"}`,
      status,
    };
  });

  enriched.sort((a, b) => {
    const aw = (a._flags.overdue ? 2 : 0) + (a._flags.stale ? 1 : 0);
    const bw = (b._flags.overdue ? 2 : 0) + (b._flags.stale ? 1 : 0);
    if (aw !== bw) return bw - aw;
    return (b._flags.weighted || 0) - (a._flags.weighted || 0);
  });

  const prospects = accounts.filter((a) => a.account_type === "prospect");
  const clients = accounts.filter((a) => a.account_type === "client");
  const clientsActive = clients.filter((c) => c.is_active !== false);
  const dueTodayCount = enriched.filter((e) => e._flags.dueToday).length;
  const overdueCount = enriched.filter((e) => e._flags.overdue).length;
  const pipelineValue = prospects.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const expectedConversion = prospects.reduce((s, p) => s + (Number(p.value) || 0) * (Number(p.probability) || 0) / 100, 0);
  const noActivity = enriched.filter((e) => !e._flags.completedCount).length;

  const kpis = [
    { label: "Total Prospects", value: prospects.length },
    { label: "Active Clients", value: clientsActive.length },
    { label: "Follow-ups Due Today", value: dueTodayCount },
    { label: "Overdue Follow-ups", value: overdueCount },
    { label: "Pipeline Value", value: inrCompact(pipelineValue) },
    { label: "Expected Conversion", value: inrCompact(expectedConversion) },
    { label: "Accounts w/o Activity", value: noActivity },
    { label: "Accounts in Report", value: enriched.length },
  ];

  const attentionRows = enriched
    .filter((e) => e._flags.overdue || e._flags.stale || e._flags.stuck || (e._flags.inactive && e._acc.owner_email))
    .map((e) => {
      const reasons = [];
      if (e._flags.overdue) reasons.push("Overdue follow-up");
      if (e._flags.stale) reasons.push(`No contact ${e._flags.dsc}d`);
      if (e._flags.stuck) reasons.push(`Stuck in stage ${e._flags.stuckDays}d`);
      if (e._flags.inactive && e._acc.owner_email) reasons.push("Assigned but inactive");
      return { company: e.company, type: e.type, salesperson: e.salesperson, stage: e.stage, issue: reasons.join("; "), daysSince: e.daysSince, nextFollowup: e.nextFollowup };
    });

  // Salesperson performance
  const perfMap = new Map();
  const ensure = (email) => {
    const key = email || "__unassigned__";
    if (!perfMap.has(key)) perfMap.set(key, { salesperson: ownerName(email, userMap), accounts: 0, clients: 0, meetings: 0, followupsDone: 0, pending: 0, pipeline: 0 });
    return perfMap.get(key);
  };
  for (const e of enriched) {
    const acc = e._acc;
    const p = ensure(acc.owner_email);
    p.accounts += 1;
    if (acc.account_type === "client") p.clients += 1;
    if (acc.account_type === "prospect") p.pipeline += Number(acc.value) || 0;
    if (e._flags.overdue || e._flags.dueToday) p.pending += 1;
    for (const a of actByAcc.get(acc.id) || []) {
      const when = a.completed_at || a.activity_at;
      const done = a.status === "completed" || a.completed_at;
      if (done && inRange(when)) {
        if (a.activity_type === "meeting") p.meetings += 1;
        p.followupsDone += 1;
      }
    }
  }
  const perfSorted = [...perfMap.values()].sort((a, b) => b.pipeline - a.pipeline);
  const perfRows = perfSorted.map((p) => ({
    salesperson: p.salesperson,
    accounts: p.accounts,
    meetings: p.meetings,
    followups: p.followupsDone,
    pending: p.pending,
    pipeline: inrFull(p.pipeline),
    conversion: p.accounts ? `${Math.round((p.clients / p.accounts) * 100)}%` : "—",
  }));
  const topOwner = perfSorted.find((p) => p.pipeline > 0) || null;

  // Actionable next steps
  const actions = [];
  enriched.filter((e) => e._flags.overdue).slice(0, 6).forEach((e) => actions.push(`Follow up with ${e.company} — overdue (${e.salesperson})`));
  enriched.filter((e) => /quotation/i.test(e.stage) && e._flags.dsc != null && e._flags.dsc >= 5).slice(0, 4)
    .forEach((e) => actions.push(`Chase quotation response from ${e.company} (${e._flags.dsc}d, ${e.salesperson})`));
  enriched.filter((e) => e._flags.stale && !e._flags.overdue).slice(0, 4)
    .forEach((e) => actions.push(`Re-engage dormant account ${e.company} — no contact ${e._flags.dsc}d`));
  enriched.filter((e) => !e._acc.owner_email).slice(0, 3)
    .forEach((e) => actions.push(`Assign an owner to ${e.company} (currently unassigned)`));

  // AI summary (heuristic narrative)
  const needFollowup = enriched.filter((e) => e._flags.overdue || e._flags.dueToday).length;
  const staleCount = enriched.filter((e) => e._flags.stale).length;
  const quotesPending = enriched.filter((e) => /quotation/i.test(e.stage) && e._flags.dsc != null && e._flags.dsc >= 3).length;
  const narrativeBits = [];
  narrativeBits.push(`${needFollowup} account${needFollowup === 1 ? "" : "s"} require immediate follow-up (${overdueCount} overdue, ${dueTodayCount} due today).`);
  if (staleCount) narrativeBits.push(`${staleCount} account${staleCount === 1 ? " has" : "s have"} not been contacted for more than ${STALE_DAYS} days.`);
  if (topOwner) narrativeBits.push(`${topOwner.salesperson} holds the highest pipeline value at ${inrFull(topOwner.pipeline)}.`);
  if (quotesPending) narrativeBits.push(`${quotesPending} quotation-stage account${quotesPending === 1 ? "" : "s"} are awaiting a response.`);
  narrativeBits.push(`Total open pipeline is ${inrCompact(pipelineValue)} across ${prospects.length} prospects, with ${inrCompact(expectedConversion)} weighted by probability.`);
  const narrative = narrativeBits.join(" ");

  const actionReportRows = enriched.map(({ _acc, _flags, ...clean }) => clean);

  return {
    key: "crm-action",
    title: "CRM Action Report",
    subtitle: "Reyansh International",
    generatedAt: new Date(now),
    dateRange: { label: r.label, from: r.from, to: r.to },
    kpis,
    narrative,
    actions,
    sections: [
      {
        key: "accounts",
        title: "CRM Action Report — All Accounts",
        columns: [
          { key: "company", label: "Company" },
          { key: "type", label: "Type" },
          { key: "salesperson", label: "Salesperson" },
          { key: "stage", label: "Stage" },
          { key: "lastActivity", label: "Last Activity" },
          { key: "nextAction", label: "Next Action" },
          { key: "nextFollowup", label: "Next Follow-up" },
          { key: "value", label: "Value" },
          { key: "probability", label: "Prob." },
          { key: "daysSince", label: "Days Since Contact" },
          { key: "status", label: "Status" },
        ],
        rows: actionReportRows,
        emptyText: "No accounts in the pipeline.",
      },
      {
        key: "attention",
        title: "Attention Required",
        columns: [
          { key: "company", label: "Company" },
          { key: "type", label: "Type" },
          { key: "salesperson", label: "Salesperson" },
          { key: "stage", label: "Stage" },
          { key: "issue", label: "Issue" },
          { key: "daysSince", label: "Days Since Contact" },
          { key: "nextFollowup", label: "Next Follow-up" },
        ],
        rows: attentionRows,
        emptyText: "🎉 Nothing needs attention — every account is on track.",
      },
      {
        key: "salesperson",
        title: "Salesperson Performance",
        columns: [
          { key: "salesperson", label: "Salesperson" },
          { key: "accounts", label: "Accounts" },
          { key: "meetings", label: "Meetings (period)" },
          { key: "followups", label: "Activities (period)" },
          { key: "pending", label: "Pending Actions" },
          { key: "pipeline", label: "Pipeline Value" },
          { key: "conversion", label: "Conversion" },
        ],
        rows: perfRows,
        emptyText: "No salesperson activity.",
      },
    ],
  };
}

export async function buildCrmActionReport({ range } = {}) {
  const r = range || rangeFor("month");
  const [prospects, clients, users] = await Promise.all([
    listProspects(),
    listClients(),
    listAssignableUsers().catch(() => []),
  ]);
  const accounts = [...(prospects || []), ...(clients || [])];
  const ids = accounts.map((a) => a.id);

  let activities = [];
  if (ids.length) {
    const { data } = await supabase
      .from("crm_pipeline_activity")
      .select("pipeline_id, activity_type, subject, status, activity_at, next_follow_up_date, completed_at")
      .in("pipeline_id", ids)
      .order("activity_at", { ascending: false });
    activities = data || [];
  }
  return composeCrmReport({ accounts, activities, users, range: r });
}
