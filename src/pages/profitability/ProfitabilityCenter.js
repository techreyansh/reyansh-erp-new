import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Card, CardContent, Typography, Stack, Button, IconButton, Chip, Divider, Tabs, Tab,
  TextField, MenuItem, ToggleButtonGroup, ToggleButton, Table, TableHead, TableRow, TableCell,
  TableBody, TableContainer, Paper, CircularProgress, Alert, Tooltip, Autocomplete, Snackbar,
  useTheme, alpha,
} from "@mui/material";
import {
  InsightsOutlined, RefreshOutlined, ScienceOutlined, WarningAmberOutlined, AddOutlined,
  DeleteOutline, CloudDownloadOutlined, DeleteSweepOutlined,
} from "@mui/icons-material";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Cell,
} from "recharts";
import KPICard from "../../components/common/KPICard";
import ReportExportButton from "../../components/common/ReportExportButton";
import profitabilityService from "../../services/profitabilityService";

const iso = (d) => d.toISOString().slice(0, 10);
const money = (v) => "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const pct = (v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);

// Indian FY start (Apr 1)
function fyStart(d = new Date()) { const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return new Date(y, 3, 1); }
function preset(key) {
  const now = new Date(); const t = new Date(now); t.setHours(0, 0, 0, 0);
  const d = (n) => { const x = new Date(t); x.setDate(x.getDate() + n); return x; };
  switch (key) {
    case "today": return [t, t];
    case "yesterday": return [d(-1), d(-1)];
    case "this_week": { const s = d(-(t.getDay() === 0 ? 6 : t.getDay() - 1)); return [s, t]; }
    case "last_week": { const s = d(-(t.getDay() === 0 ? 6 : t.getDay() - 1) - 7); const e = new Date(s); e.setDate(e.getDate() + 6); return [s, e]; }
    case "this_month": return [new Date(t.getFullYear(), t.getMonth(), 1), t];
    case "last_month": return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)];
    case "quarter": { const q = Math.floor(t.getMonth() / 3) * 3; return [new Date(t.getFullYear(), q, 1), t]; }
    case "fy": return [fyStart(t), t];
    default: return [new Date(t.getFullYear(), t.getMonth() - 11, 1), t];
  }
}
const PRESETS = [["fy", "FY"], ["this_month", "This month"], ["last_month", "Last month"], ["quarter", "Quarter"], ["this_week", "This week"], ["today", "Today"]];

