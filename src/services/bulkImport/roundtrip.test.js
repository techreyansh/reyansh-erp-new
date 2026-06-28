// Pure round-trip test for the bulk-import framework mechanics (no Supabase):
// build a template → write it to a workbook → parse it back → confirm columns
// map correctly, including forgiving header matching.
import * as XLSX from "xlsx";
import { buildTemplateWorkbook } from "./template";
import { parseWorkbook } from "./parse";

const dataset = {
  key: "t",
  label: "Test set",
  module: "crm",
  matchKey: "code",
  columns: [
    { key: "code", label: "Item code", required: true, type: "text", example: "A1" },
    { key: "qty", label: "Quantity", type: "number", example: 5 },
    { key: "stage", label: "Stage", type: "enum", enum: ["new", "old"], example: "new" },
  ],
};

// Wrap a workbook in a minimal File-like for parseWorkbook (uses .arrayBuffer()).
function fileFromWorkbook(wb) {
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return { name: "t.xlsx", arrayBuffer: async () => buf };
}

test("template has Template + Instructions sheets and the example row round-trips", async () => {
  const wb = buildTemplateWorkbook(dataset, { withData: false });
  expect(wb.SheetNames).toEqual(expect.arrayContaining(["Template", "Instructions"]));

  const { rows } = await parseWorkbook(fileFromWorkbook(wb), dataset);
  expect(rows).toHaveLength(1); // the single example row
  expect(rows[0]).toMatchObject({ code: "A1", stage: "new" });
  expect(String(rows[0].qty)).toBe("5");
});

test("download-with-data fills current rows and parses back by column key", async () => {
  const current = [
    { code: "X9", qty: 12, stage: "old" },
    { code: "Y2", qty: 3, stage: "new" },
  ];
  const wb = buildTemplateWorkbook(dataset, { withData: true, currentRows: current });
  const { rows } = await parseWorkbook(fileFromWorkbook(wb), dataset);
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.code)).toEqual(["X9", "Y2"]);
  expect(rows[0].stage).toBe("old");
});

test("forgiving header matching: renamed/space/case headers still map to keys", async () => {
  // Hand-build a sheet with messy headers + the Instructions sheet name.
  const aoa = [
    ["ITEM CODE", "quantity", "Stage"],
    ["B7", "9", "new"],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["ignored"]]), "Instructions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Template");

  const { rows } = await parseWorkbook(fileFromWorkbook(wb), dataset);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ code: "B7", stage: "new" });
  expect(String(rows[0].qty)).toBe("9");
});

test("blank cells are dropped, not mapped to empty keys", async () => {
  const aoa = [
    ["Item code", "Quantity", "Stage"],
    ["C1", "", ""],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Template");
  const { rows } = await parseWorkbook(fileFromWorkbook(wb), dataset);
  expect(rows).toHaveLength(1);
  expect(rows[0].code).toBe("C1");
});
