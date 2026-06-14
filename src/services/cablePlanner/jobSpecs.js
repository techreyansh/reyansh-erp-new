// Per-job operator specs — what a job card / floor screen shows for one job.
// Ported from the planner's jobSpecs(); returns structured data (not HTML) so
// React can render it. Pure.
import { cableGeometry } from "./geometry.js";
import { CONST } from "./machineConfig.js";
import { coreColorsFor } from "./machineConfig.js";

const r2 = (n) => +(+n || 0).toFixed(2);
const r0 = (n) => Math.round(+n || 0);

function insKgPerCoreM(cable) {
  const g = cableGeometry(cable);
  const areaCC = (Math.PI * (g.insOd * g.insOd - g.conductorDia * g.conductorDia)) / 4 / 100;
  return (areaCC * 100 * CONST.PVC_DENSITY) / 1000;
}
function shKgPerM(cable) {
  const g = cableGeometry(cable);
  const areaCC = (Math.PI * (g.outerOd * g.outerOd - g.laidOd * g.laidOd)) / 4 / 100;
  return (areaCC * 100 * CONST.PVC_DENSITY) / 1000;
}
const copperKg = (cable, meters) => cable.size * CONST.COPPER_DENSITY_FACTOR * (meters || 0) * CONST.COPPER_LOSS;

// job: { stage, plannedM, plannedInputM, coreIndex, coreColor, coreOfTotal }
export function jobSpecs(job, cable, order = {}) {
  const g = cableGeometry(cable);
  const cores = cable.cores || 1;
  const out = job.plannedM || 0;
  const inp = job.plannedInputM || 0;
  const colors = coreColorsFor(cable);

  const common = [
    ["Order", order.orderNo || "—"],
    ["Customer", order.customer || "—"],
    ["Cable", `${cable.code} · ${cores}C × ${cable.size} sqmm ${cable.type || ""}`.trim()],
    ["Voltage", cable.voltage || "—"],
    ["Input → Output", `${r0(inp)} m → ${r0(out)} m`],
  ];

  let title = "";
  let specs = [];
  let checklist = [];
  let weightKg = 0;

  if (job.stage === "bunching") {
    title = "Bunching";
    weightKg = copperKg(cable, inp);
    specs = [
      ["Strands × gauge", `${cable.strandCount || "—"} × ${cable.gauge || "—"}`],
      ["Conductor OD", `${g.conductorDia} mm`],
      ["Raw copper input", `${r0(inp)} m`],
      ["Bare output", `${r0(out)} m → splits into ${cores} cores`],
      ["Est. copper", `${r2(weightKg)} kg`],
      ["Lay", `RH · ${g.bunchLayLength} mm`],
    ];
    checklist = ["Load correct copper wire spool", "Verify strand count", "Set lay length & direction (RH)", "Check bunched OD", "Label drums per core"];
  } else if (job.stage === "core") {
    title = `Core Extrusion — core ${job.coreIndex || "?"} / ${job.coreOfTotal || cores}`;
    weightKg = insKgPerCoreM(cable) * out;
    specs = [
      ["Insulation colour", job.coreColor || "—"],
      ["Bare in → insulated out", `${r0(inp)} m → ${r0(out)} m`],
      ["Conductor / insulated OD", `${g.conductorDia} → ${g.insOd} mm`],
      ["Insulation thickness", `${cable.insThick || 0} mm`],
      ["Compound", "PVC Type-A"],
      ["Est. PVC", `${r2(weightKg)} kg`],
    ];
    checklist = [`Load ${job.coreColor || "colour"} PVC compound`, "Spark-test insulation", "Check wall thickness", "Verify OD", "Coil & label core"];
  } else if (job.stage === "laying") {
    title = "Laying-up";
    specs = [
      ["Cores", `${cores} (${colors.join(" → ")})`],
      ["Each-core OD", `${g.insOd} mm`],
      ["Cores-in → laid out", `${r0(inp)} m → ${r0(out)} m`],
      ["Laid bundle OD", `${g.laidOd} mm`],
      ["Lay", `RH · ${g.layLength} mm`],
      ["Filler / binder", cores >= 4 ? "PP filler" : "Cotton tape"],
    ];
    checklist = ["Sequence cores per colour order", "Set lay length & direction", "Add filler/binder", "Check laid OD", "Coil for sheathing"];
  } else if (job.stage === "sheathing") {
    title = "Sheathing";
    weightKg = shKgPerM(cable) * out;
    const isCord = cable.isPowerCord && cable.cordLength;
    specs = [
      ["Laid in → finished out", `${r0(inp)} m → ${r0(out)} m`],
      ["Inner laid OD", `${g.laidOd} mm`],
      ["Sheath thickness", `${cable.shThick || 0} mm`],
      ["Finished outer OD", `${g.outerOd} mm`],
      ["Sheath colour", cable.color || "—"],
      ["Est. sheath PVC", `${r2(weightKg)} kg`],
    ];
    if (isCord) {
      specs.push(["Auto-cut length", `${cable.cordLength} m/pc`]);
      specs.push(["Pieces", `${Math.floor(out / cable.cordLength)} pcs`]);
    } else {
      specs.push(["Pack", `${cable.coilLength || 100} m coils`]);
    }
    checklist = ["Load sheath compound", `Set sheath colour (${cable.color || "—"})`, "Check outer OD", cable.isi ? "Apply ISI marking" : "Apply print legend", isCord ? "Cut to length & count pieces" : "Coil & weigh"];
  }

  return { title, common, specs, checklist, weightKg: r2(weightKg) };
}
