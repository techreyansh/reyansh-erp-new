// Pure unit tests for the wa_contacts bulk-import dataset's row mapping/
// validation (no Supabase calls — rowToRecord/validateRow/recordToCell are
// synchronous pure functions on the registered dataset object).
import { getDataset } from "./registry";

const dataset = getDataset("wa_contacts");

describe("wa_contacts dataset registration", () => {
  test("is registered with the expected shape", () => {
    expect(dataset).toBeTruthy();
    expect(dataset.key).toBe("wa_contacts");
    expect(dataset.module).toBe("marketing");
    expect(dataset.matchKey).toBe("whatsapp_number");
    expect(typeof dataset.fetchExisting).toBe("function");
    expect(typeof dataset.rowToRecord).toBe("function");
    expect(typeof dataset.validateRow).toBe("function");
    expect(typeof dataset.apply).toBe("function");
  });

  test("columns include the required fields with required/type/example", () => {
    const byKey = Object.fromEntries(dataset.columns.map((c) => [c.key, c]));
    expect(byKey.contact_name.required).toBe(true);
    expect(byKey.whatsapp_number.required).toBe(true);
    expect(byKey.company.required).toBeFalsy();
    ["company", "contact_name", "whatsapp_number", "email", "owner_email", "tags"].forEach((k) => {
      expect(byKey[k]).toBeTruthy();
      expect(byKey[k].type).toBeTruthy();
    });
  });
});

describe("wa_contacts rowToRecord", () => {
  test("normalizes a bare 10-digit number to +91 and splits comma tags", () => {
    const rec = dataset.rowToRecord({
      company: "Acme", contact_name: "Ravi Sharma", whatsapp_number: "9876543210",
      email: "Ravi@Acme.com", owner_email: "Owner@Acme.com", tags: "vip, geyser",
    });
    expect(rec.whatsapp_number).toBe("+919876543210");
    expect(rec.contact_name).toBe("Ravi Sharma");
    expect(rec.owner_email).toBe("owner@acme.com");
    expect(rec.tags).toEqual(["vip", "geyser"]);
  });

  test("splits pipe-delimited tags too", () => {
    const rec = dataset.rowToRecord({ contact_name: "A", whatsapp_number: "9000000000", tags: "a|b|c" });
    expect(rec.tags).toEqual(["a", "b", "c"]);
  });

  test("blank tags/company/email become [] / null", () => {
    const rec = dataset.rowToRecord({ contact_name: "A", whatsapp_number: "9000000000" });
    expect(rec.tags).toEqual([]);
    expect(rec.company).toBeNull();
    expect(rec.email).toBeNull();
  });
});

describe("wa_contacts validateRow", () => {
  test("requires contact_name and whatsapp_number", () => {
    const { errors } = dataset.validateRow({ contact_name: "", whatsapp_number: "" });
    expect(errors).toEqual(expect.arrayContaining(["Contact name is required", "WhatsApp number is required"]));
  });

  test("flags a too-short number as invalid", () => {
    const { errors } = dataset.validateRow({ contact_name: "A", whatsapp_number: "12345" });
    expect(errors.some((e) => /invalid/i.test(e))).toBe(true);
  });

  test("passes for a valid normalized record and warns on malformed email", () => {
    const rec = dataset.rowToRecord({ contact_name: "Ravi", whatsapp_number: "9876543210", email: "not-an-email" });
    const { errors, warnings } = dataset.validateRow(rec);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => /email/i.test(w))).toBe(true);
  });
});

describe("wa_contacts recordToCell", () => {
  test("renders tags array back to a comma-joined string", () => {
    expect(dataset.recordToCell({ tags: ["vip", "geyser"] }, "tags")).toBe("vip, geyser");
    expect(dataset.recordToCell({ company: "Acme" }, "company")).toBe("Acme");
  });
});
