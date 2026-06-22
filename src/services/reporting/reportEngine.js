// Reusable, domain-agnostic reporting engine.
// Any module (CRM, Sales, KIT, Production, Employee, MIS) builds a `Report`
// object of the shape below and hands it to one of the exporters. Nothing here
// knows about CRM — keep it that way so new report types are just new builders.
//
// Report shape:
//   {
//     key:        string,                 // e.g. "crm-action"
//     title:      string,                 // "CRM Action Report"
//     subtitle?:  string,                 // org / context line
//     generatedAt: Date,
//     dateRange?: { label, from?, to? },
//     kpis?:      [{ label, value, hint? }],          // summary cards
//     narrative?: string,                              // auto-generated summary
//     actions?:   string[],                            // "what to do next" bullets
//     sections:   [{
//        key, title,
//        columns: [{ key, label, align? }],
//        rows:    [ { [colKey]: value } ],
//        emptyText?: string,
//     }],
//   }
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const pad = (n) => String(n).padStart(2, "0");
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
export function fileBase(report) {
  return `${report.key || "report"}_${stamp(report.generatedAt || new Date())}`;
}

const cell = (row, col) => {
  const v = row[col.key];
  if (v == null) return "";
  return Array.isArray(v) ? v.join(" | ") : String(v);
};

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- CSV ----------------------------------------------------------------
// One file; sections stacked with a title row + header row each.
export function downloadReportCSV(report) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [];
  lines.push(esc(report.title));
  if (report.dateRange?.label) lines.push(esc(`Period: ${report.dateRange.label}`));
  lines.push(esc(`Generated: ${(report.generatedAt || new Date()).toLocaleString()}`));
  lines.push("");
  if (report.kpis?.length) {
    lines.push(esc("Summary"));
    report.kpis.forEach((k) => lines.push([esc(k.label), esc(k.value)].join(",")));
    lines.push("");
  }
  for (const sec of report.sections || []) {
    lines.push(esc(sec.title));
    lines.push(sec.columns.map((c) => esc(c.label)).join(","));
    if (!sec.rows.length) lines.push(esc(sec.emptyText || "No records"));
    sec.rows.forEach((r) => lines.push(sec.columns.map((c) => esc(cell(r, c))).join(",")));
    lines.push("");
  }
  if (report.actions?.length) {
    lines.push(esc("Recommended actions"));
    report.actions.forEach((a) => lines.push(esc(a)));
  }
  triggerDownload(
    new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" }),
    `${fileBase(report)}.csv`
  );
}

// ---- Excel (xlsx) -------------------------------------------------------
// Summary sheet + one sheet per section.
export function downloadReportExcel(report) {
  const wb = XLSX.utils.book_new();

  const summary = [];
  summary.push([report.title]);
  if (report.subtitle) summary.push([report.subtitle]);
  if (report.dateRange?.label) summary.push([`Period: ${report.dateRange.label}`]);
  summary.push([`Generated: ${(report.generatedAt || new Date()).toLocaleString()}`]);
  summary.push([]);
  if (report.kpis?.length) {
    summary.push(["Summary"]);
    report.kpis.forEach((k) => summary.push([k.label, k.value]));
    summary.push([]);
  }
  if (report.narrative) {
    summary.push(["Auto summary"]);
    summary.push([report.narrative]);
    summary.push([]);
  }
  if (report.actions?.length) {
    summary.push(["Recommended actions"]);
    report.actions.forEach((a) => summary.push([a]));
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  for (const sec of report.sections || []) {
    const aoa = [sec.columns.map((c) => c.label)];
    if (!sec.rows.length) aoa.push([sec.emptyText || "No records"]);
    sec.rows.forEach((r) => aoa.push(sec.columns.map((c) => cell(r, c))));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // crude autosize
    ws["!cols"] = sec.columns.map((c) => ({
      wch: Math.min(40, Math.max(c.label.length + 2, ...sec.rows.map((r) => cell(r, c).length + 2), 8)),
    }));
    const name = (sec.title || sec.key || "Sheet").slice(0, 31).replace(/[\\/?*[\]:]/g, " ");
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, `${fileBase(report)}.xlsx`);
}

// ---- PDF (jsPDF + autotable) -------------------------------------------
export function downloadReportPDF(report) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  let y = 44;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(report.title, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  y += 16;
  const meta = [
    report.subtitle,
    report.dateRange?.label ? `Period: ${report.dateRange.label}` : null,
    `Generated: ${(report.generatedAt || new Date()).toLocaleString()}`,
  ]
    .filter(Boolean)
    .join("   •   ");
  doc.text(meta, M, y);
  doc.setTextColor(0);
  y += 14;

  // KPI strip
  if (report.kpis?.length) {
    const cols = 4;
    const gap = 8;
    const cardW = (W - M * 2 - gap * (cols - 1)) / cols;
    const cardH = 38;
    report.kpis.forEach((k, i) => {
      const col = i % cols;
      if (col === 0 && i > 0) y += cardH + gap;
      const x = M + col * (cardW + gap);
      doc.setDrawColor(225);
      doc.setFillColor(247, 249, 251);
      doc.roundedRect(x, y, cardW, cardH, 4, 4, "FD");
      doc.setFontSize(7.5);
      doc.setTextColor(120);
      doc.text(String(k.label).toUpperCase(), x + 8, y + 13);
      doc.setFontSize(12);
      doc.setTextColor(20);
      doc.setFont("helvetica", "bold");
      doc.text(String(k.value), x + 8, y + 29);
      doc.setFont("helvetica", "normal");
    });
    y += cardH + 14;
  }

  // Narrative
  if (report.narrative) {
    doc.setFillColor(238, 244, 255);
    const lines = doc.splitTextToSize(report.narrative, W - M * 2 - 16);
    const boxH = lines.length * 11 + 16;
    doc.roundedRect(M, y, W - M * 2, boxH, 4, 4, "F");
    doc.setFontSize(9);
    doc.setTextColor(30);
    doc.text(lines, M + 8, y + 14);
    y += boxH + 12;
  }

  for (const sec of report.sections || []) {
    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      y = 44;
    }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20);
    doc.text(sec.title, M, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [sec.columns.map((c) => c.label)],
      body: sec.rows.length
        ? sec.rows.map((r) => sec.columns.map((c) => cell(r, c)))
        : [[{ content: sec.emptyText || "No records", colSpan: sec.columns.length, styles: { textColor: 150, halign: "center" } }]],
      headStyles: { fillColor: [37, 99, 235], fontSize: 8, halign: "left" },
      bodyStyles: { fontSize: 7.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { cellPadding: 3, overflow: "linebreak" },
    });
    y = doc.lastAutoTable.finalY + 24;
  }

  if (report.actions?.length) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Recommended actions", M, y);
    y += 14;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    report.actions.forEach((a) => {
      doc.text(`•  ${a}`, M, y);
      y += 13;
    });
  }

  doc.save(`${fileBase(report)}.pdf`);
}

