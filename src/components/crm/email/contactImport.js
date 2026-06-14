// Pure CSV/Excel → contact field mapping for the Audience importer.
// Extracted from EmailAudience so it can be unit-tested without React.

// Map common header variants → our contact fields.
export const HEADER_MAP = {
  email: ['email', 'email address', 'e-mail', 'mail'],
  first_name: ['first name', 'firstname', 'first', 'fname'],
  last_name: ['last name', 'lastname', 'last', 'lname', 'surname'],
  full_name: ['name', 'full name', 'contact', 'contact name', 'contact person'],
  company: ['company', 'organisation', 'organization', 'company name', 'business'],
  title: ['title', 'designation', 'role', 'job title'],
  phone: ['phone', 'mobile', 'contact number', 'phone number'],
};

// Map one raw spreadsheet row (object keyed by original headers) to a contact.
// Unmapped columns are preserved under `attributes` as AI personalization context.
export function mapRow(raw) {
  const out = { attributes: {} };
  const lowerKeys = Object.keys(raw).reduce((m, k) => { m[k.toLowerCase().trim()] = k; return m; }, {});
  for (const [field, variants] of Object.entries(HEADER_MAP)) {
    const hit = variants.find((v) => lowerKeys[v] != null);
    if (hit) out[field] = String(raw[lowerKeys[hit]] ?? '').trim();
  }
  const mappedSources = new Set(Object.values(HEADER_MAP).flat());
  for (const [k, origKey] of Object.entries(lowerKeys)) {
    if (!mappedSources.has(k) && raw[origKey] != null && raw[origKey] !== '') out.attributes[k] = raw[origKey];
  }
  return out;
}
