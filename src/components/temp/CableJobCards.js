// Cable Planning Workbench — shop-floor output. Renders a Master Planning Sheet
// + one operator Job Card per required department (Bunching / Core Extrusion /
// Laying / Sheathing). Each card is a single A4 page: large fonts, bilingual
// labels, a QR code, and an operator-entry / rejection / downtime / efficiency
// section so the same sheet is both a Production Instruction AND a Recording
// sheet. Print via window.print() — @media print isolates the print root and
// page-breaks between cards. Not ERP-style; designed to be handed to the floor.
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { makeT, tr, REJECTION_REASONS, DOWNTIME_REASONS } from '../../services/temp/cablePlanLabels';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const m = (n) => `${fmt(n)} m`;
const kg = (n) => `${fmt(n)} kg`;
const COMPANY = 'REYANSH INTERNATIONAL PVT. LTD.';

const PRINT_CSS = `
.cpd-print { font-family: 'Inter', Arial, sans-serif; color: #111; }
.cpd-page { background:#fff; width: 190mm; min-height: 272mm; margin: 0 auto 16px; padding: 8mm; border: 1px solid #d0d0d0; box-sizing: border-box; }
.cpd-hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid #111; padding-bottom: 6px; }
.cpd-hdr h1 { font-size: 22px; margin: 0; font-weight: 800; letter-spacing: .3px; }
.cpd-hdr h2 { font-size: 14px; margin: 2px 0 0; font-weight: 700; color:#333; }
.cpd-co { font-size: 12px; color:#555; margin-top: 2px; }
.cpd-qr { text-align:center; }
.cpd-qr small { display:block; font-size: 8px; color:#666; margin-top:2px; max-width: 90px; }
.cpd-meta { display:grid; grid-template-columns: repeat(3, 1fr); gap: 0 14px; margin: 8px 0; }
.cpd-meta div { font-size: 13px; padding: 3px 0; border-bottom: 1px dotted #bbb; }
.cpd-meta b { font-weight: 700; }
.cpd-sec { margin-top: 10px; border: 1.5px solid #222; border-radius: 4px; overflow:hidden; }
.cpd-sec > .cpd-sec-h { background:#222; color:#fff; font-size: 13px; font-weight: 800; padding: 4px 8px; letter-spacing:.3px; }
.cpd-rows { padding: 6px 8px; }
.cpd-row { display:flex; justify-content:space-between; gap: 10px; font-size: 14px; padding: 4px 0; border-bottom: 1px dotted #ccc; }
.cpd-row:last-child { border-bottom: none; }
.cpd-row .k { color:#333; } .cpd-row .v { font-weight:800; text-align:right; }
table.cpd-tbl { width:100%; border-collapse: collapse; font-size: 13px; }
table.cpd-tbl th, table.cpd-tbl td { border: 1px solid #999; padding: 4px 6px; text-align:center; }
table.cpd-tbl th { background:#eee; font-weight:800; font-size: 11px; }
.cpd-entry { display:grid; grid-template-columns: repeat(2, 1fr); gap: 6px 16px; padding: 8px; }
.cpd-blank { font-size: 14px; } .cpd-blank .lbl { color:#333; } .cpd-blank .ln { display:inline-block; border-bottom: 1.5px solid #111; min-width: 90px; height: 18px; vertical-align: bottom; margin-left:6px; }
.cpd-two { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cpd-ticks { display:flex; flex-wrap:wrap; gap: 4px 14px; padding: 6px 8px; }
.cpd-tick { font-size: 12.5px; } .cpd-tick .bx { display:inline-block; width:13px; height:13px; border:1.5px solid #111; margin-right:5px; vertical-align:-2px; }
.cpd-eff { display:grid; grid-template-columns: repeat(5,1fr); }
.cpd-eff div { border-right:1px solid #999; padding: 6px 4px; text-align:center; }
.cpd-eff div:last-child { border-right:none; }
.cpd-eff .lbl { font-size: 10.5px; color:#444; font-weight:700; }
.cpd-eff .box { height: 26px; border-bottom: 2px solid #111; margin-top: 6px; }
.cpd-sign { display:flex; justify-content:space-between; padding: 14px 8px 4px; }
.cpd-sign div { text-align:center; font-size: 12px; } .cpd-sign .ln { border-top: 1.5px solid #111; width: 200px; margin-top: 28px; padding-top: 3px; }
@media screen { .cpd-print { background:#eef0f3; padding: 16px; } }
@media print {
  @page { size: A4 portrait; margin: 7mm; }
  html, body { background:#fff !important; }
  body * { visibility: hidden !important; }
  .cpd-print, .cpd-print * { visibility: visible !important; }
  .cpd-print { position: absolute; left: 0; top: 0; width: 100%; background:#fff; padding:0; font-size: 11px; }
  .cpd-toolbar { display: none !important; }
  /* one card == exactly one A4 page: start on a fresh page AND never split */
  .cpd-page { border: none; margin: 0; width: 100%; min-height: auto; height: auto; padding: 0;
    page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
  .cpd-page:last-child { page-break-after: auto; break-after: auto; }
  .cpd-sec, .cpd-two, .cpd-eff, .cpd-sign, table.cpd-tbl, .cpd-rows { page-break-inside: avoid; break-inside: avoid; }
  /* compact the layout so the densest card (4-core core-extrusion) fits one page */
  .cpd-hdr h1 { font-size: 17px; } .cpd-hdr h2 { font-size: 10.5px; } .cpd-co { font-size: 10px; }
  .cpd-meta { margin: 5px 0; } .cpd-meta div { font-size: 10.5px; padding: 2px 0; }
  .cpd-sec { margin-top: 6px; } .cpd-sec > .cpd-sec-h { font-size: 10.5px; padding: 3px 6px; }
  .cpd-rows { padding: 3px 6px; } .cpd-row { font-size: 11px; padding: 2px 0; }
  table.cpd-tbl { font-size: 10px; } table.cpd-tbl th, table.cpd-tbl td { padding: 2.5px 4px; }
  table.cpd-tbl th { font-size: 9px; }
  .cpd-entry { padding: 5px 6px; gap: 4px 14px; } .cpd-blank { font-size: 11px; } .cpd-blank .ln { height: 15px; }
  .cpd-ticks { padding: 3px 6px; gap: 3px 12px; } .cpd-tick { font-size: 10px; }
  .cpd-eff div { padding: 4px 3px; } .cpd-eff .lbl { font-size: 9px; } .cpd-eff .box { height: 22px; margin-top: 4px; }
  .cpd-sign { padding: 8px 6px 2px; } .cpd-sign .ln { margin-top: 20px; width: 180px; }
}
`;