// ---- Print (HTML window) ------------------------------------------------
export function printReport(report) {
  const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const kpis = (report.kpis || [])
    .map((k) => `<div class="kpi"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div></div>`)
    .join("");
  const sections = (report.sections || [])
    .map((sec) => {
      const head = sec.columns.map((c) => `<th>${esc(c.label)}</th>`).join("");
      const body = sec.rows.length
        ? sec.rows.map((r) => `<tr>${sec.columns.map((c) => `<td>${esc(cell(r, c))}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${sec.columns.length}" class="empty">${esc(sec.emptyText || "No records")}</td></tr>`;
      return `<h3>${esc(sec.title)}</h3><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    })
    .join("");
  const actions = report.actions?.length
    ? `<h3>Recommended actions</h3><ul>${report.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
  <style>
    body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2233;margin:28px;}
    h1{font-size:20px;margin:0 0 2px;} .meta{color:#667;font-size:12px;margin-bottom:14px;}
    .kpis{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}
    .kpi{border:1px solid #e3e8ef;border-radius:6px;padding:8px 12px;min-width:130px;background:#f8fafc;}
    .kl{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#789;}
    .kv{font-size:17px;font-weight:700;}
    .narrative{background:#eef4ff;border-radius:6px;padding:10px 12px;font-size:13px;margin-bottom:14px;}
    h3{font-size:13px;margin:18px 0 6px;} table{border-collapse:collapse;width:100%;font-size:11px;}
    th{background:#2563eb;color:#fff;text-align:left;padding:5px 7px;} td{border-bottom:1px solid #e8edf3;padding:4px 7px;}
    tr:nth-child(even) td{background:#f8fafc;} .empty{color:#9aa;text-align:center;}
    ul{font-size:12px;} @media print{body{margin:10mm;}}
  </style></head><body>
    <h1>${esc(report.title)}</h1>
    <div class="meta">${esc(report.subtitle || "")} ${report.dateRange?.label ? "• Period: " + esc(report.dateRange.label) : ""} • Generated ${esc((report.generatedAt || new Date()).toLocaleString())}</div>
    <div class="kpis">${kpis}</div>
    ${report.narrative ? `<div class="narrative">${esc(report.narrative)}</div>` : ""}
    ${sections}
    ${actions}
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function exportReport(report, format) {
  switch (format) {
    case "csv": return downloadReportCSV(report);
    case "excel": return downloadReportExcel(report);
    case "pdf": return downloadReportPDF(report);
    case "print": return printReport(report);
    default: throw new Error(`Unknown report format: ${format}`);
  }
}
