import { supabase } from '../lib/supabaseClient';

/**
 * Data layer for the WhatsApp Marketing audience (wa_contacts / wa_import_batches).
 * Talks to Supabase directly (RLS-gated by the 'marketing' module) and wraps
 * the wa_upsert_contact SECURITY DEFINER RPC for dedupe-safe writes. Mirrors
 * the style of campaignsService.js (email module's twin) and crmPipelineService.js.
 */

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

/**
 * Normalize a raw phone number string into a consistent E.164-ish shape so
 * dedupe (wa_contacts_number_uidx on lower(whatsapp_number)) actually matches
 * the same person entered two different ways ("98765 43210" vs "+919876543210").
 * Pure — unit-tested. Bare 10-digit numbers are assumed Indian mobiles (this
 * company's audience is India-based); anything else that already carries a
 * country code (leading '+', or 11/12 digits) is passed through untouched
 * apart from stripping punctuation.
 */
export function normalizePhoneNumber(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Parse newline-delimited paste text into row objects shaped like the
 * upsertContact/bulkImport record. Each line is one contact; cells are
 * tab-delimited if a tab is present, otherwise comma-delimited. A single-cell
 * line is treated as a bare phone number. Pure — unit-tested.
 * Expected column order (2+ cells): name, whatsappNumber, company, email, tags
 * (tags is '|'-separated, e.g. "vip|geyser").
 */
export function parsePasteRows(text) {
  if (!text) return [];
  return String(text)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = (line.includes('\t') ? line.split('\t') : line.split(','))
        .map((c) => c.trim());
      if (cells.length === 1) {
        return { contactName: cells[0], whatsappNumber: cells[0] };
      }
      const [contactName, whatsappNumber, company, email, tagsCell] = cells;
      return {
        contactName: contactName || whatsappNumber,
        whatsappNumber: whatsappNumber || contactName,
        company: company || null,
        email: email || null,
        tags: tagsCell ? tagsCell.split('|').map((t) => t.trim()).filter(Boolean) : [],
      };
    });
}

/** Audience list (RLS-scoped). */
export async function listContacts({ search = '', tags = null, ownerEmail = null, limit = 500 } = {}) {
  let q = supabase.from('wa_contacts').select('*').order('created_at', { ascending: false }).limit(limit);
  if (ownerEmail) q = q.eq('owner_email', ownerEmail);
  if (tags && tags.length) q = q.contains('tags', tags);
  if (search) {
    q = q.or(
      `contact_name.ilike.%${search}%,company.ilike.%${search}%,whatsapp_number.ilike.%${search}%,email.ilike.%${search}%`,
    );
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Upsert one contact (dedupes on lower(whatsapp_number)) via the SECURITY
 * DEFINER RPC. `record` uses the JS-friendly camelCase shape; mapped here to
 * the RPC's p_* param names (see wa_upsert_contact in
 * 20260701140000_whatsapp_marketing_schema.sql).
 */
export async function upsertContact(record) {
  const whatsappNumber = normalizePhoneNumber(record.whatsappNumber);
  if (!whatsappNumber) throw new Error('WhatsApp number is required.');
  if (!record.contactName || !String(record.contactName).trim()) {
    throw new Error('Contact name is required.');
  }
  const { data, error } = await supabase.rpc('wa_upsert_contact', {
    p_company: record.company ?? null,
    p_contact_name: record.contactName,
    p_whatsapp_number: whatsappNumber,
    p_email: record.email ?? null,
    p_owner_email: record.ownerEmail ?? null,
    p_tags: record.tags ?? [],
    p_source: record.source ?? 'manual',
    p_attributes: record.attributes ?? {},
    p_import_batch_id: record.importBatchId ?? null,
  });
  if (error) throw error;
  return data; // contact id
}

/**
 * Bulk import rows already mapped to the upsertContact record shape. Creates a
 * wa_import_batches row for provenance, upserts each row, and tallies
 * imported_rows/skipped_rows back onto the batch. Returns { batchId, created,
 * updated, errors } — the { created, updated, errors:[{label,message}] } part
 * matches the shape the generic BulkImportDialog / dataset.apply() convention
 * expects (see src/services/bulkImport/runner.js + registry.js's applyCrm /
 * applyInventory for the reference shape).
 */
export async function bulkImport(rows, { name = null, filename = null, source = 'excel' } = {}) {
  const created_by = await currentUserId();
  const { data: batch, error: bErr } = await supabase
    .from('wa_import_batches')
    .insert({ name, filename, source, total_rows: (rows || []).length, created_by })
    .select('id')
    .single();
  if (bErr) throw bErr;

  // Pre-fetch existing numbers once so we can tell created vs. updated (the
  // RPC itself only returns the contact id either way).
  const { data: existingContacts, error: exErr } = await supabase
    .from('wa_contacts')
    .select('whatsapp_number');
  if (exErr) throw exErr;
  const existingSet = new Set((existingContacts || []).map((c) => normalizePhoneNumber(c.whatsapp_number)));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const row of rows || []) {
    const normalized = normalizePhoneNumber(row.whatsappNumber);
    const label = row.contactName || row.company || normalized || 'row';
    if (!normalized) {
      skipped += 1;
      errors.push({ label, message: 'Missing/invalid WhatsApp number' });
      continue;
    }
    try {
      await upsertContact({ ...row, whatsappNumber: normalized, source: row.source || source, importBatchId: batch.id });
      if (existingSet.has(normalized)) updated += 1;
      else { created += 1; existingSet.add(normalized); }
    } catch (e) {
      skipped += 1;
      errors.push({ label, message: e?.message || String(e) });
    }
  }

  await supabase
    .from('wa_import_batches')
    .update({ imported_rows: created + updated, skipped_rows: skipped })
    .eq('id', batch.id);

  return { batchId: batch.id, created, updated, errors };
}

/** Parse pasted text (one contact per line) and import it the same way as a file. */
export async function pasteImport(text) {
  const rows = parsePasteRows(text);
  return bulkImport(rows, { name: 'Pasted contacts', filename: null, source: 'paste' });
}

const waContactsService = {
  normalizePhoneNumber,
  parsePasteRows,
  listContacts,
  upsertContact,
  bulkImport,
  pasteImport,
};

export default waContactsService;
