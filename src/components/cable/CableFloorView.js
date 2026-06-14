// Floor / TV operator view — full-screen, dark, auto-refreshing (60s). One
// machine's jobs for today, with a big RUNNING NOW banner. Open via
// /cable-floor?machine=M1 (the Job Cards "TV" button).
import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip, Stack, CircularProgress } from "@mui/material";
import sheetService from "../../services/sheetService";
import { jobSpecs, DEFAULT_MACHINES } from "../../services/cablePlanner";
import { rowToCable, rowToOrder } from "../../services/cablePlanner/erpAdapter";

const num = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const rowToJob = (row) => ({ stage: row.stage, plannedM: num(row.quantity), plannedInputM: num(row.inputQuantity), coreIndex: row.coreIndex, coreColor: row.coreColor, coreOfTotal: row.coreOfTotal });

export default function CableFloorView() {
  const machineId = new URLSearchParams(window.location.search).get("machine") || "M1";
  const machine = DEFAULT_MACHINES.find((m) => m.id === machineId) || DEFAULT_MACHINES[0];
  const [jobs, setJobs] = useState([]);
  const [cablesByCode, setCablesByCode] = useState({});
  const [ordersById, setOrdersById] = useState({});
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [sch, cp, plans] = await Promise.all([
        sheetService.getSheetData("Machine Schedules"),
        sheetService.getSheetData("Cable Products"),
        sheetService.getSheetData("Cable Production Plans"),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      setJobs((sch || []).filter((r) => r.machineId === machine.id && String(r.scheduledStartTime || "").slice(0, 10) === today)
        .sort((a, b) => String(a.scheduledStartTime).localeCompare(String(b.scheduledStartTime))));
      const cabs = {}; (cp || []).map(rowToCable).forEach((c) => { if (c.code) cabs[c.code] = c; });
      setCablesByCode(cabs);
      const ords = {}; (plans || []).map(rowToOrder).forEach((o) => { ords[o.id] = o; });
      setOrdersById(ords);
    } catch { /* keep last good */ } finally { setLoading(false); }
  }, [machine.id]);

  useEffect(() => { load(); }, [load]);
  // auto-refresh data every 60s + clock every 30s
  useEffect(() => {
    const a = setInterval(load, 60000);
    const b = setInterval(() => setTick(Date.now()), 30000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [load]);

  const now = tick;
  const isRunning = (r) => {
    const s = new Date(r.scheduledStartTime).getTime(), e = new Date(r.scheduledEndTime).getTime();
    return now >= s && now <= e && !String(r.status || "").toLowerCase().includes("complet");
  };

  return (
    <Box sx={{ position: "fixed", inset: 0, bgcolor: "#0b1020", color: "#fff", zIndex: 2000, overflow: "auto", p: { xs: 2, md: 4 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Typography sx={{ fontWeight: 900, fontSize: { xs: 28, md: 44 } }}>{machine.name} <span style={{ opacity: 0.5 }}>· {machine.id}</span></Typography>
        <Box sx={{ textAlign: "right" }}>
          <Typography sx={{ fontWeight: 800, fontSize: { xs: 22, md: 34 } }}>{new Date(now).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}</Typography>
          <Typography sx={{ opacity: 0.6 }}>{new Date(now).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" })}</Typography>
        </Box>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress sx={{ color: "#fff" }} /></Box>
      ) : jobs.length === 0 ? (
        <Typography sx={{ fontSize: 28, opacity: 0.6, textAlign: "center", mt: 8 }}>No jobs scheduled today.</Typography>
      ) : (
        <Stack spacing={2}>
          {jobs.map((row, i) => {
            const cable = cablesByCode[row.productCode] || { code: row.productCode, size: 1, cores: 1 };
            const order = ordersById[row.planId] || { orderNo: row.orderNumber, customer: row.customerName };
            const spec = jobSpecs(rowToJob(row), cable, order);
            const running = isRunning(row);
            const done = String(row.status || "").toLowerCase().includes("complet");
            return (
              <Box key={row.scheduleId} sx={{
                borderRadius: 3, p: { xs: 2, md: 3 },
                bgcolor: running ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.05)",
                border: running ? "2px solid #10b981" : "1px solid rgba(255,255,255,0.1)",
              }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
                  <Stack direction="row" spacing={2} alignItems="center">
                    {running ? <Chip label="▶ RUNNING NOW" sx={{ bgcolor: "#10b981", color: "#fff", fontWeight: 900, fontSize: 16 }} />
                      : done ? <Chip label="✓ DONE" sx={{ bgcolor: "rgba(255,255,255,0.2)", color: "#fff", fontWeight: 800 }} />
                      : <Chip label={`Job ${i + 1}`} sx={{ bgcolor: "rgba(255,255,255,0.12)", color: "#fff" }} />}
                    <Typography sx={{ fontWeight: 900, fontSize: { xs: 22, md: 30 } }}>{spec.title}</Typography>
                  </Stack>
                  <Typography sx={{ fontSize: { xs: 18, md: 26 }, fontWeight: 800, opacity: 0.85 }}>{hhmm(row.scheduledStartTime)} – {hhmm(row.scheduledEndTime)}</Typography>
                </Stack>
                <Typography sx={{ opacity: 0.7, mb: 1.5, fontSize: 18 }}>{order.orderNo || "—"} · {cable.code} · {order.customer || ""}</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                  {spec.specs.slice(0, 6).map(([k, v]) => (
                    <Box key={k} sx={{ bgcolor: "rgba(255,255,255,0.08)", borderRadius: 2, px: 2, py: 1, minWidth: 150 }}>
                      <Typography sx={{ opacity: 0.6, fontSize: 13 }}>{k}</Typography>
                      <Typography sx={{ fontWeight: 800, fontSize: 20 }}>{v}</Typography>
                    </Box>
                  ))}
                </Box>
                {row.actualQuantity != null && row.actualQuantity !== "" && (
                  <Typography sx={{ mt: 1.5, color: "#34d399", fontWeight: 800, fontSize: 18 }}>Actual: {row.actualQuantity} m</Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
      <Typography sx={{ opacity: 0.35, textAlign: "center", mt: 4, fontSize: 13 }}>Auto-refreshes every 60 seconds · Reyansh ERP Cable Planner</Typography>
    </Box>
  );
}
