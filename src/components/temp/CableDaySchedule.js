// Cable Planning Workbench — Daily Machine Schedule output. One A3-landscape
// sheet per machine (supervisor's daily department plan): shift capacity bar,
// NOW/NEXT/AFTER queue, a visual timeline, the sequenced job list with
// operator-entry + changeover columns and stage-specific detail (core colour
// sequence / laying combo / sheathing OD), plus a management summary sheet.
// Print via window.print() — @media print isolates .cds-print, A3 landscape,
// one machine per page. Built from cableScheduleService.buildDaySchedule().
import React from 'react';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const m = (n) => `${fmt(n)} m`;
const COMPANY = 'REYANSH INTERNATIONAL PVT. LTD.';
const JOB_COLORS = ['#1e6fd6', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#4f46e5', '#ca8a04'];

const PRINT_CSS = `
.cds-print { font-family: 'Inter', Arial, sans-serif; color:#111; }
.cds-sheet { background:#fff; padding: 10mm; margin: 0 auto 16px; max-width: 400mm; border:1px solid #d0d0d0; box-sizing:border-box; }
.cds-hdr { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #111; padding-bottom:6px; margin-bottom:10px; }
.cds-hdr h1 { font-size: 24px; margin:0; font-weight:800; }
.cds-hdr .sub { font-size: 13px; color:#444; margin-top:2px; }
.cds-hdr .co { font-size: 12px; color:#666; }
.cds-hdr .meta { text-align:right; font-size: 14px; font-weight:700; }
/* shift capacity bar */
.cds-cap { margin: 6px 0 12px; }
.cds-cap .lbls { display:flex; gap:18px; font-size: 13px; margin-bottom:5px; flex-wrap:wrap; }
.cds-cap .lbls b { font-weight:800; }
.cds-cap .track { height: 30px; border:2px solid #111; border-radius:5px; display:flex; overflow:hidden; background:#f4f4f4; }
.cds-cap .seg { height:100%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; color:#fff; white-space:nowrap; }
.cds-cap .planned { background:#16a34a; } .cds-cap .change { background:#d97706; } .cds-cap .buffer { background:#cbd5e1; color:#334155; }
.cds-cap .over { background:#dc2626; }
.cds-warn { background:#fee2e2; border:1.5px solid #dc2626; color:#991b1b; font-weight:800; font-size:13px; padding:5px 10px; border-radius:5px; margin-bottom:10px; }
.cds-ok { background:#dcfce7; border:1.5px solid #16a34a; color:#166534; font-weight:700; font-size:12.5px; padding:5px 10px; border-radius:5px; margin-bottom:10px; }
/* queue */
.cds-queue { display:grid; grid-template-columns: repeat(3,1fr); gap:10px; margin-bottom:12px; }
.cds-q { border:2px solid #999; border-radius:6px; padding:8px 10px; }
.cds-q.now { border-color:#16a34a; background:#f0fdf4; } .cds-q.next { border-color:#d97706; } .cds-q.after { border-color:#bbb; }
.cds-q .tag { font-size:11px; font-weight:800; letter-spacing:.5px; }
.cds-q.now .tag { color:#16a34a; } .cds-q.next .tag { color:#d97706; } .cds-q.after .tag { color:#777; }
.cds-q .pl { font-size:16px; font-weight:800; } .cds-q .dt { font-size:12px; color:#444; }
/* timeline */
.cds-tl { margin: 4px 0 12px; }
.cds-tl .row { position:relative; height: 40px; border:1.5px solid #222; border-radius:5px; background:repeating-linear-gradient(90deg,#fafafa,#fafafa 9.9%,#eee 10%,#eee 10%); }
.cds-tl .blk { position:absolute; top:3px; bottom:3px; border-radius:4px; color:#fff; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; overflow:hidden; padding:0 4px; box-sizing:border-box; }
.cds-tl .axis { display:flex; justify-content:space-between; font-size:10.5px; color:#666; margin-top:3px; }
/* job table */
table.cds-tbl { width:100%; border-collapse:collapse; font-size:12.5px; }
table.cds-tbl th, table.cds-tbl td { border:1px solid #999; padding:5px 7px; }
table.cds-tbl th { background:#222; color:#fff; font-size:11px; font-weight:800; }
table.cds-tbl td.c { text-align:center; } table.cds-tbl .seq { font-weight:800; text-align:center; width:34px; }
.cds-entry { color:#aaa; } .cds-chip { display:inline-block; font-size:10px; font-weight:800; padding:1px 6px; border-radius:9px; margin-right:3px; }
.cds-chip.col { background:#fae8ff; color:#86198f; } .cds-chip.size { background:#dbeafe; color:#1e40af; } .cds-chip.drum { background:#fef9c3; color:#854d0e; }
.cds-sub { font-size:11px; color:#444; background:#f8fafc; }
.cds-sub b { color:#111; }
.cds-sumline { margin-top:8px; font-size:13px; font-weight:700; display:flex; gap:20px; flex-wrap:wrap; }
/* management sheet */
.cds-mgmt h2 { font-size:18px; margin: 12px 0 6px; border-bottom:2px solid #222; padding-bottom:3px; }
@media screen { .cds-print { background:#eef0f3; padding:16px; } .cds-sheet { box-shadow:0 1px 6px rgba(0,0,0,.12); } }
@media print {
  @page { size: A3 landscape; margin: 8mm; }
  html, body { background:#fff !important; }
  body * { visibility:hidden !important; }
  .cds-print, .cds-print * { visibility:visible !important; }
  .cds-print { position:absolute; left:0; top:0; width:100%; background:#fff; padding:0; }
  .cds-toolbar { display:none !important; }
  .cds-sheet { border:none; margin:0; max-width:none; width:100%; padding:4mm; page-break-after:always; break-after:page; page-break-inside:avoid; break-inside:avoid; }
  .cds-sheet:last-child { page-break-after:auto; break-after:auto; }
  table.cds-tbl, .cds-queue, .cds-cap, .cds-tl { page-break-inside:avoid; break-inside:avoid; }
}
`;

function CapacityBar({ s }) {
  const avail = s.availableHours || 8;
  const pct = (h) => Math.max(0, Math.min(100, (h / avail) * 100));
  const plannedW = pct(s.plannedHours); const changeW = pct(s.changeoverHours); const bufferW = pct(s.bufferHours);
  return (
    <div className="cds-cap">
      <div className="lbls">
        <span>Available Shift Hours <b>{fmt(avail)}</b></span>
        <span>Planned <b>{fmt(s.plannedHours)}</b></span>
        <span>Changeover <b>{fmt(s.changeoverHours)}</b></span>
        <span>Buffer <b>{fmt(s.bufferHours)}</b></span>
        <span>Utilisation <b>{fmt(s.utilizationPct)}%</b></span>
      </div>
      <div className="track">
        {s.overbooked ? (
          <>
            <div className="seg over" style={{ width: '100%' }}>OVERBOOKED by {fmt(s.overbookedByHours)} h — needs another shift / machine</div>
          </>
        ) : (
          <>
            <div className="seg planned" style={{ width: `${plannedW}%` }}>{plannedW > 12 ? `Planned ${fmt(s.plannedHours)}h` : ''}</div>
            <div className="seg change" style={{ width: `${changeW}%` }}>{changeW > 10 ? `CO ${fmt(s.changeoverHours)}h` : ''}</div>
            <div className="seg buffer" style={{ width: `${bufferW}%` }}>{bufferW > 12 ? `Buffer ${fmt(s.bufferHours)}h` : ''}</div>
          </>
        )}
      </div>
    </div>
  );
}

function Queue({ q }) {
  const Card = ({ tag, cls, job }) => (
    <div className={`cds-q ${cls}`}>
      <div className="tag">{tag}</div>
      {job ? (<><div className="pl">{job.planNumber} · {job.customer}</div><div className="dt">{job.product} · {m(job.length)} · {job.startTime}–{job.finishTime}</div></>)
        : <div className="dt" style={{ marginTop: 4 }}>—</div>}
    </div>
  );
  return (
    <div className="cds-queue">
      <Card tag="▶ NOW" cls="now" job={q.now} />
      <Card tag="⏭ NEXT" cls="next" job={q.next} />
      <Card tag="⏩ AFTER NEXT" cls="after" job={q.after} />
    </div>
  );
}

function Timeline({ mc, sched }) {
  const startMin = sched.shiftStartHour * 60; const span = sched.shiftHours * 60;
  const ticks = Array.from({ length: sched.shiftHours + 1 }, (_, i) => sched.shiftStartHour + i);
  return (
    <div className="cds-tl">
      <div className="row">
        {mc.jobs.map((j, i) => {
          const left = Math.max(0, ((j.startMin - startMin) / span) * 100);
          const width = Math.max(1.5, Math.min(100 - left, ((j.finishMin - j.startMin) / span) * 100));
          return <div key={i} className="blk" style={{ left: `${left}%`, width: `${width}%`, background: JOB_COLORS[i % JOB_COLORS.length] }} title={`${j.planNumber} ${j.startTime}-${j.finishTime}`}>{width > 6 ? j.planNumber : ''}</div>;
        })}
      </div>
      <div className="axis">{ticks.map((h) => <span key={h}>{((h + 11) % 12) + 1}{h < 12 ? 'a' : 'p'}</span>)}</div>
    </div>
  );
}

function MachineSheet({ mc, sched }) {
  const s = mc.summary;
  return (
    <div className="cds-sheet">
      <div className="cds-hdr">
        <div>
          <h1>{mc.machine.toUpperCase()} — Daily Schedule</h1>
          <div className="sub">Department: {mc.label} · Daily {mc.label} Plan</div>
          <div className="co">{COMPANY}</div>
        </div>
        <div className="meta">
          Date: {sched.date || '—'}<br />
          Shift: {((sched.shiftStartHour + 11) % 12) + 1}{sched.shiftStartHour < 12 ? 'AM' : 'PM'}–{((sched.shiftEndHour + 11) % 12) + 1}{sched.shiftEndHour < 12 ? 'AM' : 'PM'} · {sched.shiftHours} h<br />
          Jobs: {s.jobCount} · Total {m(s.totalLength)}
        </div>
      </div>

      {s.overbooked
        ? <div className="cds-warn">⚠ Schedule is NOT realistic — planned {fmt(s.usedHours)} h exceeds the {fmt(s.availableHours)} h shift by {fmt(s.overbookedByHours)} h. Move a job, add a shift, or split across machines.</div>
        : <div className="cds-ok">✓ Schedule fits the shift — {fmt(s.bufferHours)} h buffer remaining.</div>}

      <CapacityBar s={s} />
      <Queue q={mc.queue} />
      <Timeline mc={mc} sched={sched} />

      <table className="cds-tbl">
        <thead>
          <tr>
            <th>#</th><th>Plan</th><th>Customer</th><th>Product</th><th>Length</th>
            <th>Start</th><th>Finish</th><th>Changeover</th>
            <th>Target / Actual</th><th>Downtime</th><th>Rejection</th><th>Remarks / Sign</th>
          </tr>
        </thead>
        <tbody>
          {mc.jobs.map((j, i) => (
            <React.Fragment key={i}>
              <tr>
                <td className="seq" style={{ color: JOB_COLORS[i % JOB_COLORS.length] }}>{j.seq}</td>
                <td><b>{j.planNumber}</b></td>
                <td>{j.customer}</td>
                <td>{j.product}<br /><span style={{ fontSize: 11, color: '#555' }}>{stageDetail(mc.stage, j)}</span></td>
                <td className="c"><b>{m(j.length)}</b></td>
                <td className="c"><b>{j.startTime}</b></td>
                <td className="c"><b>{j.finishTime}</b><br /><span style={{ fontSize: 10.5, color: '#555' }}>{fmt(j.durationHours)} h</span></td>
                <td>{j.changeover ? (<>
                  {j.changeover.colourChange && <span className="cds-chip col">Colour</span>}
                  {j.changeover.sizeChange && <span className="cds-chip size">Size</span>}
                  {j.changeover.drumChange && <span className="cds-chip drum">Drum</span>}
                  <br /><span style={{ fontSize: 10.5, color: '#555' }}>Setup {j.changeover.setupMin}m</span>
                </>) : <span style={{ fontSize: 11, color: '#888' }}>first job</span>}</td>
                <td className="c"><b>{m(j.target)}</b><br /><span className="cds-entry">actual ______</span></td>
                <td className="c cds-entry">____ min</td>
                <td className="c cds-entry">____</td>
                <td className="cds-entry">__________________</td>
              </tr>
              {mc.stage === 'core' && j.colourSequence && (
                <tr className="cds-sub"><td></td><td colSpan={11}>
                  <b>Colour sequence:</b>{' '}
                  {j.colourSequence.map((c, k) => (
                    <span key={k} style={{ marginRight: 14 }}><b>{c.colour}</b> {c.startTime}–{c.finishTime} (OD {c.coreOd || '—'}mm, {m(c.length)}){k < j.colourSequence.length - 1 ? '  →' : ''}</span>
                  ))}
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      <div className="cds-sumline">
        <span>Total planned length: <b>{m(s.totalLength)}</b></span>
        <span>Planned hours: <b>{fmt(s.plannedHours)} h</b></span>
        <span>Changeover: <b>{fmt(s.changeoverHours)} h</b></span>
        <span>Available: <b>{fmt(s.availableHours)} h</b></span>
        <span>Utilisation: <b>{fmt(s.utilizationPct)}%</b></span>
        <span>Buffer: <b>{fmt(s.bufferHours)} h</b></span>
      </div>
    </div>
  );
}

// Stage-specific one-liner under the product.
function stageDetail(stage, j) {
  if (stage === 'laying') return `${j.cores} cores · ${j.colourCombination} · loss ${j.layingLossPct || 0}%`;
  if (stage === 'sheathing') return `${j.shape} · OD ${j.finishedOd || '—'}mm · ${(j.colours || []).join(', ')}`;
  if (stage === 'bunching') return `${j.cores} cores · ${j.conductorSize} sqmm`;
  if (stage === 'core') return `${j.cores} cores · Core OD ${j.coreOd || '—'}mm`;
  return '';
}

function ManagementSheet({ sched }) {
  const mg = sched.management;
  return (
    <div className="cds-sheet cds-mgmt">
      <div className="cds-hdr">
        <div>
          <h1>Daily Production Schedule — Management View</h1>
          <div className="sub">PPC / Production Manager · machine loading, bottlenecks & schedule adherence</div>
          <div className="co">{COMPANY}</div>
        </div>
        <div className="meta">Date: {sched.date || '—'}<br />Shift: {sched.shiftHours} h<br />Total jobs: {mg.totalJobs} · {fmt(mg.totalPlannedHours)} h</div>
      </div>

      <h2>Machine Loading & Utilisation</h2>
      <table className="cds-tbl">
        <thead><tr><th>Machine</th><th>Department</th><th>Jobs</th><th>Planned Hours</th><th>Utilisation %</th><th>Buffer Hours</th><th>Status</th></tr></thead>
        <tbody>
          {mg.machineLoad.map((ml) => (
            <tr key={ml.machine}>
              <td><b>{ml.machine}</b></td><td className="c">{ml.stage}</td><td className="c">{ml.jobs}</td>
              <td className="c">{fmt(ml.plannedHours)} h</td>
              <td className="c" style={{ fontWeight: 800, color: ml.utilizationPct > 100 ? '#dc2626' : ml.utilizationPct > 85 ? '#d97706' : '#16a34a' }}>{fmt(ml.utilizationPct)}%</td>
              <td className="c">{fmt(ml.bufferHours)} h</td>
              <td className="c" style={{ fontWeight: 800, color: ml.overbooked ? '#dc2626' : '#16a34a' }}>{ml.overbooked ? 'OVERBOOKED' : 'OK'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Bottlenecks {mg.bottlenecks.length ? `(${mg.bottlenecks.length})` : ''}</h2>
      {mg.bottlenecks.length ? (
        <table className="cds-tbl"><thead><tr><th>Machine</th><th>Overbooked by</th><th>Utilisation %</th></tr></thead>
          <tbody>{mg.bottlenecks.map((b) => <tr key={b.machine}><td><b>{b.machine}</b></td><td className="c" style={{ color: '#dc2626', fontWeight: 800 }}>{fmt(b.overbookedByHours)} h</td><td className="c">{fmt(b.utilizationPct)}%</td></tr>)}</tbody>
        </table>
      ) : <div className="cds-ok">No bottlenecks — every machine fits within its shift.</div>}

      <h2>Delayed Jobs {mg.delayedJobs.length ? `(${mg.delayedJobs.length})` : ''}</h2>
      {mg.delayedJobs.length ? (
        <table className="cds-tbl"><thead><tr><th>Machine</th><th>Plan</th><th>Customer</th><th>Finishes</th></tr></thead>
          <tbody>{mg.delayedJobs.map((d, i) => <tr key={i}><td>{d.machine}</td><td><b>{d.planNumber}</b></td><td>{d.customer}</td><td className="c" style={{ color: '#dc2626', fontWeight: 800 }}>{d.finishTime} (past shift)</td></tr>)}</tbody>
        </table>
      ) : <div className="cds-ok">No jobs run past the shift end.</div>}

      <div className="cds-sumline" style={{ marginTop: 14 }}>
        <span>Total jobs: <b>{mg.totalJobs}</b></span>
        <span>Total planned hours: <b>{fmt(mg.totalPlannedHours)} h</b></span>
        <span>Avg utilisation: <b>{fmt(mg.avgUtilizationPct)}%</b></span>
        <span>Machines loaded: <b>{mg.machineLoad.length}</b></span>
      </div>
    </div>
  );
}

export default function CableDaySchedule({ schedule }) {
  if (!schedule || !schedule.order.length) return null;
  return (
    <div className="cds-print">
      <style>{PRINT_CSS}</style>
      <ManagementSheet sched={schedule} />
      {schedule.order.map((stage) => <MachineSheet key={stage} mc={schedule.machines[stage]} sched={schedule} />)}
    </div>
  );
}
