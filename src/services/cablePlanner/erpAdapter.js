// Bridges the ERP's sheet rows (Cable Products / Cable Production Plans /
// Machine Schedules) to/from the pure planner engine shapes.
import { STAGE_ORDER, STAGE_LABEL } from "./machineConfig.js";

const n = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(x) ? x : null;
};
const parseColors = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim().startsWith("[")) { try { return JSON.parse(v); } catch { return []; } }
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim());
  return [];
};

// Cable Products row (flattened record) → engine cable.
export function rowToCable(r) {
  const family = `${r.productFamily || ""} ${r.cableType || ""} ${r.applicationArea || ""}`.toLowerCase();
  const std = n(r.standardLength);
  return {
    id: r.productCode || r.id,
    code: r.productCode || r.id,
    name: r.productName || r.productCode,
    cores: n(r.coreCount ?? r.numberOfCores) || 1,
    size: n(r.conductorSize) || 1,
    type: r.cableType || "Round Flexible",
    strandCount: n(r.strandCount) || 0,
    gauge: r.conductorConstruction || r.gauge || "",
    insThick: n(r.insulationThickness) ?? 0.6,
    shThick: n(r.jacketThickness) ?? 0.9,
    voltage: r.voltage || r.voltageRating || "",
    color: r.jacketColor || r.outerColor || "Black",
    coreColors: parseColors(r.coreColors),
    isPowerCord: /power\s?cord/.test(family),
    coilLength: std || 100,
    cordLength: std || 1.5,
    _rowIndex: r.rowIndex,
  };
}

// Cable Production Plans row → engine order. cableId matches a cable's id (productCode).
export function rowToOrder(r) {
  const prio = String(r.priority || "normal").toLowerCase();
  const priority = ["high", "normal", "low"].includes(prio) ? prio : (prio === "urgent" ? "high" : "normal");
  const st = String(r.status || "pending").toLowerCase();
  const status = st.includes("complete") ? "completed"
    : st.includes("cancel") ? "cancelled"
    : st.includes("progress") || st.includes("running") ? "in-progress"
    : st.includes("plan") ? "planned" : "pending";
  const qtyM = n(r.totalMeters) ?? n(r.requiredLength) ??
    ((n(r.quantity) || 0) * (n(r.length) || 1)) ?? n(r.quantity) ?? 0;
  return {
    id: r.planId || r.orderNumber || r.id,
    orderNo: r.orderNumber || r.planId || "",
    customer: r.customerName || r.customer || "",
    cableId: r.productCode,
    qtyM: qtyM || 0,
    cordPcs: n(r.quantity),
    cordLen: n(r.length),
    dueDate: (r.dueDate || "").slice(0, 10) || null,
    priority,
    status,
    createdAt: r.created_at || r.createdDate || "",
    _rowIndex: r.rowIndex,
  };
}

// Machine Schedules row (flattened record) → engine job. Inverse of
// jobToScheduleRow, so the Capacity Board / Production Calendar can read the
// SAVED schedule (persistent) without re-running the planner.
export function scheduleRowToJob(r) {
  return {
    id: r.scheduleId || r.id,
    orderId: r.planId || r.orderNumber || "",
    cableId: r.productCode || "",
    machineId: r.machineId || "",
    stage: r.stage || "",
    coreIndex: r.coreIndex === "" || r.coreIndex === undefined ? null : n(r.coreIndex),
    coreColor: r.coreColor || null,
    coreOfTotal: r.coreOfTotal === "" || r.coreOfTotal === undefined ? null : n(r.coreOfTotal),
    startTime: r.scheduledStartTime || null,
    endTime: r.scheduledEndTime || null,
    plannedHrs: n(r.operationTime) || 0,
    changeoverHrs: n(r.changeoverHours) || 0,
    orderM: n(r.quantity) || 0,
    plannedM: n(r.quantity) || 0,
    plannedInputM: n(r.inputQuantity) || 0,
    customerName: r.customerName || "",
    orderNo: r.orderNumber || "",
    productName: r.productName || "",
    status: (r.status || "Scheduled").toLowerCase().includes("complete") ? "completed" : "planned",
    _rowIndex: r.rowIndex,
  };
}

// engine job → Machine Schedules row (flattened record).
export function jobToScheduleRow(job, cable, order) {
  return {
    scheduleId: job.id,
    planId: order?.id || job.orderId,
    orderNumber: order?.orderNo || "",
    productCode: cable?.code || "",
    productName: cable?.name || "",
    customerName: order?.customer || "",
    operation: STAGE_LABEL[job.stage] || job.stage,
    stage: job.stage,
    operationSequence: STAGE_ORDER.indexOf(job.stage) + 1,
    machineId: job.machineId,
    machineType: STAGE_LABEL[job.stage] || job.stage,
    coreIndex: job.coreIndex ?? "",
    coreColor: job.coreColor ?? "",
    coreOfTotal: job.coreOfTotal ?? "",
    quantity: job.plannedM,
    inputQuantity: job.plannedInputM,
    scheduledStartTime: job.startTime,
    scheduledEndTime: job.endTime,
    operationTime: job.plannedHrs,
    changeoverHours: job.changeoverHrs,
    totalTime: +(job.plannedHrs + job.changeoverHrs).toFixed(3),
    status: "Scheduled",
    priority: order?.priority || "normal",
    source: "auto-planner",
    notes: "",
  };
}
