// Generic spreadsheet parser for the bulk-import framework. Reads a filled
// template (.xlsx/.xls/.csv) and maps each data row to the dataset's column
// KEYS using forgiving header matching (case/space/underscore-insensitive,
// label OR key, prefix match) — so a user can rename or reorder headers and it
// still lands in the right field. Mirrors crmImportService's `get()` approach.
import * as XLSX from "xlsx";

/** Normalize a header/value for fuzzy comparison. */
export const norm = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, "");

async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array", cellDates: true });
}

/** Prefer a "Template"/"Data" sheet; never the Instructions sheet. */
function pickSheet(wb) {
  const names = wb.SheetNames || [];
  const preferred = names.find((n) => /template|data/i.test(n) && !/instruction|readme|guide/i.test(n));
  const firstReal = names.find((n) => !/instruction|readme|guide/i.test(n));
  return wb.Sheets[preferred || firstReal || names[0]];
}

/**
 * Parse a filled template into raw row objects keyed by the dataset's column
 * keys. Returns { rows, headers, unmatchedHeaders }.
 */
export async function parseWorkbook(file, dataset) {
  const wb = await readWorkbook(file);
  const ws = pickSheet(wb);
  if (!ws) return { rows: [], headers: [], unmatchedHeaders: [] };

  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  const labels = dataset.columns.map((c) => norm(c.label));
  const keys = dataset.columns.map((c) => norm(c.key));

  // Header row = first row that contains any known column label/key.
  let headerIdx = matrix.findIndex((r) =>
    r.some((c) => labels.includes(norm(c)) || keys.includes(norm(c)))
  );
  if (headerIdx < 0) headerIdx = 0;

  const headerCells = (matrix[headerIdx] || []).map((c) => String(c).trim());
  const unmatched = [];
  const colForCell = headerCells.map((cell) => {
    const n = norm(cell);
    if (!n) return null;
    const col = dataset.columns.find(
      (c) =>
        norm(c.label) === n ||
        norm(c.key) === n ||
        n.startsWith(norm(c.key)) ||
        n.startsWith(norm(c.label))
    );
    if (!col) unmatched.push(cell);
    return col ? col.key : null;
  });

  const rows = matrix
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => {
      const o = {};
      colForCell.forEach((key, i) => {
        if (key) o[key] = typeof r[i] === "string" ? r[i].trim() : r[i];
      });
      return o;
    });

  return { rows, headers: headerCells, unmatchedHeaders: unmatched };
}