function ProfitTable({ rows, cols, onRow, exportTitle }) {
  const theme = useTheme();
  if (!rows || rows.length === 0) return <Typography variant="caption" color="text.secondary">No data in range.</Typography>;
  return (
    <Box>
      {exportTitle && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
          <ReportExportButton buildReport={() => ({
            key: exportTitle.toLowerCase().replace(/\s+/g, "-"), title: exportTitle,
            subtitle: "Profitability Intelligence Center — CONFIDENTIAL",
            sections: [{ key: "t", title: exportTitle, columns: cols.map((c) => ({ key: c.k, label: c.h, align: c.align })), rows }],
          })} />
        </Box>
      )}
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, overflowX: "auto" }}>
        <Table size="small">
          <TableHead><TableRow>{cols.map((c) => <TableCell key={c.k} align={c.align || "left"} sx={{ fontWeight: 700, fontSize: "0.72rem", whiteSpace: "nowrap" }}>{c.h}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i} hover sx={{ cursor: onRow ? "pointer" : "default", bgcolor: r.gross_profit < 0 ? alpha(theme.palette.error.main, 0.06) : "inherit" }} onClick={() => onRow && onRow(r)}>
                {cols.map((c) => <TableCell key={c.k} align={c.align || "left"} sx={{ whiteSpace: "nowrap", fontWeight: c.bold ? 700 : 400, color: c.k === "gross_profit" && r.gross_profit < 0 ? "error.main" : "inherit" }}>{c.fmt ? c.fmt(r[c.k], r) : r[c.k]}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default function ProfitabilityCenter() {
  const theme = useTheme();
  const today = new Date();
  const [tab, setTab] = useState(0);
  const [[from, to], setRange] = useState(() => preset("fy").map(iso));
  const [basis, setBasis] = useState("ordered");
  const [filters, setFilters] = useState({});
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [snack, setSnack] = useState(null);
  const [busy, setBusy] = useState(false);
  // master data tabs
  const [heads, setHeads] = useState([]);
  const [exp, setExp] = useState([]);
  const [overrides, setOverrides] = useState([]);
  // what-if
  const [levers, setLevers] = useState({ copperPct: 0, pvcPct: 0, conversionPct: 0, sellingPricePct: 0 });

  const notify = (m, s = "info") => setSnack({ m, s });

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await profitabilityService.summary({ from, to, basis, filters })); }
    catch (e) { notify(e.message || "Load failed", "error"); setData(null); }
    finally { setLoading(false); }
  }, [from, to, basis, filters]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { profitabilityService.costHeads().then(setHeads).catch(() => {}); profitabilityService.overrides().then(setOverrides).catch(() => {}); }, []);

  const k = data?.kpis || {};
  const byProduct = data?.by_product || [];
  const lossMaking = useMemo(() => byProduct.filter((p) => p.gross_profit < 0), [byProduct]);
  const topMargin = useMemo(() => [...byProduct].filter((p) => p.gm_pct != null).sort((a, b) => b.gm_pct - a.gm_pct).slice(0, 8), [byProduct]);
  const lowMargin = useMemo(() => [...byProduct].filter((p) => p.gm_pct != null).sort((a, b) => a.gm_pct - b.gm_pct).slice(0, 8), [byProduct]);
  const waterfall = useMemo(() => [
    { name: "Revenue", v: k.revenue || 0, c: theme.palette.primary.main },
    { name: "− Material", v: -(k.material || 0), c: theme.palette.warning.main },
    { name: "− Conversion", v: -(k.conversion || 0), c: theme.palette.info.main },
    { name: "Gross Profit", v: k.gross_profit || 0, c: theme.palette.success.main },
  ], [k, theme]);
  const wf = data?.whatif;

  const runDemo = async (fn, msg) => { setBusy(true); try { await fn(); notify(msg, "success"); await load(); } catch (e) { notify(e.message || "Failed", "error"); } finally { setBusy(false); } };

  const moneyCol = (v) => money(v);
  const customerCols = [
    { k: "name", h: "Customer", bold: true, fmt: (v, r) => v || r.code }, { k: "revenue", h: "Revenue", align: "right", fmt: moneyCol },
    { k: "material", h: "Material", align: "right", fmt: moneyCol }, { k: "conversion", h: "Production", align: "right", fmt: moneyCol },
    { k: "gross_profit", h: "Gross Profit", align: "right", bold: true, fmt: moneyCol }, { k: "gm_pct", h: "GM %", align: "right", fmt: pct },
    { k: "orders", h: "Orders", align: "right" }, { k: "products", h: "Products", align: "right" },
  ];
  const productCols = [
    { k: "name", h: "Product", bold: true, fmt: (v, r) => v || r.code }, { k: "family", h: "Family" }, { k: "revenue", h: "Revenue", align: "right", fmt: moneyCol },
    { k: "material", h: "Material", align: "right", fmt: moneyCol }, { k: "conversion", h: "Conversion", align: "right", fmt: moneyCol },
    { k: "gross_profit", h: "Gross Profit", align: "right", bold: true, fmt: moneyCol }, { k: "gm_pct", h: "GM %", align: "right", fmt: pct },
    { k: "qty", h: "Qty", align: "right" }, { k: "customers", h: "Customers", align: "right" },
  ];
  const orderCols = [
    { k: "so_number", h: "Order", bold: true }, { k: "company_name", h: "Customer" }, { k: "revenue", h: "Sales value", align: "right", fmt: moneyCol },
    { k: "material", h: "Material", align: "right", fmt: moneyCol }, { k: "conversion", h: "Mfg", align: "right", fmt: moneyCol },
    { k: "gross_profit", h: "Gross Profit", align: "right", bold: true, fmt: moneyCol }, { k: "gm_pct", h: "GM %", align: "right", fmt: pct },
  ];
  const execCols = [
    { k: "name", h: "Sales exec", bold: true }, { k: "revenue", h: "Revenue", align: "right", fmt: moneyCol },
    { k: "gross_profit", h: "Gross Profit", align: "right", bold: true, fmt: moneyCol }, { k: "gm_pct", h: "GM %", align: "right", fmt: pct }, { k: "orders", h: "Orders", align: "right" },
  ];

  return (
    <Box sx={{ pb: 4 }}>
      {/* Header */}
      <Box sx={{ px: 3, pt: 2, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <InsightsOutlined sx={{ color: theme.palette.primary.main, fontSize: 30 }} />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>Profitability Intelligence Center</Typography>
            <Typography variant="caption" color="text.secondary">Gross-profit decision engine · CEO confidential</Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<CloudDownloadOutlined />} disabled={busy} onClick={() => runDemo(profitabilityService.seedDemo, "Demo data loaded.")}>Load demo</Button>
          <Button size="small" variant="outlined" color="error" startIcon={<DeleteSweepOutlined />} disabled={busy} onClick={() => runDemo(profitabilityService.clearDemo, "Demo data cleared.")}>Clear demo</Button>
        </Stack>
      </Box>

      {/* Controls */}
      <Box sx={{ px: 3, pt: 2, display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
        <Stack direction="row" spacing={0.5}>{PRESETS.map(([key, lbl]) => <Button key={key} size="small" variant="outlined" onClick={() => setRange(preset(key).map(iso))}>{lbl}</Button>)}</Stack>
        <TextField type="date" size="small" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setRange([e.target.value, to])} />
        <TextField type="date" size="small" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setRange([from, e.target.value])} />
        <ToggleButtonGroup size="small" exclusive value={basis} onChange={(_, v) => v && setBasis(v)}>
          <ToggleButton value="ordered">Ordered</ToggleButton>
          <ToggleButton value="realized">Realized</ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="Refresh"><span><IconButton onClick={load} disabled={loading}><RefreshOutlined /></IconButton></span></Tooltip>
      </Box>

      {(k.uncosted_lines > 0) && (
        <Box sx={{ px: 3, pt: 1.5 }}>
          <Alert severity="warning" icon={<WarningAmberOutlined />}>{k.uncosted_lines} line(s) ({money(k.uncosted_revenue)} revenue) have no costing — GP excludes them. Add a manual cost in <b>Cost Heads → Overrides</b>.</Alert>
        </Box>
      )}

      {/* KPI row */}
      <Box sx={{ px: 3, pt: 2, display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3,1fr)", lg: "repeat(6,1fr)" } }}>
        <KPICard title="Revenue" value={money(k.revenue)} variant="gradient" color="primary" />
        <KPICard title="Material" value={money(k.material)} variant="gradient" color="warning" />
        <KPICard title="Conversion" value={money(k.conversion)} variant="gradient" color="info" />
        <KPICard title="Gross Profit" value={money(k.gross_profit)} variant="gradient" color={k.gross_profit < 0 ? "error" : "success"} />
        <KPICard title="Gross Margin" value={pct(k.gm_pct)} variant="gradient" color="success" />
        <KPICard title="Orders" value={k.orders || 0} subtitle={`${k.lines || 0} lines`} variant="gradient" color="secondary" />
      </Box>

      <Box sx={{ px: 3, mt: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
          {["Dashboard", "Customers", "Products", "Orders", "Sales execs", "Cost heads", "Expenses", "What-if"].map((t) => <Tab key={t} label={t} />)}
        </Tabs>
      </Box>

      <Box sx={{ px: 3, pt: 2 }}>
        {loading ? <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box> : (
          <>
            {/* DASHBOARD */}
            {tab === 0 && (
              <Stack spacing={2}>
                <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
                  <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Profit waterfall</Typography>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={waterfall}><CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} /><RTooltip formatter={(v) => money(Math.abs(v))} />
                        <Bar dataKey="v" radius={[4, 4, 0, 0]}>{waterfall.map((e, i) => <Cell key={i} fill={e.c} />)}</Bar></BarChart>
                    </ResponsiveContainer>
                  </CardContent></Card>
                  <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Revenue vs Gross Profit — monthly</Typography>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={data?.by_month || []}><CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.08)} /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} /><RTooltip formatter={(v) => money(v)} />
                        <Line type="monotone" dataKey="revenue" name="Revenue" stroke={theme.palette.primary.main} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="gross_profit" name="Gross Profit" stroke={theme.palette.success.main} strokeWidth={2} dot={false} /></LineChart>
                    </ResponsiveContainer>
                  </CardContent></Card>
                </Box>
                <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
                  <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Top customers</Typography><ProfitTable rows={(data?.by_customer || []).slice(0, 10)} cols={customerCols} /></CardContent></Card>
                  <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Top products</Typography><ProfitTable rows={byProduct.slice(0, 10)} cols={productCols} /></CardContent></Card>
                  <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: "error.main" }}>Loss-making products</Typography><ProfitTable rows={lossMaking} cols={productCols} /></CardContent></Card>
                  <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent><Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Lowest-margin products</Typography><ProfitTable rows={lowMargin} cols={productCols} /></CardContent></Card>
                </Box>
                <Alert severity="info">Conversion cost is the <b>standard</b> costing estimate (no rupee actuals captured on the floor yet). Sales-exec = the order's current owner.</Alert>
              </Stack>
            )}
            {tab === 1 && <ProfitTable rows={data?.by_customer} cols={customerCols} exportTitle="Customer Profitability" />}
            {tab === 2 && <ProfitTable rows={byProduct} cols={productCols} exportTitle="Product Profitability" />}
            {tab === 3 && <ProfitTable rows={data?.by_order} cols={orderCols} exportTitle="Order Profitability" />}
            {tab === 4 && <ProfitTable rows={data?.by_sales_exec} cols={execCols} exportTitle="Sales Executive Profitability" />}
            {tab === 5 && <CostHeadsTab heads={heads} setHeads={setHeads} overrides={overrides} setOverrides={setOverrides} needsCosting={data?.needs_costing || []} notify={notify} onChanged={load} />}
            {tab === 6 && <ExpensesTab notify={notify} />}
            {tab === 7 && <WhatIfTab data={data} levers={levers} setLevers={setLevers} />}
          </>
        )}
      </Box>

      <Snackbar open={Boolean(snack)} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {snack ? <Alert severity={snack.s} onClose={() => setSnack(null)}>{snack.m}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

// ---- Cost Heads + overrides ----
function CostHeadsTab({ heads, setHeads, overrides, setOverrides, needsCosting, notify, onChanged }) {
  const [edit, setEdit] = useState({ name: "", code: "", cost_group: "material", costing_section: "", is_enabled: true, sort_order: 100 });
  const save = async () => {
    if (!edit.name) { notify("Name required", "warning"); return; }
    try { await profitabilityService.saveCostHead(edit); setHeads(await profitabilityService.costHeads()); setEdit({ name: "", code: "", cost_group: "material", costing_section: "", is_enabled: true, sort_order: 100 }); notify("Saved", "success"); }
    catch (e) { notify(e.message || "Save failed", "error"); }
  };
  const del = async (id) => { try { await profitabilityService.deleteCostHead(id); setHeads(await profitabilityService.costHeads()); } catch (e) { notify(e.message, "error"); } };
  const saveOverride = async (productId, mat, conv) => {
    try { await profitabilityService.saveOverride({ product_id: productId, material_per_unit: Number(mat) || 0, conversion_per_unit: Number(conv) || 0 }); notify("Override saved — refresh to apply", "success"); setOverrides(await profitabilityService.overrides()); onChanged(); }
    catch (e) { notify(e.message || "Failed", "error"); }
  };
  return (
    <Stack spacing={3}>
      <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Cost Head Master</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <TextField size="small" label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <TextField size="small" label="Code" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} sx={{ width: 130 }} />
          <TextField select size="small" label="Group" value={edit.cost_group} onChange={(e) => setEdit({ ...edit, cost_group: e.target.value })} sx={{ width: 150 }}>
            {["material", "conversion", "expense", "other"].map((g) => <MenuItem key={g} value={g}>{g}</MenuItem>)}
          </TextField>
          <Button variant="contained" startIcon={<AddOutlined />} onClick={save}>Add</Button>
        </Stack>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}><Table size="small">
          <TableHead><TableRow>{["Name", "Code", "Group", "Section", "Enabled", ""].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: "0.72rem" }}>{h}</TableCell>)}</TableRow></TableHead>
          <TableBody>{heads.map((h) => (
            <TableRow key={h.id} hover>
              <TableCell sx={{ fontWeight: 600 }}>{h.name}</TableCell><TableCell>{h.code}</TableCell><TableCell>{h.cost_group}</TableCell>
              <TableCell>{h.costing_section || "—"}</TableCell>
              <TableCell><Chip size="small" label={h.is_enabled ? "On" : "Off"} color={h.is_enabled ? "success" : "default"} variant="outlined" onClick={async () => { await profitabilityService.saveCostHead({ ...h, is_enabled: !h.is_enabled }); setHeads(await profitabilityService.costHeads()); }} /></TableCell>
              <TableCell><IconButton size="small" onClick={() => del(h.id)}><DeleteOutline fontSize="small" /></IconButton></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></TableContainer>
      </CardContent></Card>

      <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Manual cost override — uncosted products</Typography>
        <Typography variant="caption" color="text.secondary">Products with sales but no released costing. Enter per-unit material + conversion to bring them into gross profit.</Typography>
        {needsCosting.length === 0 ? <Typography variant="body2" sx={{ mt: 2 }} color="text.secondary">No uncosted products in range. 🎉</Typography> : (
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, mt: 1.5 }}><Table size="small">
            <TableHead><TableRow>{["Product", "Revenue", "Lines", "Material/unit", "Conversion/unit", ""].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: "0.72rem" }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>{needsCosting.map((p) => <OverrideRow key={p.product_id} p={p} existing={overrides.find((o) => o.product_id === p.product_id)} onSave={saveOverride} />)}</TableBody>
          </Table></TableContainer>
        )}
      </CardContent></Card>
    </Stack>
  );
}
function OverrideRow({ p, existing, onSave }) {
  const [mat, setMat] = useState(existing?.material_per_unit ?? "");
  const [conv, setConv] = useState(existing?.conversion_per_unit ?? "");
  return (
    <TableRow hover>
      <TableCell sx={{ fontWeight: 600 }}>{p.name || p.code}</TableCell><TableCell>{money(p.revenue)}</TableCell><TableCell>{p.lines}</TableCell>
      <TableCell><TextField size="small" type="number" value={mat} onChange={(e) => setMat(e.target.value)} sx={{ width: 100 }} /></TableCell>
      <TableCell><TextField size="small" type="number" value={conv} onChange={(e) => setConv(e.target.value)} sx={{ width: 100 }} /></TableCell>
      <TableCell><Button size="small" variant="outlined" onClick={() => onSave(p.product_id, mat, conv)}>Save</Button></TableCell>
    </TableRow>
  );
}

