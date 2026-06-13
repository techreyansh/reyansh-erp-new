/**
 * Executive dashboard aggregator.
 *
 * Pulls live data from every department's Supabase tables in parallel and
 * reduces it to the KPIs / chart series the Executive Dashboard renders.
 * Each table fetch is isolated: a missing table or an RLS denial degrades that
 * one metric to empty instead of breaking the whole dashboard.
 */
import { supabase } from '../lib/supabaseClient';

const num = (v) => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const norm = (v) => (v == null || v === '' ? 'Unknown' : String(v).trim());

const monthKey = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
};

const countBy = (arr, fn) => {
  const m = new Map();
  arr.forEach((x) => {
    const k = fn(x);
    if (k == null) return;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
};

const sumBy = (arr, fn) => arr.reduce((acc, x) => acc + num(fn(x)), 0);

const pairs = (map, { sort = true, limit } = {}) => {
  let out = Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  if (sort) out.sort((a, b) => b.value - a.value);
  if (limit && out.length > limit) {
    const head = out.slice(0, limit);
    const rest = out.slice(limit).reduce((a, x) => a + x.value, 0);
    if (rest > 0) head.push({ name: 'Others', value: rest });
    return head;
  }
  return out;
};

async function fetchAll(table, columns = '*') {
  try {
    const { data, error } = await supabase.from(table).select(columns);
    if (error) {
      console.warn(`[executiveDashboard] ${table}:`, error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn(`[executiveDashboard] ${table} threw:`, e?.message || e);
    return [];
  }
}

/** First token of a dispatch status like "COMPLETED|2025-10-08|2025-10-15". */
function dispatchStatusOf(row) {
  const raw = row?.status || row?.record?.dispatchStatus || '';
  const token = String(raw).split('|')[0].trim();
  return token ? token.toUpperCase() : 'NEW';
}

function buildMonthBuckets(count = 12) {
  const now = new Date();
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-US', { month: 'short' }),
      ordered: 0,
      collected: 0,
    });
  }
  return months;
}

export async function getExecutiveSummary() {
  const [
    clients,
    prospects,
    vendors,
    dispatches,
    purchases,
    leads,
    orders,
    payments,
    quotations,
    boms,
    materialIssues,
    users,
    tasks,
  ] = await Promise.all([
    fetchAll('clients2'),
    fetchAll('prospects_clients'),
    fetchAll('vendors_data'),
    fetchAll('dispatches'),
    fetchAll('purchase_flow_data'),
    fetchAll('sales_flow_data'),
    fetchAll('client_orders_data'),
    fetchAll('client_payments_data'),
    fetchAll('client_quotations_data'),
    fetchAll('company_bom_data'),
    fetchAll('material_issue_data'),
    fetchAll('users'),
    fetchAll('tasks'),
  ]);

  // ---- Revenue & sales -----------------------------------------------------
  const orderBook = sumBy(orders, (o) => o.TotalAmount);
  const isPaid = (p) => /paid|complete|success/i.test(String(p.Status || ''));
  const collected = sumBy(payments.filter(isPaid), (p) => p.Amount);
  const outstanding = Math.max(orderBook - collected, 0);
  const quotedValue = sumBy(quotations, (q) => q.TotalAmount);
  const openQuotes = quotations.filter((q) => /active|open|sent/i.test(String(q.Status || '')));
  const openQuoteValue = sumBy(openQuotes, (q) => q.TotalAmount);

  const months = buildMonthBuckets(12);
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  orders.forEach((o) => {
    const idx = monthIndex.get(monthKey(o.OrderDate));
    if (idx != null) months[idx].ordered += num(o.TotalAmount);
  });
  payments.filter(isPaid).forEach((p) => {
    const idx = monthIndex.get(monthKey(p.PaymentDate));
    if (idx != null) months[idx].collected += num(p.Amount);
  });

  // ---- Operations ----------------------------------------------------------
  const dispatchByStatus = pairs(countBy(dispatches, dispatchStatusOf));
  const pendingDispatch = dispatches.filter((d) => dispatchStatusOf(d) !== 'COMPLETED').length;

  const activeLeads = leads.filter((l) => !/closed|won|lost|complete/i.test(String(l.Status || ''))).length;

  const procurementSpend = sumBy(purchases, (p) => p.FinalAmount || p.Budget);
  const activePurchases = purchases.filter((p) => !/complete|closed|cancel/i.test(String(p.Status || ''))).length;

  // ---- Distributions -------------------------------------------------------
  const clientsByState = pairs(countBy(clients, (c) => norm(c.State || c.state)), { limit: 8 });
  const ordersByStatus = pairs(countBy(orders, (o) => norm(o.Status)));
  const vendorsByCategory = pairs(countBy(vendors, (v) => norm(v.Category)), { limit: 6 });
  const procurementByStatus = pairs(countBy(purchases, (p) => norm(p.Status)));
  const leadsByQualification = pairs(countBy(leads, (l) => norm(l.QualificationStatus)));
  const tasksByStatus = pairs(countBy(tasks, (t) => norm(t.task_status)));

  const activeUsers = users.filter((u) => u.is_active !== false).length;

  const salesFunnel = [
    { name: 'Quoted', value: Math.round(quotedValue) },
    { name: 'Ordered', value: Math.round(orderBook) },
    { name: 'Collected', value: Math.round(collected) },
  ];

  // ---- Customer revenue concentration --------------------------------------
  // Aggregate order value per client so we can surface the top accounts and the
  // revenue-concentration risk (over-reliance on one or two customers).
  const revenueByClient = new Map();
  orders.forEach((o) => {
    const key = norm(o.ClientName || o.ClientCode);
    if (key === 'Unknown') return;
    revenueByClient.set(key, (revenueByClient.get(key) || 0) + num(o.TotalAmount));
  });
  const topCustomers = pairs(revenueByClient, { limit: 5 }).filter((c) => c.name !== 'Others');
  const totalClientRevenue = sumBy(Array.from(revenueByClient.values()), (v) => v) || orderBook;
  const top1Share = topCustomers[0] && totalClientRevenue > 0
    ? topCustomers[0].value / totalClientRevenue
    : 0;
  const top3Share = totalClientRevenue > 0
    ? topCustomers.slice(0, 3).reduce((a, c) => a + c.value, 0) / totalClientRevenue
    : 0;
  const concentration = {
    top1Name: topCustomers[0]?.name || null,
    top1Share,
    top3Share,
    customerCount: revenueByClient.size,
  };

  const blockedTasks = tasks.filter((t) => /block/i.test(String(t.task_status || ''))).length;
  const overdueTasks = tasks.filter((t) => {
    const due = t.due_date ? new Date(t.due_date) : null;
    const done = /complete|done/i.test(String(t.task_status || ''));
    return due && !done && due.getTime() < Date.now();
  }).length;

  // ---- Department snapshot rows -------------------------------------------
  const departments = [
    {
      key: 'sales',
      name: 'Sales',
      metric: orders.length,
      metricLabel: 'orders',
      secondary: orderBook,
      secondaryMoney: true,
      health: outstanding > collected ? 'warn' : 'ok',
    },
    {
      key: 'crm',
      name: 'CRM',
      metric: clients.length,
      metricLabel: 'clients',
      secondary: `${prospects.length} prospects`,
      health: 'ok',
    },
    {
      key: 'procurement',
      name: 'Procurement',
      metric: activePurchases,
      metricLabel: 'active POs',
      secondary: `${vendors.length} vendors`,
      health: 'ok',
    },
    {
      key: 'production',
      name: 'Production',
      metric: boms.length,
      metricLabel: 'BOMs',
      secondary: `${materialIssues.length} issues`,
      health: 'ok',
    },
    {
      key: 'dispatch',
      name: 'Dispatch',
      metric: dispatches.length,
      metricLabel: 'total',
      secondary: `${pendingDispatch} pending`,
      health: pendingDispatch > 0 ? 'warn' : 'ok',
    },
    {
      key: 'workforce',
      name: 'Workforce',
      metric: activeUsers,
      metricLabel: 'active users',
      secondary: `${users.length} total`,
      health: 'ok',
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      orderBook,
      collected,
      outstanding,
      openQuoteValue,
      clients: clients.length,
      prospects: prospects.length,
      vendors: vendors.length,
      procurementSpend,
      pendingDispatch,
      dispatchTotal: dispatches.length,
      activeLeads,
      team: activeUsers,
      boms: boms.length,
    },
    revenueTrend: months,
    ordersByStatus,
    dispatchByStatus,
    clientsByState,
    vendorsByCategory,
    procurementByStatus,
    leadsByQualification,
    tasksByStatus,
    salesFunnel,
    topCustomers,
    concentration,
    taskRisk: { blocked: blockedTasks, overdue: overdueTasks, total: tasks.length },
    departments,
    recentOrders: [...orders]
      .sort((a, b) => new Date(b.OrderDate || 0) - new Date(a.OrderDate || 0))
      .slice(0, 6)
      .map((o) => ({
        id: o.id || o.Id || o.OrderNumber,
        client: o.ClientCode || '—',
        number: o.OrderNumber || '—',
        date: o.OrderDate || null,
        amount: num(o.TotalAmount),
        status: norm(o.Status),
      })),
  };
}

const executiveDashboardService = { getExecutiveSummary };
export default executiveDashboardService;
