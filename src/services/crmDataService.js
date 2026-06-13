/**
 * CRM ↔ ERP integration layer.
 *
 * The CRM screens render off the SAME live tables the rest of the ERP writes to,
 * so leads, customers, quotations, orders and collections reflect effortlessly:
 *   - Leads        ← sales_flow_data
 *   - Customers    ← clients2  (enriched with order/payment aggregates)
 *   - Quotations   ← client_quotations_data
 *   - Sales Orders ← client_orders_data
 *   - Collections  ← client_payments_data
 *
 * Every fetch is isolated; a missing table or RLS denial degrades that slice to
 * empty instead of breaking the CRM.
 */
import { supabase } from '../lib/supabaseClient';

const num = (v) => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const norm = (v) => (v == null || v === '' ? '' : String(v).trim());
const monthKey = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
};

async function fetchAll(table, columns = '*') {
  try {
    const { data, error } = await supabase.from(table).select(columns);
    if (error) {
      console.warn(`[crmDataService] ${table}:`, error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn(`[crmDataService] ${table} threw:`, e?.message || e);
    return [];
  }
}

function primaryContact(contacts) {
  if (!Array.isArray(contacts) || contacts.length === 0) return {};
  return contacts.find((c) => c?.isPrimary) || contacts[0] || {};
}

/** Heuristic 0–100 lead score from the sales-flow signals we actually have. */
function scoreLead(row) {
  let score = 30;
  const pr = String(row.Priority || '').toLowerCase();
  if (pr === 'high' || pr === 'urgent') score += 30;
  else if (pr === 'medium') score += 18;
  else if (pr === 'low') score += 6;
  const q = String(row.QualificationStatus || '').toLowerCase();
  if (/qualified|hot/.test(q)) score += 25;
  else if (/contacted|warm|progress/.test(q)) score += 12;
  score += Math.min(num(row.CurrentStep) * 3, 15);
  if (/breach|overdue/i.test(String(row.TATStatus || ''))) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function leadCategory(score) {
  if (score >= 70) return 'Hot';
  if (score >= 45) return 'Warm';
  return 'Cold';
}

const mapLead = (row) => {
  const score = scoreLead(row);
  return {
    id: row.id || row.LogId,
    companyName: norm(row.CompanyName) || norm(row.FullName) || '—',
    contactPerson: norm(row.FullName),
    phone: norm(row.PhoneNumber),
    email: norm(row.Email),
    source: norm(row.LeadSource) || 'Direct',
    productInterest: Array.isArray(row.ProductsInterested)
      ? row.ProductsInterested.join(', ')
      : norm(row.ProductsInterested),
    status: norm(row.QualificationStatus) || norm(row.Status) || 'New',
    priority: norm(row.Priority) || 'Medium',
    score,
    category: leadCategory(score),
    assignedSalesperson: norm(row.AssignedTo) || 'Unassigned',
    currentStep: num(row.CurrentStep),
    createdDate: (row.CreatedAt || row.created_at || '').slice(0, 10),
  };
};

export async function getCrmData() {
  const [clients, leadsRaw, orders, payments, quotations] = await Promise.all([
    fetchAll('clients2'),
    fetchAll('sales_flow_data'),
    fetchAll('client_orders_data'),
    fetchAll('client_payments_data'),
    fetchAll('client_quotations_data'),
  ]);

  // ---- Aggregate orders / payments by client code -------------------------
  const ordersByClient = new Map();
  orders.forEach((o) => {
    const code = norm(o.ClientCode);
    if (!ordersByClient.has(code)) ordersByClient.set(code, []);
    ordersByClient.get(code).push(o);
  });
  const paidByClient = new Map();
  payments.forEach((p) => {
    const code = norm(p.ClientCode);
    if (/paid|complete|success/i.test(String(p.Status || ''))) {
      paidByClient.set(code, (paidByClient.get(code) || 0) + num(p.Amount));
    }
  });

  const codeToName = new Map();
  clients.forEach((c) => codeToName.set(norm(c.ClientCode), norm(c.ClientName)));
  const clientName = (code) => codeToName.get(norm(code)) || norm(code) || '—';

  // ---- Customers (clients2 enriched) --------------------------------------
  const customers = clients.map((c) => {
    const code = norm(c.ClientCode);
    const contact = primaryContact(c.Contacts);
    const clientOrders = ordersByClient.get(code) || [];
    const orderValue = clientOrders.reduce((a, o) => a + num(o.TotalAmount), 0) || num(c.TotalValue);
    const activeOrders = clientOrders.filter(
      (o) => !/deliver|complete|cancel|closed/i.test(String(o.Status || ''))
    ).length;
    const collected = paidByClient.get(code) || 0;
    const outstanding = Math.max(orderValue - collected, 0);
    return {
      id: c.id,
      code,
      companyName: norm(c.ClientName) || '—',
      gstNumber: norm(c.GSTIN),
      contactPerson: norm(contact.name),
      phone: norm(contact.number),
      email: norm(contact.email),
      city: norm(c.City),
      state: norm(c.State),
      customerType: norm(c.BusinessType) || 'Standard',
      creditLimit: num(c.CreditLimit),
      activeOrders,
      totalValue: orderValue,
      outstandingAmount: outstanding,
      paymentStatus: outstanding > 0 ? 'Overdue' : 'On Time',
      rating: num(c.Rating),
      status: norm(c.Status) || 'Active',
    };
  });

  // ---- Quotations / Orders / Collections ----------------------------------
  const mappedQuotations = quotations.map((q) => ({
    id: q.id || q.Id,
    quotationNumber: norm(q.QuotationNumber) || '—',
    client: clientName(q.ClientCode),
    issueDate: (q.IssueDate || '').slice(0, 10),
    validUntil: (q.ValidUntil || '').slice(0, 10),
    amount: num(q.TotalAmount),
    status: norm(q.Status) || 'Draft',
  }));

  const mappedOrders = orders.map((o) => ({
    id: o.id || o.Id,
    orderNumber: norm(o.OrderNumber) || '—',
    client: clientName(o.ClientCode),
    orderDate: (o.OrderDate || '').slice(0, 10),
    amount: num(o.TotalAmount),
    items: Array.isArray(o.Items) ? o.Items.length : num(o.Items) || 0,
    status: norm(o.Status) || 'Pending',
  }));

  const mappedCollections = payments.map((p) => ({
    id: p.id || p.Id,
    client: clientName(p.ClientCode),
    orderId: norm(p.OrderId),
    amount: num(p.Amount),
    date: (p.PaymentDate || '').slice(0, 10),
    method: norm(p.Method) || '—',
    status: norm(p.Status) || 'Pending',
  }));

  const leads = leadsRaw.map(mapLead);

  // ---- Activity timeline (merged, most-recent first) ----------------------
  const timeline = [
    ...leads.map((l) => ({ type: 'Lead', title: `New lead: ${l.companyName}`, who: l.assignedSalesperson, date: l.createdDate, amount: null, status: l.status })),
    ...mappedOrders.map((o) => ({ type: 'Order', title: `Order ${o.orderNumber} · ${o.client}`, who: o.client, date: o.orderDate, amount: o.amount, status: o.status })),
    ...mappedQuotations.map((q) => ({ type: 'Quotation', title: `Quotation ${q.quotationNumber} · ${q.client}`, who: q.client, date: q.issueDate, amount: q.amount, status: q.status })),
    ...mappedCollections.map((p) => ({ type: 'Payment', title: `Payment ${p.method} · ${p.client}`, who: p.client, date: p.date, amount: p.amount, status: p.status })),
  ]
    .filter((e) => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 25);

  return {
    leads,
    customers,
    quotations: mappedQuotations,
    salesOrders: mappedOrders,
    collections: mappedCollections,
    timeline,
    summary: buildSummary({ leads, customers, mappedQuotations, mappedOrders, mappedCollections }),
    generatedAt: new Date().toISOString(),
  };
}

function buildSummary({ leads, customers, mappedQuotations, mappedOrders, mappedCollections }) {
  const groupSum = (arr, keyFn) => {
    const m = new Map();
    arr.forEach((x) => {
      const k = keyFn(x);
      if (!k) return;
      m.set(k, (m.get(k) || 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };

  const orderValue = mappedOrders.reduce((a, o) => a + o.amount, 0);
  const collected = mappedCollections
    .filter((p) => /paid|complete|success/i.test(p.status))
    .reduce((a, p) => a + p.amount, 0);
  const outstanding = Math.max(orderValue - collected, 0);
  const openQuoteValue = mappedQuotations
    .filter((q) => /active|open|sent|draft/i.test(q.status))
    .reduce((a, q) => a + q.amount, 0);

  const activeLeads = leads.filter((l) => !/won|lost|closed|converted/i.test(l.status)).length;
  const wonLeads = leads.filter((l) => /won|qualified|converted/i.test(l.status)).length;
  const conversionRate = leads.length ? Math.round((mappedOrders.length / leads.length) * 100) : 0;

  // Revenue trend (12 months)
  const now = new Date();
  const months = [];
  const idx = new Map();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    idx.set(key, months.length);
    months.push({ key, label: d.toLocaleString('en-US', { month: 'short' }), ordered: 0, collected: 0 });
  }
  mappedOrders.forEach((o) => {
    const i = idx.get(monthKey(o.orderDate));
    if (i != null) months[i].ordered += o.amount;
  });
  mappedCollections
    .filter((p) => /paid|complete|success/i.test(p.status))
    .forEach((p) => {
      const i = idx.get(monthKey(p.date));
      if (i != null) months[i].collected += p.amount;
    });

  const topCustomers = [...customers]
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 6)
    .map((c) => ({ name: c.companyName, value: c.totalValue, outstanding: c.outstandingAmount }));

  return {
    kpis: {
      totalLeads: leads.length,
      activeLeads,
      wonLeads,
      totalCustomers: customers.length,
      orderValue,
      collected,
      outstanding,
      openQuoteValue,
      conversionRate,
      openQuotations: mappedQuotations.filter((q) => /active|open|sent|draft/i.test(q.status)).length,
    },
    leadsBySource: groupSum(leads, (l) => l.source),
    leadsByCategory: groupSum(leads, (l) => l.category),
    pipelineByStatus: groupSum(leads, (l) => l.status),
    ordersByStatus: groupSum(mappedOrders, (o) => o.status),
    revenueTrend: months,
    topCustomers,
    funnel: [
      { name: 'Leads', value: leads.length },
      { name: 'Quotations', value: mappedQuotations.length },
      { name: 'Orders', value: mappedOrders.length },
      { name: 'Won', value: wonLeads },
    ],
  };
}

const crmDataService = { getCrmData };
export default crmDataService;