function QR({ plan, product, machine, dept }) {
  const value = ['RII', plan || 'DRAFT', product || '', machine || '', dept || ''].join('|');
  return (
    <div className="cpd-qr">
      <QRCodeSVG value={value} size={84} level="M" />
      <small>{plan || 'DRAFT'} · {dept}</small>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="cpd-sec">
      <div className="cpd-sec-h">{title}</div>
      {children}
    </div>
  );
}

const Rows = ({ rows }) => (
  <div className="cpd-rows">
    {rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => (
      <div className="cpd-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
    ))}
  </div>
);

const Blank = ({ label, wide }) => (
  <div className="cpd-blank" style={wide ? { gridColumn: '1 / -1' } : undefined}>
    <span className="lbl">{label}</span><span className="ln" style={wide ? { minWidth: '70%' } : undefined} />
  </div>
);

// Target-vs-Actual efficiency footer (feeds MIS later).
function EfficiencyFooter({ t, targetQty }) {
  const cols = [
    [t('targetQuantity'), targetQty != null ? fmt(targetQty) : ''],
    [t('actualQuantity'), ''],
    [t('efficiencyPct'), ''],
    [t('rejectionPct'), ''],
    [t('downtimePct'), ''],
  ];
  return (
    <Section title={t('targetVsActual')}>
      <div className="cpd-eff">
        {cols.map(([lbl, val], i) => (
          <div key={i}><div className="lbl">{lbl}</div><div className="box">{val}</div></div>
        ))}
      </div>
    </Section>
  );
}

