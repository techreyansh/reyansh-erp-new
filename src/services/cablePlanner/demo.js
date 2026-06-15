// In-memory demo data for the cable planner — lets you SEE the Auto Planner,
// Job Cards and Floor board populated without writing anything to the database.
// Triggered by ?demo=1 (floor) or the "Demo data" buttons. Nothing here persists.
import { DEFAULT_MACHINES, STAGE_LABEL, STAGE_ORDER } from "./machineConfig.js";

export const DEMO_CABLES = [
  { id: "R3C2.5", code: "R3C2.5", name: "3C × 2.5 Round Flexible", cores: 3, size: 2.5, type: "Round Flexible", strandCount: 50, gauge: "50/0.25", insThick: 0.6, shThick: 0.9, voltage: "1100V", color: "Black", coreColors: ["Red", "Yellow", "Blue"], isi: true, isPowerCord: false, coilLength: 100, cordLength: 1.5 },
  { id: "R2C1.5", code: "R2C1.5", name: "2C × 1.5 Power Cord", cores: 2, size: 1.5, type: "Round Flexible", strandCount: 30, gauge: "30/0.25", insThick: 0.6, shThick: 0.8, voltage: "750V", color: "White", coreColors: ["Brown", "Blue"], isi: true, isPowerCord: true, coilLength: 100, cordLength: 1.5 },
  { id: "R4C4.0", code: "R4C4.0", name: "4C × 4.0 Round Flexible", cores: 4, size: 4.0, type: "Round Flexible", strandCount: 56, gauge: "56/0.30", insThick: 0.8, shThick: 1.2, voltage: "1100V", color: "Grey", coreColors: ["Red", "Yellow", "Blue", "Black"], isi: false, isPowerCord: false, coilLength: 100, cordLength: 1.5 },
];

export const DEMO_ORDERS = [
  { id: "PLAN-D1", orderNo: "SO/DEMO/001", customer: "Havells", cableId: "R3C2.5", qtyM: 2500, dueDate: isoDate(2), priority: "high", status: "pending", createdAt: isoDate(-1) },
  { id: "PLAN-D2", orderNo: "SO/DEMO/002", customer: "Polycab", cableId: "R4C4.0", qtyM: 1800, dueDate: isoDate(4), priority: "normal", status: "pending", createdAt: isoDate(-1) },
  { id: "PLAN-D3", orderNo: "SO/DEMO/003", customer: "Anchor", cableId: "R2C1.5", qtyM: 1200, dueDate: isoDate(1), priority: "urgent", status: "pending", createdAt: isoDate(-1) },
];

function isoDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Machine Schedules-shaped rows for TODAY, timed around `now` so each machine
// has a job that is currently RUNNING (one done earlier, one upcoming).
export function demoScheduleRows(now = Date.now()) {
  const cableByMachine = {
    M1: DEMO_CABLES[0], // bunching
    M2: DEMO_CABLES[0], // core (per colour)
    M3: DEMO_CABLES[2], // laying (4 core)
    M4: DEMO_CABLES[1], // sheathing (power cord)
  };
  const orderByCable = { "R3C2.5": DEMO_ORDERS[0], "R4C4.0": DEMO_ORDERS[1], "R2C1.5": DEMO_ORDERS[2] };
  const min = 60 * 1000;
  const rows = [];

  for (const machine of DEFAULT_MACHINES) {
    const cable = cableByMachine[machine.id];
    const order = orderByCable[cable.code];
    const isCore = machine.stage === "core";
    const colors = cable.coreColors;

    // three slots: done (−), running (0), upcoming (+)
    const slots = [
      { key: "done", start: now - 150 * min, end: now - 40 * min, status: "Completed", color: isCore ? colors[0] : null, ci: isCore ? 1 : null },
      { key: "run", start: now - 25 * min, end: now + 65 * min, status: "In Progress", color: isCore ? colors[1] || colors[0] : null, ci: isCore ? 2 : null },
      { key: "next", start: now + 90 * min, end: now + 200 * min, status: "Scheduled", color: isCore ? colors[2] || colors[0] : null, ci: isCore ? 3 : null },
    ];

    slots.forEach((s, i) => {
      rows.push({
        scheduleId: `demo-${machine.id}-${i}`,
        planId: order.id,
        orderNumber: order.orderNo,
        productCode: cable.code,
        productName: cable.name,
        customerName: order.customer,
        operation: STAGE_LABEL[machine.stage],
        stage: machine.stage,
        operationSequence: STAGE_ORDER.indexOf(machine.stage) + 1,
        machineId: machine.id,
        machineType: STAGE_LABEL[machine.stage],
        coreIndex: s.ci ?? "",
        coreColor: s.color ?? "",
        coreOfTotal: isCore ? cable.cores : "",
        quantity: order.qtyM,
        inputQuantity: Math.round(order.qtyM * 1.085),
        scheduledStartTime: new Date(s.start).toISOString(),
        scheduledEndTime: new Date(s.end).toISOString(),
        operationTime: 1.5,
        status: s.status,
        priority: order.priority,
        source: "demo",
        ...(s.key === "done" ? { actualQuantity: Math.round(order.qtyM * 0.98), scrapMeters: Math.round(order.qtyM * 0.02), operatorName: "R. Kumar" } : {}),
      });
    });
  }
  return rows;
}

// Maps the demo cables/orders the way the views expect (by code / by id).
export const demoCablesByCode = () => Object.fromEntries(DEMO_CABLES.map((c) => [c.code, c]));
export const demoOrdersById = () => Object.fromEntries(DEMO_ORDERS.map((o) => [o.id, o]));
