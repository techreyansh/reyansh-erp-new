// Pure helpers for employee CSV import — parsing, header mapping, validation.
// No DOM / no network, so it's unit-testable. The dialog handles file reading
// (incl. .xlsx → text via SheetJS) and the actual inserts.

// Normalised header token -> employee field.
const HEADER_MAP = {
  name: "full_name", fullname: "full_name", employeename: "full_name", empname: "full_name",
  email: "email", emailid: "email", emailaddress: "email", mail: "email",
  department: "department", dept: "department",
  designation: "designation", title: "designation", jobtitle: "designation", role: "designation",
  mobile: "phone", phone: "phone", contact: "phone", mobileno: "phone", contactnumber: "phone", phoneno: "phone",
  employeecode: "employee_code", empcode: "employee_code", employeeid: "employee_code", code: "employee_code", empid: "employee_code",
  reportingmanager: "reporting_manager", manager: "reporting_manager", reportsto: "reporting_manager",
  joindate: "joining_date", joiningdate: "joining_date", doj: "joining_date", dateofjoining: "joining_date",
  status: "status",
};

export const IMPORT_FIELDS = [
  "employee_code", "full_name", "email", "phone", "department",
  "designation", "reporting_manager", "joining_date", "status",
];

export function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// RFC-ish CSV parse: handles quoted fields, embedded commas/quotes/newlines.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = String(text || "").replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/**
 * Parse employee CSV text into validated records.
 * @returns { headers, mapped (header->field), records: [{...fields, _row, _valid, _issues[]}], summary }
 * `existingEmails` (lowercased set) flags duplicates against the current roster.
 */
export function parseEmployeesCsv(text, existingEmails = new Set()) {
  const grid = parseCsv(text);
  if (!grid.length) return { headers: [], mapped: {}, records: [], summary: { total: 0, valid: 0, duplicate: 0, invalid: 0 } };

  const headers = grid[0].map((h) => String(h).trim());
  const mapped = {};
  headers.forEach((h, i) => {
    const field = HEADER_MAP[normalizeHeader(h)];
    if (field) mapped[i] = field;
  });

  const seenInFile = new Set();
  const records = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const rec = { _row: r + 1, _issues: [] };
    headers.forEach((_, i) => {
      const field = mapped[i];
      if (field && rec[field] == null) rec[field] = String(cells[i] ?? "").trim();
    });

    const email = (rec.email || "").toLowerCase();
    if (!rec.full_name) rec._issues.push("missing name");
    if (!email) rec._issues.push("missing email");
    else if (!EMAIL_RE.test(email)) rec._issues.push("invalid email");
    else if (existingEmails.has(email)) rec._issues.push("already exists");
    else if (seenInFile.has(email)) rec._issues.push("duplicate in file");
    if (email) seenInFile.add(email);

    rec.email = email;
    rec._valid = rec._issues.length === 0;
    records.push(rec);
  }

  const summary = {
    total: records.length,
    valid: records.filter((x) => x._valid).length,
    duplicate: records.filter((x) => x._issues.some((i) => /exists|duplicate/.test(i))).length,
    invalid: records.filter((x) => x._issues.some((i) => /missing|invalid/.test(i))).length,
  };
  return { headers, mapped, records, summary };
}