// ---- Expenses ----
function ExpensesTab({ notify }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ entry_date: iso(new Date()), expense_type: "factory", amount: "", note: "" });
  const load = useCallback(() => { profitabilityService.expenses().then(setRows).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => { if (!form.amount) { notify("Amount required", "warning"); return; } try { await profitabilityService.saveExpense({ ...form, amount: Number(form.amount) }); setForm({ ...form, amount: "", note: "" }); load(); notify("Saved", "success"); } catch (e) { notify(e.message, "error"); } };
  const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
  return (
    <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Expense log</Typography>
      <Typography variant="caption" color="text.secondary">Stored for reporting (V1 does not auto-allocate into gross profit).</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ my: 2 }}>
        <TextField type="date" size="small" label="Date" InputLabelProps={{ shrink: true }} value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
        <TextField select size="small" label="Type" value={form.expense_type} onChange={(e) => setForm({ ...form, expense_type: e.target.value })} sx={{ width: 140 }}>{["factory", "admin", "selling", "other"].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
        <TextField size="small" type="number" label="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} sx={{ width: 130 }} />
        <TextField size="small" label="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <Button variant="contained" startIcon={<AddOutlined />} onClick={save}>Add</Button>
        <Chip label={`Total: ${money(total)}`} color="primary" sx={{ alignSelf: "center", fontWeight: 700 }} />
      </Stack>
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}><Table size="small">
        <TableHead><TableRow>{["Date", "Type", "Amount", "Note", ""].map((h) => <TableCell key={h} sx={{ fontWeight: 700, fontSize: "0.72rem" }}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>{rows.map((r) => (
          <TableRow key={r.id} hover><TableCell>{r.entry_date}</TableCell><TableCell><Chip size="small" label={r.expense_type} variant="outlined" /></TableCell><TableCell>{money(r.amount)}</TableCell><TableCell>{r.note}</TableCell>
            <TableCell><IconButton size="small" onClick={async () => { await profitabilityService.deleteExpense(r.id); load(); }}><DeleteOutline fontSize="small" /></IconButton></TableCell></TableRow>
        ))}</TableBody>
      </Table></TableContainer>
    </CardContent></Card>
  );
}

// ---- What-if ----
function WhatIfTab({ data, levers, setLevers }) {
  const theme = useTheme();
  const res = useMemo(() => profitabilityService.whatIf(data, levers), [data, levers]);
  const lever = (key, label) => (
    <TextField key={key} size="small" type="number" label={label} value={levers[key]} onChange={(e) => setLevers({ ...levers, [key]: Number(e.target.value) })} sx={{ width: 150 }} InputProps={{ endAdornment: "%" }} />
  );
  return (
    <Stack spacing={2}>
      <Alert severity="info">Simulations only — actuals are never changed.</Alert>
      <Card variant="outlined" sx={{ borderRadius: 2.5 }}><CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Levers</Typography>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          {lever("copperPct", "Copper price")}{lever("pvcPct", "PVC price")}{lever("conversionPct", "Conversion cost")}{lever("sellingPricePct", "Selling price")}
          <Button variant="outlined" onClick={() => setLevers({ copperPct: 0, pvcPct: 0, conversionPct: 0, sellingPricePct: 0 })}>Reset</Button>
        </Stack>
      </CardContent></Card>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4,1fr)" } }}>
        <KPICard title="Revenue" value={money(res.revenue)} variant="minimal" color="primary" />
        <KPICard title="Material" value={money(res.material)} variant="minimal" color="warning" />
        <KPICard title="Conversion" value={money(res.conversion)} variant="minimal" color="info" />
        <KPICard title="Gross Profit" value={money(res.gross_profit)} subtitle={`${res.delta_gp >= 0 ? "+" : ""}${money(res.delta_gp)} vs actual · GM ${res.gm_pct}%`} variant="minimal" color={res.gross_profit < 0 ? "error" : "success"} />
      </Box>
    </Stack>
  );
}
