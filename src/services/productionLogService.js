/**
 * Production Log service.
 *
 * Handles the client side of the hourly-production pipeline:
 *  - parse Excel/CSV to rows (xlsx, already a project dependency)
 *  - read photos to base64 for vision
 *  - call the `extract-production-log` Edge Function (Claude vision + structured output)
 *  - save normalized rows to the production_hourly_log table
 *
 * The Edge Function holds the Anthropic key; the browser never sees it.
 */
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabaseClient';

const SHEET_RE = /\.(xlsx|xls|csv)$/i;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;

export function classifyFile(file) {
  if (IMAGE_RE.test(file.name) || (file.type || '').startsWith('image/')) return 'image';
  if (SHEET_RE.test(file.name)) return 'sheet';
  return 'unknown';
}

/** Parse the first worksheet of an Excel/CSV file into { sheetName, columns, rows }. */
export function parseSheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const sheetName = wb.SheetNames[0];
        // header:1 keeps the raw matrix (the format is a matrix, not a flat table),
        // which is what the AI extractor needs to unpivot correctly.
        const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false });
        const objects = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
        const columns = objects.length ? Object.keys(objects[0]) : [];
        resolve({ sheetName, columns, rows: objects, matrix, allSheets: wb.SheetNames });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

/** Read an image file into base64 (no data: prefix) + a data URL for preview. */
export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = String(dataUrl).split(',')[1] || '';
      resolve({ dataBase64: base64, mediaType: file.type || 'image/jpeg', dataUrl });
    };
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Prepare a File into the shape the Edge Function expects.
 * Returns null for unsupported files.
 */
export async function prepareFile(file) {
  const kind = classifyFile(file);
  if (kind === 'image') {
    const { dataBase64, mediaType, dataUrl } = await readImageFile(file);
    return { kind: 'image', name: file.name, mediaType, dataBase64, dataUrl };
  }
  if (kind === 'sheet') {
    const parsed = await parseSheetFile(file);
    // For the matrix format, send the raw matrix so the model can unpivot.
    return { kind: 'sheet', name: file.name, rows: parsed.matrix, preview: parsed, columns: parsed.columns };
  }
  return null;
}

/** Call the Edge Function to extract normalized rows from prepared files. */
export async function extractFromFiles(prepared, department) {
  const files = prepared.map((f) =>
    f.kind === 'image'
      ? { kind: 'image', name: f.name, mediaType: f.mediaType, dataBase64: f.dataBase64 }
      : { kind: 'sheet', name: f.name, rows: f.rows });
  const { data, error } = await supabase.functions.invoke('extract-production-log', {
    body: { mode: 'extract', department, files },
  });
  if (error) throw new Error(friendlyFnError(error));
  if (data?.error) throw new Error(data.error);
  return data?.result || { entries: [], departments: [], warnings: [] };
}

/** Call the Edge Function to analyze normalized rows. */
export async function analyzeRows(rows) {
  const { data, error } = await supabase.functions.invoke('extract-production-log', {
    body: { mode: 'analyze', rows },
  });
  if (error) throw new Error(friendlyFnError(error));
  if (data?.error) throw new Error(data.error);
  return data?.result || null;
}

/** Persist an extraction: create an upload record, then insert the normalized rows. */
export async function saveExtraction({ entries, sourceName, sourceKind, department, logDate, raw }) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id || null;

  const { data: upload, error: upErr } = await supabase
    .from('production_log_uploads')
    .insert({
      source_name: sourceName,
      source_kind: sourceKind,
      department: department || entries[0]?.department || null,
      log_date: logDate || entries[0]?.log_date || null,
      row_count: entries.length,
      raw: raw || null,
      created_by: userId,
    })
    .select()
    .single();
  if (upErr) throw new Error(upErr.message);

  const rows = entries.map((e) => ({
    upload_batch_id: upload.id,
    log_date: e.log_date || null,
    department: e.department || department || 'assembly',
    line_no: e.line_no,
    line_leader: e.line_leader || null,
    model: e.model || null,
    manpower: Number.isFinite(+e.manpower) ? +e.manpower : null,
    time_slot: e.time_slot,
    slot_index: Number.isFinite(+e.slot_index) ? +e.slot_index : null,
    target: +e.target || 0,
    achieved: +e.achieved || 0,
    downtime_minutes: +e.downtime_minutes || 0,
    reason: e.reason || null,
    source_name: sourceName,
    created_by: userId,
  }));

  const { error: insErr } = await supabase.from('production_hourly_log').insert(rows);
  if (insErr) throw new Error(insErr.message);
  return { uploadId: upload.id, inserted: rows.length };
}

function friendlyFnError(error) {
  const msg = error?.message || String(error);
  if (/not found|404|Failed to fetch|Failed to send/i.test(msg)) {
    return 'AI service not reachable. Deploy the Edge Function (supabase functions deploy extract-production-log) and set ANTHROPIC_API_KEY.';
  }
  return msg;
}

const productionLogService = {
  classifyFile,
  parseSheetFile,
  readImageFile,
  prepareFile,
  extractFromFiles,
  analyzeRows,
  saveExtraction,
};
export default productionLogService;
