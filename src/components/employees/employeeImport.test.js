import { parseCsv, parseEmployeesCsv, normalizeHeader } from "./employeeImport";

describe("CSV parsing", () => {
  test("handles quoted fields with commas and embedded quotes", () => {
    const grid = parseCsv('a,b,c\n"x,1","say ""hi""",z\n');
    expect(grid[1]).toEqual(["x,1", 'say "hi"', "z"]);
  });
  test("skips blank lines and trailing newline", () => {
    expect(parseCsv("a,b\n\n1,2\n").length).toBe(2);
  });
  test("normalizeHeader strips spaces/punctuation/case", () => {
    expect(normalizeHeader("Employee ID")).toBe("employeeid");
    expect(normalizeHeader("E-mail")).toBe("email");
  });
});

describe("parseEmployeesCsv", () => {
  const csv = [
    "Employee ID,Name,Department,Designation,Reporting Manager,Mobile,Email,Status",
    "EMP01,Ravi Sharma,Production,Plant Head,,9000000001,ravi@reyansh.com,Active",
    "EMP02,Sunita Rao,Quality,QC Manager,Ravi Sharma,9000000002,sunita@reyansh.com,Active",
    ',No Email Person,Sales,Executive,,,,Active',                       // missing email + code
    "EMP03,Dup One,Stores,Operator,,9000000003,ravi@reyansh.com,Active", // already exists (roster)
    "EMP04,Bad Email,HR,Officer,,,not-an-email,Active",                  // invalid email
  ].join("\n");

  const existing = new Set(["ravi@reyansh.com"]);
  const { headers, mapped, records, summary } = parseEmployeesCsv(csv, existing);

  test("maps headers (incl. aliases) to fields", () => {
    expect(headers).toContain("Employee ID");
    const fields = Object.values(mapped);
    expect(fields).toEqual(
      expect.arrayContaining(["employee_code", "full_name", "department", "designation", "reporting_manager", "phone", "email", "status"])
    );
  });

  test("extracts fields per row", () => {
    const ravi = records.find((r) => r.employee_code === "EMP01");
    expect(ravi.full_name).toBe("Ravi Sharma");
    expect(ravi.department).toBe("Production");
    expect(ravi.email).toBe("ravi@reyansh.com");
  });

  test("flags missing / invalid / duplicate emails", () => {
    expect(records.find((r) => r.full_name === "No Email Person")._issues).toContain("missing email");
    expect(records.find((r) => r.full_name === "Bad Email")._issues).toContain("invalid email");
    // EMP01 is valid; EMP03 reuses ravi's email → already exists
    expect(records.find((r) => r.employee_code === "EMP03")._issues).toContain("already exists");
  });

  test("summary counts", () => {
    // valid: Ravi(EMP01... wait EMP01 email ravi exists) -> actually EMP01 ravi@ is in existing set
    // valid rows = Sunita only (EMP02). EMP01 ravi exists, EMP03 dup, no-email + bad-email invalid.
    expect(summary.total).toBe(5);
    expect(summary.valid).toBe(1);          // only Sunita
    expect(summary.duplicate).toBeGreaterThanOrEqual(2); // EMP01 + EMP03 reuse ravi
    expect(summary.invalid).toBe(2);        // missing + invalid email
  });

  test("email is lowercased and a clean roster imports fully", () => {
    const clean = parseEmployeesCsv("name,email\nAsha,ASHA@X.COM\n", new Set());
    expect(clean.records[0].email).toBe("asha@x.com");
    expect(clean.summary.valid).toBe(1);
  });
});
