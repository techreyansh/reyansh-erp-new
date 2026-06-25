import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Skeleton,
  Snackbar,
  Alert,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import {
  AccountBalanceWalletOutlined,
  AddRounded,
  PaidOutlined,
  ReceiptLongOutlined,
  ReportProblemOutlined,
} from "@mui/icons-material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  listInvoices,
  dashboard as fetchDashboard,
  createInvoice,
  recordPayment,
} from "../../services/arService";
import { getCurrentUserEmail } from "../../services/crmPipelineService";

/* ---------- formatting helpers (reused from CRM dashboard patterns) ---------- */
function inrCompact(v) {
  const n = Number(v) || 0;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
}
const inrFull = (v) =>
  `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---------- shared widgets (mirror CRMDashboard StatCard / Panel) ---------- */
function StatCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2.5, height: "100%" }}>
      <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-start"
          spacing={1}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {label}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.5, lineHeight: 1.15 }}>
              {value}
            </Typography>
            {sub && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.25 }}
              >
                {sub}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              p: 1,
              borderRadius: 2,
              bgcolor: `${accent}1a`,
              color: accent,
              display: "flex",
            }}
          >
            <Icon />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function Panel({ title, subtitle, children, height = 300 }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2.5,
        p: { xs: 1.5, sm: 2 },
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>
      <Box sx={{ flex: 1, height }}>{children}</Box>
    </Paper>
  );
}

const Empty = ({ label = "No data yet" }) => (
  <Stack
    alignItems="center"
    justifyContent="center"
    sx={{ height: "100%", color: "text.disabled" }}
  >
    <Typography variant="body2">{label}</Typography>
  </Stack>
);

/* ---------- AR status chip ---------- */
function statusColor(arStatus, theme) {
  switch (arStatus) {
    case "overdue":
      return theme.palette.error.main;
    case "partial":
      return theme.palette.warning.main;
    case "paid":
      return theme.palette.success.main;
    default:
      return theme.palette.text.secondary; // 'due' / unknown
  }
}
function StatusChip({ arStatus }) {
  const theme = useTheme();
  const color = statusColor(arStatus, theme);
  const label = arStatus
    ? arStatus.charAt(0).toUpperCase() + arStatus.slice(1)
    : "—";
  if (arStatus === "due" || !arStatus) {
    return <Chip label={label} size="small" variant="outlined" />;
  }
  return (
    <Chip
      label={label}
      size="small"
      sx={{ bgcolor: `${color}1a`, color, fontWeight: 700 }}
    />
  );
}

/* ---------- New-invoice dialog ---------- */
function NewInvoiceDialog({ open, onClose, onSubmit, currentEmail }) {
  const blank = {
    customerName: "",
    customerCode: "",
    invoiceNumber: "",
    invoiceDate: todayISO(),
    amount: "",
    termsDays: "",
    poRef: "",
  };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.customerName.trim() && String(form.amount).trim();

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await onSubmit({ ...form, owner: currentEmail || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ fontWeight: 700 }}>New invoice</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Customer name"
            required
            value={form.customerName}
            onChange={set("customerName")}
            fullWidth
            autoFocus
          />
          <TextField
            label="Customer code"
            value={form.customerCode}
            onChange={set("customerCode")}
            fullWidth
            placeholder="optional"
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Invoice number"
              value={form.invoiceNumber}
              onChange={set("invoiceNumber")}
              fullWidth
              placeholder="auto if blank"
            />
            <TextField
              label="Invoice date"
              type="date"
              value={form.invoiceDate}
              onChange={set("invoiceDate")}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Amount"
              required
              type="number"
              value={form.amount}
              onChange={set("amount")}
              fullWidth
            />
            <TextField
              label="Terms (days)"
              type="number"
              value={form.termsDays}
              onChange={set("termsDays")}
              fullWidth
              placeholder="from customer / 30"
            />
          </Stack>
          <TextField
            label="PO reference"
            value={form.poRef}
            onChange={set("poRef")}
            fullWidth
            placeholder="optional"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving} color="inherit">
          Cancel
        </Button>
        <Button onClick={submit} disabled={!valid || saving} variant="contained">
          {saving ? "Saving…" : "Create invoice"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------- Record-payment dialog ---------- */
function RecordPaymentDialog({ open, invoice, onClose, onSubmit }) {
  const [form, setForm] = useState({
    amount: "",
    paidOn: todayISO(),
    method: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open && invoice) {
      setForm({
        amount: invoice.balance != null ? String(invoice.balance) : "",
        paidOn: todayISO(),
        method: "",
        note: "",
      });
    }
  }, [open, invoice]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = String(form.amount).trim();

  const submit = async () => {
    if (!valid || !invoice) return;
    setSaving(true);
    try {
      await onSubmit(invoice.id, form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle sx={{ fontWeight: 700 }}>
        Record payment
        {invoice && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {invoice.invoice_number} · {invoice.customer_name} · balance{" "}
            {inrFull(invoice.balance)}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Amount"
            required
            type="number"
            value={form.amount}
            onChange={set("amount")}
            fullWidth
            autoFocus
          />
          <TextField
            label="Paid on"
            type="date"
            value={form.paidOn}
            onChange={set("paidOn")}
            fullWidth
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Method"
            select
            value={form.method}
            onChange={set("method")}
            fullWidth
          >
            <MenuItem value="">—</MenuItem>
            <MenuItem value="NEFT">NEFT / RTGS</MenuItem>
            <MenuItem value="UPI">UPI</MenuItem>
            <MenuItem value="Cheque">Cheque</MenuItem>
            <MenuItem value="Cash">Cash</MenuItem>
            <MenuItem value="Other">Other</MenuItem>
          </TextField>
          <TextField
            label="Note"
            value={form.note}
            onChange={set("note")}
            fullWidth
            multiline
            minRows={2}
            placeholder="optional"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving} color="inherit">
          Cancel
        </Button>
        <Button onClick={submit} disabled={!valid || saving} variant="contained">
          {saving ? "Saving…" : "Record payment"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------- Page ---------- */
export default function CollectionsPage() {
  const theme = useTheme();
  const grid = theme.palette.divider;
  const axis = { fontSize: 12, fill: theme.palette.text.secondary };

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [email, setEmail] = useState(null);

  const [newOpen, setNewOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState(null);
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  const notify = (msg, severity = "success") =>
    setSnack({ open: true, msg, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, inv, em] = await Promise.all([
        fetchDashboard(),
        listInvoices(),
        getCurrentUserEmail(),
      ]);
      setSummary(d);
      setInvoices(Array.isArray(inv) ? inv : []);
      setEmail(em || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const agingData = useMemo(() => {
    const a = summary?.aging || {};
    return [
      { name: "Current", value: Number(a.current) || 0, fill: theme.palette.info.main },
      { name: "1-30", value: Number(a.d1_30) || 0, fill: theme.palette.warning.main },
      { name: "31-60", value: Number(a.d31_60) || 0, fill: theme.palette.error.light },
      { name: "61-90", value: Number(a.d61_90) || 0, fill: theme.palette.error.main },
      { name: "90+", value: Number(a.d90_plus) || 0, fill: theme.palette.error.dark },
    ];
  }, [summary, theme]);
  const hasAging = agingData.some((d) => d.value > 0);
  const topDebtors = summary?.top_debtors || [];

  const handleCreate = async (form) => {
    const res = await createInvoice({
      customerCode: form.customerCode,
      customerName: form.customerName,
      invoiceNumber: form.invoiceNumber,
      invoiceDate: form.invoiceDate,
      amount: form.amount,
      termsDays: form.termsDays,
      poRef: form.poRef,
      dispatchId: null,
      owner: form.owner,
    });
    if (res) {
      setNewOpen(false);
      notify("Invoice created");
      await load();
    } else {
      notify("Could not create invoice", "error");
    }
  };

  const handlePayment = async (invoiceId, form) => {
    const res = await recordPayment(invoiceId, {
      amount: form.amount,
      paidOn: form.paidOn,
      method: form.method,
      note: form.note,
    });
    if (res) {
      setPayInvoice(null);
      notify("Payment recorded");
      await load();
    } else {
      notify("Could not record payment", "error");
    }
  };

  const kpis = [
    {
      label: "Total Outstanding",
      value: inrCompact(summary?.total_outstanding),
      sub: `${summary?.invoice_count ?? 0} invoices`,
      icon: AccountBalanceWalletOutlined,
      accent: theme.palette.primary.main,
    },
    {
      label: "Overdue",
      value: inrCompact(summary?.overdue_amount),
      sub: `${summary?.overdue_count ?? 0} overdue`,
      icon: ReportProblemOutlined,
      accent: theme.palette.error.main,
    },
    {
      label: "Total Invoiced",
      value: inrCompact(summary?.total_invoiced),
      sub: "All time",
      icon: ReceiptLongOutlined,
      accent: theme.palette.primary.dark,
    },
    {
      label: "Total Received",
      value: inrCompact(summary?.total_received),
      sub: "Payments in",
      icon: PaidOutlined,
      accent: theme.palette.success.main,
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={1.5}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Payments &amp; Collections
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Receivables, aging &amp; payment follow-ups
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRounded />}
          onClick={() => setNewOpen(true)}
        >
          New invoice
        </Button>
      </Stack>

      {/* KPI row */}
      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4,1fr)" },
        }}
      >
        {loading && !summary
          ? [...Array(4)].map((_, i) => (
              <Skeleton key={i} variant="rounded" height={96} />
            ))
          : kpis.map((c) => <StatCard key={c.label} {...c} />)}
      </Box>

      {/* Aging + Top debtors */}
      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 3,
          gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" },
        }}
      >
        <Panel title="Aging" subtitle="Outstanding by days past due" height={300}>
          {loading && !summary ? (
            <Skeleton variant="rounded" height="100%" />
          ) : hasAging ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={agingData}
                margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={axis}
                  tickLine={false}
                  axisLine={{ stroke: grid }}
                />
                <YAxis
                  tick={axis}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={inrCompact}
                  width={62}
                />
                <RTooltip
                  formatter={(v) => inrFull(v)}
                  cursor={{ fill: `${theme.palette.primary.main}10` }}
                  contentStyle={{ borderRadius: 12, border: `1px solid ${grid}` }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={48}>
                  {agingData.map((e) => (
                    <Cell key={e.name} fill={e.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty label="Nothing outstanding — all clear" />
          )}
        </Panel>

        <Panel title="Top debtors" subtitle="Largest outstanding balances" height={300}>
          {loading && !summary ? (
            <Skeleton variant="rounded" height="100%" />
          ) : topDebtors.length ? (
            <Stack
              divider={<Divider />}
              sx={{ height: "100%", overflow: "auto", pr: 0.5 }}
            >
              {topDebtors.map((d, i) => (
                <Stack
                  key={d.customer_code || d.customer_name || i}
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  spacing={1}
                  sx={{ py: 1.1 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {d.customer_name || d.customer_code || "Customer"}
                    </Typography>
                    <Typography variant="caption" color="error.main">
                      {(Number(d.max_dpd) || 0)} d overdue
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 700, whiteSpace: "nowrap" }}
                  >
                    {inrCompact(d.outstanding)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Empty label="No outstanding debtors" />
          )}
        </Panel>
      </Box>

      {/* Invoice table */}
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Invoices
          </Typography>
          <Typography variant="caption" color="text.secondary">
            All receivables · soonest due first
          </Typography>
        </Box>
        <Divider />
        {loading && !invoices.length ? (
          <Box sx={{ p: 2 }}>
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} variant="rounded" height={44} sx={{ mb: 1 }} />
            ))}
          </Box>
        ) : invoices.length ? (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Invoice #</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell>Invoice date</TableCell>
                  <TableCell>Due date</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Received</TableCell>
                  <TableCell align="right">Balance</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Days past due</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {inv.invoice_number || "—"}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
                        {inv.customer_name || inv.customer_code || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>{fmtDate(inv.invoice_date)}</TableCell>
                    <TableCell>{fmtDate(inv.due_date)}</TableCell>
                    <TableCell align="right">{inrFull(inv.amount)}</TableCell>
                    <TableCell align="right">{inrFull(inv.amount_received)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {inrFull(inv.balance)}
                    </TableCell>
                    <TableCell>
                      <StatusChip arStatus={inv.ar_status} />
                    </TableCell>
                    <TableCell align="right">
                      {Number(inv.days_past_due) > 0 ? (
                        <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>
                          {inv.days_past_due}
                        </Typography>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={inv.ar_status === "paid"}
                        onClick={() => setPayInvoice(inv)}
                      >
                        Record payment
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Box sx={{ px: 2, py: 6, textAlign: "center", color: "text.secondary" }}>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              No invoices yet. Create your first invoice to start tracking
              collections.
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={() => setNewOpen(true)}
            >
              New invoice
            </Button>
          </Box>
        )}
      </Paper>

      <NewInvoiceDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSubmit={handleCreate}
        currentEmail={email}
      />
      <RecordPaymentDialog
        open={Boolean(payInvoice)}
        invoice={payInvoice}
        onClose={() => setPayInvoice(null)}
        onSubmit={handlePayment}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snack.severity}
          variant="filled"
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