function Signatures({ t }) {
  return (
    <div className="cpd-sign">
      <div><div className="ln">{t('operatorSignature')}</div></div>
      <div><div className="ln">{t('supervisorSignature')}</div></div>
    </div>
  );
}

function CardShell({ title, plan, info, dept, children }) {
  const { t } = info;
  return (
    <div className="cpd-page">
      <div className="cpd-hdr">
        <div>
          <h1>{title}</h1>
          <h2>{tr({ en: 'Production Instruction & Recording Sheet', hi: 'उत्पादन निर्देश एवं रिकॉर्डिंग शीट' }, t.lang)}</h2>
          <div className="cpd-co">{COMPANY}</div>
        </div>
        <QR plan={plan.number} product={info.product} machine={info.machine} dept={info.deptName} />
      </div>
      <div className="cpd-meta">
        <div><b>{t('planNumber')}:</b> {plan.number || 'DRAFT'}</div>
        <div><b>{t('date')}:</b> {info.date}</div>
        <div><b>{t('machine')}:</b> {info.machine}</div>
        <div><b>{t('customer')}:</b> {info.customer || '—'}</div>
        <div><b>{t('cable')}:</b> {info.cable || '—'}</div>
        <div><b>{t('operator')}:</b> ______________</div>
      </div>
      {children}
    </div>
  );
}

// Rejection + downtime blocks (shared by every job card).
function RejectionDowntime({ t }) {
  return (
    <div className="cpd-two" style={{ marginTop: 10 }}>
      <Section title={`${t('rejectionTracking')}  ·  ${t('rejectionQty')} ____  ${t('rejectionPct')} ____`}>
        <div className="cpd-ticks">
          {REJECTION_REASONS.map((it, i) => <span className="cpd-tick" key={i}><span className="bx" />{tr(it, t.lang)}</span>)}
        </div>
      </Section>
      <Section title={`${t('downtimeTracking')}  ·  ${t('downtimeMin')} ____`}>
        <div className="cpd-ticks">
          {DOWNTIME_REASONS.map((it, i) => <span className="cpd-tick" key={i}><span className="bx" />{tr(it, t.lang)}</span>)}
        </div>
      </Section>
    </div>
  );
}

function OperatorEntry({ t, extra = [] }) {
  return (
    <Section title={t('operatorEntry')}>
      <div className="cpd-entry">
        {extra.map((label, i) => <Blank key={i} label={label} />)}
        <Blank label={t('startTime')} />
        <Blank label={t('endTime')} />
        <Blank label={t('remarks')} wide />
      </div>
      <Signatures t={t} />
    </Section>
  );
}

/* ---- per-department job cards ---- */

function BunchingCard({ plan, info }) {
  const t = info.t; const d = plan.departments.bunching;
  return (
    <CardShell title={`${info.tBare('bunching')} ${info.tBare('jobCard')}`} plan={plan} info={{ ...info, machine: d.machine, deptName: 'Bunching' }} dept={d}>
      <Section title={t('technicalData')}>
        <Rows rows={[
          [t('numberOfStrands'), d.strands || '—'],
          [t('strandDiameter'), d.strandDia ? `${d.strandDia} mm` : '—'],
          [t('copperConstruction'), d.copperConstruction || '—'],
          [t('copperArea'), d.copperArea ? `${d.copperArea} sqmm` : '—'],
          [t('requiredLength'), m(d.length)],
          [t('requiredQuantity'), `${m(d.length)}  (${d.note})`],
          [t('wastagePct'), `${plan.config.wastagePct}%`],
          [t('targetProduction'), m(d.planningLength)],
        ]} />
      </Section>
      <Section title={t('machineData')}>
        <Rows rows={[
          [t('machineCapacity'), `${fmt(d.speed)} m/hr · ${fmt(d.dailyCapacity)} m/${info.shift}`],
          [t('expectedHours'), `${fmt(d.requiredHours)} hr  (${fmt(d.utilizationPct)}% / ${info.shift})`],
          [t('targetCompletion'), info.dueDate || '—'],
        ]} />
      </Section>
      <OperatorEntry t={t} extra={[t('actualProduction')]} />
      <RejectionDowntime t={t} />
      <EfficiencyFooter t={t} targetQty={d.planningLength} />
    </CardShell>
  );
}

