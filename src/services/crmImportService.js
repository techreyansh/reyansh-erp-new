/**
 * CRM Import service.
 *
 * Reads the "Reyansh CRM Tracker" Google-Sheet export (.xlsx), extracts the
 * Lead Master + Customer Master, dedupes by company name against existing ERP
 * records, and imports through the existing client/prospect services so
 * ClientCode generation and field mapping stay consistent.
 *
 * Lead Master  -> prospects_clients (prospects we're working on)
 * Customer Master -> clients2 (paying customers)
 *
 * Activities / pipeline / payments are later phases (see CRM_INTEGRATION_ANALYSIS.md).
 */
import * as XLSX from 'xlsx';
import * as prospectsClientService from './prospectsClientService';
import * as clientService from './clientService';

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const money = (v) => {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
// Rows where the auto-fill placeholder leaked in, or no real company.
const isPlaceholder = (name) => !name || /^add to lead master$/i.test(name.trim());

/** Find the header row in a sheet matrix (row containing the key column). */
function extractRows(ws, keyLabel) {
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const headerIdx = matrix.findIndex((r) =>
    r.some((c) => norm(c) === norm(keyLabel)),
  );
  if (headerIdx === -1) return { headers: [], rows: [] };
  const headers = matrix[headerIdx].map((c) => String(c).trim());
  const rows = matrix
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => String(c).trim()))
    .map((r) => {
      const o = {};
      headers.forEach((h, i) => { if (h) o[h] = r[i]; });
      return o;
    });
  return { headers, rows };
}

const get = (row, ...keys) => {
  for (const k of keys) {
    const hit = Object.keys(row).find((h) => norm(h) === norm(k) || norm(h).startsWith(norm(k)));
    if (hit && String(row[hit]).trim()) return String(row[hit]).trim();
  }
  return '';
};

/** Parse the workbook into normalized lead + customer objects (ERP camelCase shape). */
export function parseCrmWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const leadWs = wb.Sheets['01_Lead_Master'];
        const custWs = wb.Sheets['02_Customer_Master'];

        const leads = [];
        if (leadWs) {
          const { rows } = extractRows(leadWs, 'Company Name');
          rows.forEach((r) => {
            const name = get(r, 'Company Name');
            if (isPlaceholder(name)) return;
            const contact = get(r, 'Contact Person');
            const phone = get(r, 'Phone');
            const email = get(r, 'Email');
            const designation = get(r, 'Designation');
            const source = get(r, 'Source');
            const status = get(r, 'Status');
            const assigned = get(r, 'Assigned To');
            const leadDate = get(r, 'Lead Date');
            const req = get(r, 'Notes / Requirement', 'Notes', 'Requirement');
            const noteBits = [
              req,
              status && `Lead status: ${status}`,
              source && `Source: ${source}`,
              assigned && `Assigned: ${assigned}`,
              leadDate && `Lead date: ${leadDate}`,
            ].filter(Boolean);
            leads.push({
              clientName: name,
              city: get(r, 'City'),
              businessType: get(r, 'Industry'),
              contacts: (contact || phone || email)
                ? [{ name: contact, designation, number: phone, email, isPrimary: true }]
                : [],
              notes: noteBits.join(' · '),
              status: 'Active',
              lastContactDate: get(r, 'Last Contact (auto)', 'Last Contact'),
              _legacyId: get(r, 'Lead ID'),
              _leadStatus: status,
              _source: source,
            });
          });
        }

        const customers = [];
        if (custWs) {
          const { rows } = extractRows(custWs, 'Customer Name');
          rows.forEach((r) => {
            const name = get(r, 'Customer Name');
            if (isPlaceholder(name)) return;
            const products = get(r, 'Products Bought');
            const segment = get(r, 'Segment');
            const risk = get(r, 'Risk Level');
            const keyContact = get(r, 'Key Contact (auto)', 'Key Contact');
            const notes = get(r, 'Notes');
            const noteBits = [
              notes,
              segment && `Segment: ${segment}`,
              risk && `Risk: ${risk}`,
            ].filter(Boolean);
            customers.push({
              clientName: name,
              paymentTerms: get(r, 'Payment Terms'),
              products: products ? products.split(/[,/]/).map((p) => ({ name: p.trim() })).filter((p) => p.name) : [],
              totalValue: money(get(r, 'Monthly Value (INR)', 'Monthly Value')),
              contacts: keyContact && !isPlaceholder(keyContact) ? [{ name: keyContact, isPrimary: true }] : [],
              notes: noteBits.join(' · '),
              status: 'Active',
              lastContactDate: get(r, 'Last Order Date (auto)', 'Last Order Date'),
              _legacyId: get(r, 'Customer ID'),
              _segment: segment,
            });
          });
        }

        resolve({ leads, customers, sheets: wb.SheetNames });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

/** Tag each parsed row as already-present-in-ERP or new (dedupe by company name). */
export async function analyzeAgainstErp(parsed) {
  const [prospects, clients] = await Promise.all([
    prospectsClientService.getAllClients(true).catch(() => []),
    clientService.getAllClients(true).catch(() => []),
  ]);
  const existing = new Set([...prospects, ...clients].map((c) => norm(c.clientName)));
  const tag = (arr) => arr.map((x) => ({ ...x, exists: existing.has(norm(x.clientName)) }));
  return {
    leads: tag(parsed.leads),
    customers: tag(parsed.customers),
    existingCount: existing.size,
  };
}

function codeGenerator(prefix, pad, existingCodes) {
  let max = 0;
  existingCodes.forEach((c) => {
    const m = String(c || '').match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  });
  let n = max;
  return () => { n += 1; return `${prefix}${String(n).padStart(pad, '0')}`; };
}

/** Import the given (new) leads into prospects_clients. onProgress(done,total). */
export async function importProspects(leads, onProgress) {
  const existing = await prospectsClientService.getAllClients(true).catch(() => []);
  const nextCode = codeGenerator('PC', 4, existing.map((c) => c.clientCode));
  let ok = 0; const errors = [];
  for (let i = 0; i < leads.length; i += 1) {
    try {
      await prospectsClientService.addClient({ ...leads[i], clientCode: nextCode() });
      ok += 1;
    } catch (e) {
      errors.push(`${leads[i].clientName}: ${e.message}`);
    }
    onProgress && onProgress(i + 1, leads.length);
  }
  return { ok, failed: errors.length, errors };
}

/** Import the given (new) customers into clients2. onProgress(done,total). */
export async function importCustomers(customers, onProgress) {
  const existing = await clientService.getAllClients(true).catch(() => []);
  const nextCode = codeGenerator('C', 5, existing.map((c) => c.clientCode));
  let ok = 0; const errors = [];
  for (let i = 0; i < customers.length; i += 1) {
    try {
      await clientService.addClient({ ...customers[i], clientCode: nextCode() });
      ok += 1;
    } catch (e) {
      errors.push(`${customers[i].clientName}: ${e.message}`);
    }
    onProgress && onProgress(i + 1, customers.length);
  }
  return { ok, failed: errors.length, errors };
}

const crmImportService = { parseCrmWorkbook, analyzeAgainstErp, importProspects, importCustomers };
export default crmImportService;
