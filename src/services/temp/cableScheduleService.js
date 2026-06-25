// Cable Planning Workbench — Daily Machine Schedule engine. PURE. Takes N saved
// plans for a day and produces, per machine, an auto-sequenced job list with
// expected start/finish times (from machine capacity + changeover), a shift
// capacity bar (available / planned / changeover / buffer), a NOW/NEXT/AFTER
// queue, a colour sub-sequence for the core extruder, and a management rollup
// (utilisation, bottlenecks, delayed jobs). No network.
import { DEFAULT_MACHINES, STAGE_LABEL, STAGE_ORDER } from '../cablePlanner/index.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const PRIO = { high: 0, normal: 1, low: 2 };

// minutes-since-midnight → "8:00 AM"
export function hhmm(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60); const mm = m % 60;
  const ap = h < 12 ? 'AM' : 'PM'; const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}

const sameSet = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * @param {Object} opts
 * @param {Array}  opts.plans  [{ planNumber, customer, product, priority, deliveryDate, plan }]
 *                              where `plan` is a buildPlan() output.
 * @param {string} opts.date            ISO date string for the schedule day.
 * @param {number} opts.shiftStartHour  e.g. 8 (08:00).
 * @param {number} opts.shiftHours      available hours in the shift (e.g. 8).
 * @param {number} [opts.nowMin]        current time (min since midnight) for NOW/NEXT; omit → sequence-based.
 */
export function buildDaySchedule({ plans = [], date = null, shiftStartHour = 8, shiftHours = 8, nowMin = null } = {}) {
  const machines = {};
  STAGE_ORDER.forEach((stage) => {
    const m = DEFAULT_MACHINES.find((x) => x.stage === stage) || {};
    machines[stage] = {
      stage, label: STAGE_LABEL[stage], machine: m.name || stage,
      changeoverMin: m.changeoverMin || 0, jobs: [],
    };
  });

  // Fan each plan's required departments into per-machine jobs.
  plans.forEach((p) => {
    const plan = p.plan; if (!plan) return;
    STAGE_ORDER.forEach((stage) => {
      const d = plan.departments?.[stage];
      if (!d || !d.required) return;
      machines[stage].jobs.push({
        planNumber: p.planNumber || 'DRAFT', customer: p.customer || '—', product: p.product || '—',
        priority: p.priority || 'normal', deliveryDate: p.deliveryDate || null,
        cores: plan.config.cores, conductorSize: plan.config.conductorSize, shape: plan.config.shape,
        finishedOd: plan.config.finishedOd, coreOd: plan.config.coreOd, colours: plan.config.colours || [],
        layingLossPct: plan.config.layingLossPct,
        colourCombination: stage === 'laying' ? d.colourCombination : (plan.config.colours || []).join(', '),
        coreRows: stage === 'core' ? (d.rows || []) : null,
        length: d.planningLength, target: d.planningLength,
        requiredHours: d.requiredHours, speed: d.speed,
      });
    });
  });

  const availMin = shiftHours * 60;
  // Sequence + time each machine.
  Object.values(machines).forEach((mc) => {
    mc.jobs.sort((a, b) => (PRIO[a.priority] - PRIO[b.priority])
      || String(a.deliveryDate || '').localeCompare(String(b.deliveryDate || '')));
    let t = shiftStartHour * 60;
    let plannedMin = 0; let changeoverMin = 0;
    mc.jobs.forEach((job, i) => {
      if (i > 0) {
        const prev = mc.jobs[i - 1];
        t += mc.changeoverMin; changeoverMin += mc.changeoverMin;
        job.changeover = {
          colourChange: !sameSet(prev.colours, job.colours),
          sizeChange: prev.conductorSize !== job.conductorSize,
          drumChange: true,
          setupMin: mc.changeoverMin,
        };
      }
      const dur = Math.round((job.requiredHours || 0) * 60);
      job.startMin = t; job.startTime = hhmm(t);
      t += dur; plannedMin += dur;
      job.finishMin = t; job.finishTime = hhmm(t);
      job.durationHours = r2(dur / 60);
      job.seq = i + 1;
      job.delayed = t > shiftStartHour * 60 + availMin; // finishes past the shift

      // Core extruder: colour sub-sequence inside the job window.
      if (mc.stage === 'core' && job.coreRows && job.coreRows.length) {
        const per = dur / job.coreRows.length;
        let ct = job.startMin;
        job.colourSequence = job.coreRows.map((row) => {
          const s = ct; ct += per;
          return { colour: row.colour, coreOd: row.coreOd, length: row.targetLength, startTime: hhmm(s), finishTime: hhmm(ct) };
        });
      }
    });
    const usedMin = plannedMin + changeoverMin;
    mc.summary = {
      jobCount: mc.jobs.length,
      totalLength: r2(mc.jobs.reduce((a, j) => a + (j.length || 0), 0)),
      plannedHours: r2(plannedMin / 60),
      changeoverHours: r2(changeoverMin / 60),
      availableHours: shiftHours,
      usedHours: r2(usedMin / 60),
      bufferHours: r2(Math.max(0, availMin - usedMin) / 60),
      utilizationPct: availMin ? r1((usedMin / availMin) * 100) : 0,
      overbooked: usedMin > availMin,
      overbookedByHours: usedMin > availMin ? r2((usedMin - availMin) / 60) : 0,
    };
    // NOW / NEXT / AFTER queue.
    const order = mc.jobs.filter((j) => true);
    let nowIdx = 0;
    if (nowMin != null) {
      const running = mc.jobs.findIndex((j) => nowMin >= j.startMin && nowMin < j.finishMin);
      const upcoming = mc.jobs.findIndex((j) => j.startMin >= nowMin);
      nowIdx = running >= 0 ? running : (upcoming >= 0 ? upcoming : mc.jobs.length);
    }
    mc.queue = {
      now: order[nowIdx] || null,
      next: order[nowIdx + 1] || null,
      after: order[nowIdx + 2] || null,
    };
  });

  const active = Object.values(machines).filter((mc) => mc.jobs.length);
  const management = {
    machineLoad: active.map((mc) => ({
      machine: mc.machine, stage: mc.stage, jobs: mc.summary.jobCount,
      plannedHours: mc.summary.plannedHours, utilizationPct: mc.summary.utilizationPct,
      bufferHours: mc.summary.bufferHours, overbooked: mc.summary.overbooked,
    })),
    bottlenecks: active.filter((mc) => mc.summary.overbooked).map((mc) => ({ machine: mc.machine, overbookedByHours: mc.summary.overbookedByHours, utilizationPct: mc.summary.utilizationPct })),
    delayedJobs: active.flatMap((mc) => mc.jobs.filter((j) => j.delayed).map((j) => ({ machine: mc.machine, planNumber: j.planNumber, customer: j.customer, finishTime: j.finishTime }))),
    totalJobs: active.reduce((a, mc) => a + mc.summary.jobCount, 0),
    totalPlannedHours: r2(active.reduce((a, mc) => a + mc.summary.plannedHours, 0)),
    avgUtilizationPct: active.length ? r1(active.reduce((a, mc) => a + mc.summary.utilizationPct, 0) / active.length) : 0,
  };

  return {
    date, shiftStartHour, shiftHours, shiftEndHour: shiftStartHour + shiftHours,
    machines, order: STAGE_ORDER.filter((s) => machines[s].jobs.length), management,
  };
}

const cableScheduleService = { buildDaySchedule, hhmm };
export default cableScheduleService;