function CoreCard({ plan, info }) {
  const t = info.t; const d = plan.departments.core;
  return (
    <CardShell title={`${info.tBare('coreExtrusion')} ${info.tBare('jobCard')}`} plan={plan} info={{ ...info, machine: d.machine, deptName: 'Core Extrusion' }} dept={d}>
      <Section title={`${t('technicalData')} — ${plan.config.cores} ${info.tBare('numberOfCores')}`}>
        <table className="cpd-tbl">
          <thead><tr>
            <th>#</th><th>{t('coreColour')}</th><th>{t('coreSize')}</th><th>{t('coreOd')}</th>
            <th>{t('copperConstruction')}</th><th>{t('requiredLength')}</th><th>{t('targetLength')}</th>
          </tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.coreNo}>
                <td>{r.coreNo}</td><td>{r.colour}</td><td>{r.size} sqmm</td>
                <td>{r.coreOd ? `${r.coreOd} mm` : '—'}</td><td>{r.copperConstruction || '—'}</td>
                <td>{m(r.requiredLength)}</td><td>{m(r.targetLength)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Rows rows={[
          [t('insulationThickness'), `${d.insThick} mm`],
          [t('wastagePct'), `${plan.config.wastagePct}%`],
        ]} />
      </Section>
      <Section title={t('machineData')}>
        <Rows rows={[
          [t('machineCapacity'), `${fmt(d.speed)} m/hr · ${fmt(d.dailyCapacity)} m/${info.shift}`],
          [t('expectedHours'), `${fmt(d.requiredHours)} hr  (${fmt(d.utilizationPct)}% / ${info.shift})`],
          [t('targetCompletion'), info.dueDate || '—'],
        ]} />
      </Section>
      <OperatorEntry t={t} extra={[t('actualProduction'), t('actualCoreOd')]} />
      <RejectionDowntime t={t} />
      <EfficiencyFooter t={t} targetQty={d.planningLength} />
    </CardShell>
  );
}

function LayingCard({ plan, info }) {
  const t = info.t; const d = plan.departments.laying;
  return (
    <CardShell title={`${info.tBare('laying')} ${info.tBare('jobCard')}`} plan={plan} info={{ ...info, machine: d.machine, deptName: 'Laying' }} dept={d}>
      <Section title={t('technicalData')}>
        <Rows rows={[
          [t('numberOfCores'), d.cores],
          [t('colourCombination'), d.colourCombination],
          [t('coreOd'), d.coreOd ? `${d.coreOd} mm` : '—'],
          [t('requiredLength'), m(d.length)],
          [t('layingLossPct'), `${d.layingLossPct}%`],
          [t('targetLength'), m(d.planningLength)],
        ]} />
      </Section>
      <Section title={t('machineData')}>
        <Rows rows={[
          [t('machineCapacity'), `${fmt(d.speed)} m/hr · ${fmt(d.dailyCapacity)} m/${info.shift}`],
          [t('expectedHours'), `${fmt(d.requiredHours)} hr  (${fmt(d.utilizationPct)}% / ${info.shift})`],
          [t('targetCompletion'), info.dueDate || '—'],
        ]} />
      </Section>
      <OperatorEntry t={t} extra={[t('actualLength')]} />
      <RejectionDowntime t={t} />
      <EfficiencyFooter t={t} targetQty={d.planningLength} />
    </CardShell>
  );
}

