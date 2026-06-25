// Production Plan Wizard (UX overhaul Wave 5). Turns plan creation into a guided
// 6-step flow — Select → Material → Capacity → Routing → Review → Release —
// instead of one dense form. Reuses the existing engine + services; the
// scheduling/MRP math is unchanged.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Paper, Stepper, Step, StepLabel, Typography, Button, Stack, TextField, MenuItem,
  Autocomplete, Grid, Chip, Table, TableHead, TableBody, TableRow, TableCell, Alert,
  CircularProgress, LinearProgress, Divider, useTheme, alpha,
} from "@mui/material";
import {
  ArrowBackRounded, ArrowForwardRounded, RocketLaunchRounded, CheckCircleRounded,
  WarningAmberRounded, ArrowRightRounded, Inventory2Rounded, SpeedRounded, RouteRounded,
} from "@mui/icons-material";
import { listCables, toEngineCable } from "../../services/cableMasterService";
import {
  computeRouting, computeMRP, stockFor, productionMetres, savePlan, releaseToWorkOrder,
  loadEngineMachines,
} from "../../services/cableProductionService";

const STEPS = ["Select", "Material", "Capacity", "Routing", "Review", "Release"];
const STAGE_COLOR = { bunching: "#6366f1", core: "#0ea5e9", laying: "#f59e0b", sheathing: "#10b981", cutting: "#a855f7" };
const kg = (v) => `${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;

export default function CableProductionPlanWizard() {
  const theme = useTheme();
  const [active, setActive] = useState(0);
  const [cables, setCables] = useState([]);
  const [machines, setMachines] = useState([]);
  const [form, setForm] = useState({ cable: null, qty: 1000, length_m: "", due_date: "", priority: "medium", customer_name: "", customer_code: "", sales_order_number: "" });
  const [stock, setStock] = useState({});
  const [busy, setBusy] = useState(false);
  const [released, setReleased] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listCables().then((r) => setCables((r || []).filter((c) => !c.archived_at))).catch(() => {});
    loadEngineMachines().then(setMachines).catch(() => {});
  }, []);

  const cable = form.cable;
  const metres = useMemo(() => (cable ? productionMetres({ qty: form.qty, length_m: form.length_m }, cable) : 0), [cable, form.qty, form.length_m]);
  const routing = useMemo(() => (cable ? computeRouting(cable) : []), [cable]);
  const mrp = useMemo(() => (cable ? computeMRP(cable, metres) : []), [cable, metres]);

  const loadStock = useCallback(async () => {
    if (!mrp.length) return;
    setStock(await stockFor(mrp.map((m) => m.code)));
  }, [mrp]);
  useEffect(() => { if (active === 1) loadStock(); }, [active, loadStock]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const machineForStage = (s) => machines.find((m) => m.stage === s);

  const capacityRows = useMemo(() => routing.map((st) => {
    const m = machineForStage(st.machine_stage);
    const speed = m?.defaultSpeed || 500;
    const hrs = metres > 0 && speed ? metres / speed : 0;
    return { stage: st.machine_stage, label: st.stage_name, machine: m?.name || "—", speed, hrs: +hrs.toFixed(1) };
  }), [routing, machines, metres]);

  const shortfalls = mrp.map((m) => ({ ...m, on_hand: stock[m.code] || 0, short: Math.max(0, m.qty_required - (stock[m.code] || 0)) })).filter((m) => m.short > 0);

  const canNext = () => {
    if (active === 0) return !!cable && Number(form.qty) > 0;
    return true;
  };
  const next = () => setActive((a) => Math.min(STEPS.length - 1, a + 1));
  const back = () => setActive((a) => Math.max(0, a - 1));

  const release = async () => {
    setBusy(true); setError("");
    try {
      const planRow = {
        cable_id: cable.id, cable_code: cable.cable_code, product_name: cable.cable_name,
        customer_code: form.customer_code || null, customer_name: form.customer_name || null,
        sales_order_number: form.sales_order_number || null,
        qty: Number(form.qty), length_m: form.length_m ? Number(form.length_m) : null,
        total_length_m: metres, due_date: form.due_date || null, priority: form.priority,
        status: "released", routing, materials: mrp,
      };
      const saved = await savePlan(planRow);
      const wo = await releaseToWorkOrder(saved, cable);
      setReleased({ plan: saved, wo });
      setActive(5);
    } catch (e) { setError(e.message || "Release failed."); }
    finally { setBusy(false); }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.5 }}>New Production Plan</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Guided plan creation — one step at a time.</Typography>

      <Stepper activeStep={active} alternativeLabel sx={{ mb: 3 }}>
        {STEPS.map((s) => <Step key={s}><StepLabel>{s}</StepLabel></Step>)}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, minHeight: 280 }}>
        {/* STEP 0 — SELECT */}
        {active === 0 && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Autocomplete options={cables} value={cable} onChange={(_, v) => set("cable", v)}
                getOptionLabel={(o) => (o ? `${o.cable_code} — ${o.cable_name || ""}` : "")}
                renderInput={(p) => <TextField {...p} label="Cable" size="small" required />} />
            </Grid>
            <Grid item xs={6} md={3}><TextField label={cable?.is_power_cord ? "Pieces" : "Quantity (m)"} type="number" fullWidth size="small" value={form.qty} onChange={(e) => set("qty", e.target.value)} /></Grid>
            {cable?.is_power_cord && <Grid item xs={6} md={3}><TextField label="Length per piece (m)" type="number" fullWidth size="small" value={form.length_m} onChange={(e) => set("length_m", e.target.value)} /></Grid>}
            <Grid item xs={6} md={3}><TextField label="Due date" type="date" InputLabelProps={{ shrink: true }} fullWidth size="small" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} /></Grid>
            <Grid item xs={6} md={3}><TextField select label="Priority" fullWidth size="small" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              {["low", "medium", "high"].map((p) => <MenuItem key={p} value={p} sx={{ textTransform: "capitalize" }}>{p}</MenuItem>)}
            </TextField></Grid>
            <Grid item xs={12} md={4}><TextField label="Customer" fullWidth size="small" value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></Grid>
            <Grid item xs={6} md={4}><TextField label="Customer code" fullWidth size="small" value={form.customer_code} onChange={(e) => set("customer_code", e.target.value)} /></Grid>
            <Grid item xs={6} md={4}><TextField label="Sales order #" fullWidth size="small" value={form.sales_order_number} onChange={(e) => set("sales_order_number", e.target.value)} /></Grid>
            {cable && <Grid item xs={12}><Alert severity="info" icon={<Inventory2Rounded />}>Production quantity: <b>{metres.toLocaleString("en-IN")} m</b></Alert></Grid>}
          </Grid>
        )}

        {/* STEP 1 — MATERIAL */}
        {active === 1 && (
          <Box>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Material requirement vs on-hand</Typography>
            <Table size="small">
              <TableHead><TableRow>{["Material", "Required", "On hand", "Status"].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }} align={h === "Material" ? "left" : "right"}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {mrp.map((m) => {
                  const oh = stock[m.code] || 0; const short = m.qty_required - oh;
                  return (
                    <TableRow key={m.code}>
                      <TableCell>{m.name} <Typography component="span" variant="caption" color="text.secondary">({m.code})</Typography></TableCell>
                      <TableCell align="right">{kg(m.qty_required)}</TableCell>
                      <TableCell align="right">{kg(oh)}</TableCell>
                      <TableCell align="right">{short > 0 ? <Chip size="small" color="error" label={`short ${kg(short)}`} /> : <Chip size="small" color="success" label="OK" />}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Alert severity={shortfalls.length ? "warning" : "success"} sx={{ mt: 2 }}>
              {shortfalls.length ? `${shortfalls.length} material(s) short — you can still release; raise an indent from MRP.` : "All materials available."}
            </Alert>
          </Box>
        )}

        {/* STEP 2 — CAPACITY */}
        {active === 2 && (
          <Box>
            <Typography sx={{ fontWeight: 700, mb: 1 }}><SpeedRounded fontSize="small" sx={{ verticalAlign: "middle", mr: 0.5 }} />Machine capacity for this order</Typography>
            <Table size="small">
              <TableHead><TableRow>{["Stage", "Machine", "Speed (m/hr)", "Est. hours"].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }} align={h === "Stage" || h === "Machine" ? "left" : "right"}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {capacityRows.map((r) => (
                  <TableRow key={r.stage}>
                    <TableCell><Chip size="small" label={r.label} sx={{ bgcolor: `${STAGE_COLOR[r.stage] || "#888"}22`, color: STAGE_COLOR[r.stage], fontWeight: 700 }} /></TableCell>
                    <TableCell>{r.machine}</TableCell>
                    <TableCell align="right">{r.speed}</TableCell>
                    <TableCell align="right">{r.hrs} h</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Alert severity="info" sx={{ mt: 2 }}>Total est. run time: <b>{capacityRows.reduce((s, r) => s + r.hrs, 0).toFixed(1)} h</b> across {capacityRows.length} stages.</Alert>
          </Box>
        )}

        {/* STEP 3 — ROUTING */}
        {active === 3 && (
          <Box>
            <Typography sx={{ fontWeight: 700, mb: 1.5 }}><RouteRounded fontSize="small" sx={{ verticalAlign: "middle", mr: 0.5 }} />Production routing</Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
              {routing.map((s, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <ArrowRightRounded sx={{ color: "text.disabled" }} />}
                  <Chip label={s.stage_name} sx={{ bgcolor: `${STAGE_COLOR[s.machine_stage] || "#888"}22`, color: STAGE_COLOR[s.machine_stage], fontWeight: 700 }} />
                </React.Fragment>
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>Auto-derived from the cable spec. Releasing creates a work order with these routed stages.</Typography>
          </Box>
        )}

        {/* STEP 4 — REVIEW */}
        {active === 4 && (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="overline" color="text.secondary">Order</Typography>
              <Typography variant="body2"><b>{cable?.cable_code}</b> — {cable?.cable_name}</Typography>
              <Typography variant="body2">{metres.toLocaleString("en-IN")} m · {form.priority} priority{form.due_date ? ` · due ${form.due_date}` : ""}</Typography>
              <Typography variant="body2" color="text.secondary">{form.customer_name || "—"}{form.sales_order_number ? ` · SO ${form.sales_order_number}` : ""}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="overline" color="text.secondary">Routing</Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{routing.map((s, i) => <Chip key={i} size="small" label={s.stage_name} />)}</Stack>
              <Typography variant="overline" color="text.secondary" sx={{ mt: 1, display: "block" }}>Materials</Typography>
              <Typography variant="body2">{mrp.map((m) => `${m.name} ${kg(m.qty_required)}`).join(" · ")}</Typography>
            </Grid>
            <Grid item xs={12}>
              <Alert severity={shortfalls.length ? "warning" : "success"} icon={shortfalls.length ? <WarningAmberRounded /> : <CheckCircleRounded />}>
                {shortfalls.length ? `${shortfalls.length} material short — release anyway?` : "Ready to release."} Releasing creates a work order.
              </Alert>
            </Grid>
          </Grid>
        )}

        {/* STEP 5 — RELEASE */}
        {active === 5 && (
          <Box sx={{ textAlign: "center", py: 3 }}>
            {busy ? <CircularProgress /> : released ? (
              <>
                <CheckCircleRounded color="success" sx={{ fontSize: 56, mb: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 800 }}>Plan released</Typography>
                <Typography variant="h5" sx={{ fontWeight: 900, color: "primary.main", my: 0.5, letterSpacing: 0.5 }}>
                  {released.wo?.wo_number || "Work order created"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {cable?.cable_code} · {metres.toLocaleString("en-IN")} m{released.wo?.stage_count ? ` · ${released.wo.stage_count} stages` : ""}. Track it in Order Tracking.
                </Typography>
                <Button variant="outlined" sx={{ mt: 2 }} onClick={() => { setReleased(null); setForm({ cable: null, qty: 1000, length_m: "", due_date: "", priority: "medium", customer_name: "", customer_code: "", sales_order_number: "" }); setActive(0); }}>Plan another</Button>
              </>
            ) : (
              <>
                <RocketLaunchRounded color="primary" sx={{ fontSize: 56, mb: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 800 }}>Release this plan?</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Saves the plan and creates a work order with its routed stages + material kit.</Typography>
                <Button variant="contained" size="large" startIcon={<RocketLaunchRounded />} onClick={release} disabled={busy}>Release to Work Order</Button>
              </>
            )}
          </Box>
        )}
      </Paper>

      {/* nav */}
      {!(active === 5 && released) && (
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
          <Button startIcon={<ArrowBackRounded />} onClick={back} disabled={active === 0 || busy}>Back</Button>
          {active < 4 && <Button variant="contained" endIcon={<ArrowForwardRounded />} onClick={next} disabled={!canNext()}>Next</Button>}
          {active === 4 && <Button variant="contained" endIcon={<RocketLaunchRounded />} onClick={() => setActive(5)}>Proceed to release</Button>}
        </Stack>
      )}
    </Box>
  );
}
