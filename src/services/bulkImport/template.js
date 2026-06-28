// Excel template generator for the bulk-import framework. Builds a two-sheet
// workbook: a "Template" sheet (header row + either example rows or the current
// data for a round-trip edit) and an "Instructions" sheet documenting each
// column (required? type, allowed values, notes) — SheetJS Community can't embed
// real dropdowns, so allowed values live here. Reuses the reportEngine xlsx idiom.
import * as XLSX from "xlsx";

const cellVal = (v) => (v == null ? "" : v);

function matchLabel(dataset) {
  const col = dataset.columns.find((c) => c.key === dataset.matchKey);
  return col ? col.label : dataset.matchKey;
}

export function buildTemplateWorkbook(dataset, { withData = false, currentRows = [] } = {}) {
  const wb = XLSX.utils.book_new();
  const cols = dataset.columns;
  const header = cols.map((c) => c.label);
  const aoa = [header];

  if (withData && currentRows.length) {
    currentRows.forEach((rec) =>
      aoa.push(
        cols.map((c) => {
          const v = dataset.recordToCell ? dataset.recordToCell(rec, c.key) : rec[c.key];
          return cellVal(v);
        })
      )
    );
  } else {
    // One example row to show the expected shape.
    aoa.push(cols.map((c) => cellVal(c.example)));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({
    wch: Math.min(42, Math.max(12, String(c.label).length + 2, String(cellVal(c.example)).length + 2)),
  }));
  XLSX.utils.book_append_sheet(wb, ws, "Template");

  // Instructions sheet.
  const instr = [
    [`${dataset.label} — bulk import template`],
    ['Fill the "Template" sheet — one row per record. Keep the header row as-is.'],
    [`Matching: rows are matched to existing records by "${matchLabel(dataset)}". A match UPDATES the record; otherwise a NEW record is created.`],
    ["Required columns must not be blank. Dates as YYYY-MM-DD. Leave a cell blank to keep the existing value (on update)."],
    [],
    ["Column", "Required", "Type", "Allowed values / format", "Notes"],
    ...cols.map((c) => [
      c.label,
      c.required ? "Yes" : "No",
      c.type || "text",
      c.enum ? c.enum.join("  |  ") : c.type === "date" ? "YYYY-MM-DD" : c.type === "number" ? "number" : "",
      c.help || "",
    ]),
  ];
  const iws = XLSX.utils.aoa_to_sheet(instr);
  iws["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 9 }, { wch: 42 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, iws, "Instructions");
  return wb;
}

export function downloadTemplate(dataset, opts = {}) {
  const wb = buildTemplateWorkbook(dataset, opts);
  const base = `${dataset.key}_template${opts.withData ? "_with_data" : ""}`;
  XLSX.writeFile(wb, `${base}.xlsx`);
}