function SheathingCard({ plan, info }) {
  const t = info.t; const d = plan.departments.sheathing;
  return (
    <CardShell title={`${info.tBare('sheathing')} ${info.tBare('jobCard')}`} plan={plan} info={{ ...info, machine: d.machine, deptName: 'Sheathing' }} dept={d}>
      <Section title={t('technicalData')}>
        <Rows rows={[
          [t('flatRound'), d.shape],
          [t('finishedOd'), d.finishedOd ? `${d.finishedOd} mm` : '—'],
          [t('numberOfCores'), d.cores],
          [t('colours'), d.colour],
          [t('length'), m(d.length)],
          [t('targetLength'), m(d.planningLength)],
        ]} />
      </Section>
      <Section title={t('machineData')}>
        <Rows rows={[
          [t('machineCapacity'), `${fmt(d.speed)} m/hr · ${fmt(d.dailyCapacity)} m/${info.shift}`],
          [t('expectedHours'), `${fmt(d.requiredHours)} hr  (${fmt(d.utilizationPct)}% / ${info.shift})`],
          [t('targetCompletion'), info.dueDate || '—'],
        ]} />
      </Section>
      <OperatorEntry t={t} extra={[t('actualProduction'), t('actualFinishedOd')]} />
      <RejectionDowntime t={t} />
      <EfficiencyFooter t={t} targetQty={d.planningLength} />
    </CardShell>
  );
}

