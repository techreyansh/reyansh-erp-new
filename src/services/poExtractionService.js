/**
 * Purchase-Order extraction service (client side).
 * Prepares a PO file (PDF / image / Excel-CSV) and calls the
 * `extract-purchase-order` Edge Function, which runs Gemini server-side.
 */
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabaseClient';

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;
const SHEET_RE = /\.(xlsx|xls|csv)$/i;
const PDF_RE = /\.pdf$/i;

export function classifyFile(file) {
  if (PDF_RE.test(file.name) || file.type === 'application/pdf') return 'pdf';
  if (IMAGE_RE.test(file.name) || (file.type || '').startsWith('image/')) return 'image';
  if (SHEET_RE.test(file.name)) return 'sheet';
  return 'unknown';
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      resolve({ dataBase64: String(dataUrl).split(',')[1] || '', mediaType: file.type, dataUrl });
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function parseSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }));
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

/** Prepare a File for the Edge Function. Returns null for unsupported types. */
export async function preparePoFile(file) {
  const kind = classifyFile(file);
  if (kind === 'pdf') {
    const { dataBase64 } = await readBase64(file);
    return { kind: 'pdf', name: file.name, dataBase64 };
  }
  if (kind === 'image') {
    const { dataBase64, mediaType, dataUrl } = await readBase64(file);
    return { kind: 'image', name: file.name, mediaType, dataBase64, dataUrl };
  }
  if (kind === 'sheet') {
    const rows = await parseSheet(file);
    return { kind: 'sheet', name: file.name, rows };
  }
  return null;
}

/** Extract a purchase order from prepared files via the Edge Function. */
export async function extractPurchaseOrder(prepared) {
  const files = prepared.map((f) =>
    f.kind === 'sheet'
      ? { kind: 'sheet', name: f.name, rows: f.rows }
      : { kind: f.kind, name: f.name, mediaType: f.mediaType, dataBase64: f.dataBase64 });
  const { data, error } = await supabase.functions.invoke('extract-purchase-order', { body: { files } });
  if (error) {
    const msg = error?.message || String(error);
    if (/not found|404|Failed to (fetch|send)/i.test(msg)) {
      throw new Error('AI service not reachable. Deploy the Edge Function (supabase functions deploy extract-purchase-order) and set GEMINI_API_KEY.');
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data?.result || null;
}

const poExtractionService = { classifyFile, preparePoFile, extractPurchaseOrder };
export default poExtractionService;
