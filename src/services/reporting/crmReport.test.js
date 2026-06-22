// Verifies the PURE CRM report derivation against a realistic mock pipeline.
import { composeCrmReport } from "./crmReport";

const DAY = 86400000;
const NOW = new Date(2026, 5, 22, 12, 0, 0).getTime(); // 2026-06-22 12:00 local
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const ymd = (offsetDays) => {
  const d = new Date(NOW + offsetDays * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const users = [
  { email: "rahul@reyansh.com", full_name: "Rahul" },
  { email: "prashant@reyansh.com", full_name: "Prashant" },
];

const accounts = [
  // A1 prospect: overdue follow-up, last contact 8d ago, value 10L @70%
  { id: "A1", company_name: "ABC Appliances", account_type: "prospect", prospect_stage: "quotation_sent", owner_email: "rahul@reyansh.com", value: 1000000, probability: 70, is_active: true, stage_entered_at: iso(8), created_at: iso(20), next_action_date: ymd(-3), next_action: "Follow-up Call" },
  // A2 client: active, meeting completed 3d ago, follow-up due today
  { id: "A2", company_name: "XYZ Industries", account_type: "client", client_stage: "active", owner_email: "prashant@reyansh.com", value: 0, probability: null, is_active: true, stage_entered_at: iso(60), created_at: iso(200), next_action_date: ymd(0), next_action: "Send Revised Pricing" },
  // A3 prospect: no activity, stale + stuck (40d), unassigned
  { id: "A3", company_name: "PQR Industries", account_type: "prospect", prospect_stage: "lead", owner_email: null, value: 0, probability: 0, is_active: true, stage_entered_at: iso(40), created_at: iso(40), next_action_date: null },
  // A4 prospect: quotation stage, last contact 6d ago, value 5L @50%
  { id: "A4", company_name: "XYZ Electronics", account_type: "prospect", prospect_stage: "quotation_sent", owner_email: "rahul@reyansh.com", value: 500000, probability: 50, is_active: true, stage_entered_at: iso(6), created_at: iso(15), next_action_date: null },
  // A5 client: inactive but assigned
  { id: "A5", company_name: "LMN Pvt Ltd", account_type: "client", client_stage: "dormant", owner_email: "prashant@reyansh.com", value: 0, probability: null, is_active: false, stage_entered_at: iso(90), created_at: iso(300), next_action_date: null },
];

const activities = [
  { pipeline_id: "A1", activity_type: "call", subject: "Quotation Shared", status: "completed", activity_at: iso(8), completed_at: iso(8) },
  { pipeline_id: "A1", activity_type: "call", subject: "Follow up", status: "open", activity_at: iso(8), next_follow_up_date: ymd(-3) },
  { pipeline_id: "A2", activity_type: "meeting", subject: "Meeting Completed", status: "completed", activity_at: iso(3), completed_at: iso(3) },
  { pipeline_id: "A4", activity_type: "quotation", subject: "Quotation Sent", status: "completed", activity_at: iso(6), completed_at: iso(6) },
];

const range = { from: new Date(NOW - 30 * DAY), to: new Date(NOW + DAY), label: "This month" };

describe("composeCrmReport", () => {
  const report = composeCrmReport({ accounts, activities, users, range, now: NOW });
  const kpi = (label) => report.kpis.find((k) => k.label === label)?.value;
  const section = (key) => report.sections.find((s) => s.key === key);

  test("management summary KPIs", () => {
    expect(kpi("Total Prospects")).toBe(3); // A1,A3,A4
    expect(kpi("Active Clients")).toBe(1); // A2 (A5 inactive)
    expect(kpi("Overdue Follow-ups")).toBe(1); // A1
    expect(kpi("Follow-ups Due Today")).toBe(1); // A2
    expect(kpi("Pipeline Value")).toBe("₹15.00 L"); // 10L + 5L
    expect(kpi("Expected Conversion")).toBe("₹9.50 L"); // 7L + 2.5L
    expect(kpi("Accounts w/o Activity")).toBe(2); // A3, A5
    expect(kpi("Accounts in Report")).toBe(5);
  });

  test("action report has every account with the spec columns", () => {
    const acc = section("accounts");
    expect(acc.rows).toHaveLength(5);
    expect(acc.columns.map((c) => c.label)).toEqual(
      expect.arrayContaining(["Company", "Type", "Salesperson", "Stage", "Last Activity", "Next Action", "Next Follow-up", "Value", "Prob.", "Days Since Contact", "Status"])
    );
    const a1 = acc.rows.find((r) => r.company === "ABC Appliances");
    expect(a1.type).toBe("Prospect");
    expect(a1.salesperson).toBe("Rahul");
    expect(a1.value).toBe("₹10,00,000");
    expect(a1.probability).toBe("70%");
    expect(a1.daysSince).toBe("8 days");
    expect(a1.status).toBe("Action Required");
    const a2 = acc.rows.find((r) => r.company === "XYZ Industries");
    expect(a2.status).toBe("Due Today");
  });

  test("attention section flags the right accounts with reasons", () => {
    const att = section("attention");
    const names = att.rows.map((r) => r.company).sort();
    expect(names).toEqual(["ABC Appliances", "LMN Pvt Ltd", "PQR Industries"]); // overdue, inactive-assigned, stale+stuck
    expect(att.rows.find((r) => r.company === "ABC Appliances").issue).toMatch(/Overdue follow-up/);
    expect(att.rows.find((r) => r.company === "PQR Industries").issue).toMatch(/Stuck in stage/);
    expect(att.rows.find((r) => r.company === "LMN Pvt Ltd").issue).toMatch(/Assigned but inactive/);
  });

  test("salesperson performance rolls up by owner, top owner first", () => {
    const perf = section("salesperson");
    expect(perf.rows[0].salesperson).toBe("Rahul"); // highest pipeline
    expect(perf.rows[0].accounts).toBe(2); // A1 + A4
    expect(perf.rows[0].pipeline).toBe("₹15,00,000");
    const prashant = perf.rows.find((r) => r.salesperson === "Prashant");
    expect(prashant.accounts).toBe(2); // A2 + A5
    expect(prashant.meetings).toBe(1); // A2 meeting in range
  });

  test("actionable next-steps + AI summary", () => {
    expect(report.actions.some((a) => /Follow up with ABC Appliances/.test(a))).toBe(true);
    expect(report.actions.some((a) => /Chase quotation response from XYZ Electronics/.test(a))).toBe(true);
    expect(report.actions.some((a) => /Assign an owner to PQR Industries/.test(a))).toBe(true);
    expect(report.narrative).toMatch(/Rahul holds the highest pipeline value at ₹15,00,000/);
    expect(report.narrative).toMatch(/require immediate follow-up/);
  });
});