function MasterSheet({ plan, info }) {
  const t = info.t; const s = plan.summary; const mt = plan.material; const c = plan.config;
  return (
    <div className="cpd-page">
      <div className="cpd-hdr">
        <div>
          <h1>{info.tBare('masterPlanningSheet')}</h1>
          <h2>PPC · {tr({ en: 'Production Manager', hi: 'उत्पादन प्रबंधक' }, t.lang)} · {tr({ en: 'Planner', hi: 'प्लानर' }, t.lang)}</h2>
          <div className="cpd-co">{COMPANY}</div>
        </div>
        <QR plan={plan.number} product={info.product} machine="ALL" dept="Master" />
      </div>
      <div className="cpd-meta">
        <div><b>{t('planNumber')}:</b> {plan.number || 'DRAFT'}</div>
        <div><b>{t('date')}:</b> {info.date}</div>
        <div><b>{t('priority')}:</b> {info.priority || '—'}</div>
        <div><b>{t('customer')}:</b> {info.customer || '—'}</div>
        <div><b>{t('product')}:</b> {info.product || '—'}</div>
        <div><b>{t('deliveryDate')}:</b> {info.due || '—'}</div>
      </div>
      <div className="cpd-two">
        <Section title={t('cableType')}>
          <Rows rows={[
            [t('numberOfCores'), c.cores],
            [t('flatRound'), c.shape],
            [t('size'), c.conductorSize ? `${c.conductorSize} sqmm` : '—'],
            [t('copperConstruction'), c.copperConstruction || '—'],
            [t('coreOd'), c.coreOd ? `${c.coreOd} mm` : '—'],
            [t('finishedOd'), c.finishedOd ? `${c.finishedOd} mm` : '—'],
            [t('colours'), c.colours.join(', ')],
          ]} />
        </Section>
        <Section title={`${t('departmentPlan')} · ${t('finishedCableLength')} ${m(s.finishedLength)}`}>
          <Rows rows={[
            [t('coreProductionLength'), m(s.coreProductionLength)],
            [t('bunchingLength'), s.bunchingLength ? m(s.bunchingLength) : '—'],
            [t('layingLength'), s.layingLength ? m(s.layingLength) : '—'],
            [t('sheathingLength'), s.sheathingLength ? m(s.sheathingLength) : '—'],
            [t('wastagePct'), `${s.wastagePct}%`],
            [t('layingLossPct'), c.layingLossPct ? `${c.layingLossPct}%` : '—'],
            [t('totalPlannedLength'), m(s.totalPlannedLength)],
          ]} />
        </Section>
      </div>
      <Section title={t('machineLoading')}>
        <table className="cpd-tbl">
          <thead><tr>
            <th>{t('department')}</th><th>{t('machine')}</th><th>{t('requiredLength')}</th>
            <th>{t('machineCapacity')}</th><th>{t('requiredHours')}</th><th>{t('utilization')}</th><th>{t('leadTime')}</th>
          </tr></thead>
          <tbody>
            {s.machineLoad.map((ml) => (
              <tr key={ml.stage}>
                <td>{tr({ en: ml.label, hi: '' }, 'english')}</td><td>{ml.machine}</td><td>{m(ml.requiredLength)}</td>
                <td>{fmt(ml.capacity)} m/day</td><td>{fmt(ml.hours)} hr</td><td>{fmt(ml.utilizationPct)}%</td>
                <td>{fmt(ml.cumulativeDays)} d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title={t('materialRequirement')}>
        <table className="cpd-tbl">
          <thead><tr><th>{t('materialRequirement')}</th><th>{t('requiredQuantity')}</th><th>{t('wastagePct')} ({mt.wastagePct}%)</th><th>{tr({ en: 'Incl. wastage', hi: 'वेस्टेज सहित' }, t.lang)}</th></tr></thead>
          <tbody>
            <tr><td>{tr({ en: 'Copper conductor', hi: 'कॉपर' }, t.lang)}</td><td>{kg(mt.copper)}</td><td>{kg(mt.estWastageCopper)}</td><td><b>{kg(mt.copperWithWastage)}</b></td></tr>
            <tr><td>{tr({ en: 'PVC (ins + sheath)', hi: 'PVC (इन्स + शीथ)' }, t.lang)}</td><td>{kg(mt.pvcTotal)}</td><td>{kg(mt.estWastagePvc)}</td><td><b>{kg(mt.pvcWithWastage)}</b></td></tr>
          </tbody>
        </table>
      </Section>
      <div className="cpd-meta" style={{ marginTop: 10 }}>
        <div><b>{t('targetCompletion')}:</b> ~{fmt(s.leadDays)} {tr({ en: 'working days', hi: 'कार्य दिवस' }, t.lang)}</div>
        <div><b>{t('leadTime')}:</b> {plan.routing.map((r) => r.label).join(' → ')}</div>
      </div>
    </div>
  );
}

const CARD_FOR = { bunching: BunchingCard, core: CoreCard, laying: LayingCard, sheathing: SheathingCard };

/** Full document set (master sheet + required job cards) for one plan. */
export default function CableJobCards({ plan, form, planNumber, lang = 'bilingual' }) {
  if (!plan) return null;
  const t = makeT(lang); t.lang = lang;
  const tBare = (k) => makeT(lang)(k);
  const shift = tr({ en: 'shift', hi: 'शिफ्ट' }, lang);
  const info = {
    t, tBare, shift, lang,
    customer: form.customerName, product: form.productName,
    cable: form.cableDescription || `${plan.config.cores}C ${plan.config.conductorSize} sqmm`,
    date: new Date().toLocaleDateString('en-IN'),
    due: form.deliveryDate, dueDate: form.deliveryDate, priority: form.priority,
  };
  const planObj = { ...plan, number: planNumber };
  const stages = plan.flow.filter((f) => f.required && CARD_FOR[f.stage]).map((f) => f.stage);
  return (
    <div className="cpd-print">
      <style>{PRINT_CSS}</style>
      <MasterSheet plan={planObj} info={info} />
      {stages.map((stage) => {
        const Card = CARD_FOR[stage];
        return <Card key={stage} plan={planObj} info={info} />;
      })}
    </div>
  );
}
