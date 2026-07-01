import { supabase } from '../lib/supabaseClient';

/**
 * Storage layer for WhatsApp campaign media (wa_campaign_media), backed by the
 * shared 'documents' Supabase Storage bucket. Upload path/pattern mirrors
 * npdService.js's uploadDocument.
 */

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

/** Infer the wa_campaign_media.category enum value from a file's MIME type. Pure — unit-tested. */
export function inferMediaCategory(mimeType) {
  const t = String(mimeType || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf' || t.includes('document') || t.includes('word') || t.includes('sheet') || t.includes('excel')) {
    return 'document';
  }
  return 'other';
}

/** Upload a media file for a campaign (optionally scoped to one step) and index it. */
export async function uploadMedia(campaignId, stepId, file) {
  const path = `wa_campaigns/${campaignId}/${Date.now()}_${file.name}`;
  const up = await supabase.storage.from('documents').upload(path, file);
  if (up.error) throw up.error;

  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from('wa_campaign_media')
    .insert({
      campaign_id: campaignId,
      step_id: stepId ?? null,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      category: inferMediaCategory(file.type),
      created_by,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listMedia(campaignId) {
  const { data, error } = await supabase
    .from('wa_campaign_media')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Resolve a fetchable URL for a stored media file.
 *
 * CAVEAT (could not be confirmed live from this environment — no DB access):
 * the brief asked to check `select public from storage.buckets where
 * id='documents'` and use getPublicUrl if public, createSignedUrl otherwise.
 * Every *other* consumer of the 'documents' bucket already in this codebase
 * (npdService.documentUrl, crmPipelineService.getDocumentUrl) uses
 * createSignedUrl, with exactly one outlier (poService.js using
 * getPublicUrl) — so the bucket's flag is ambiguous from static inspection.
 * createSignedUrl is the safe default: it works whether the bucket is public
 * or private, whereas getPublicUrl silently returns a dead link if the bucket
 * turns out to be private. CONFIRM LIVE before Task 4 wires the wa-send
 * adapter to fetch media by URL for Meta's API — if 'documents' is actually
 * public, switching this to getPublicUrl is a one-line change.
 */
export async function mediaUrl(storagePath, { expiresIn = 3600 } = {}) {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  return data?.signedUrl;
}

/**
 * Reassign (or clear, when stepId is null) which step a previously-uploaded
 * media row is attached to. Added for Task 8 (Campaign Wizard's
 * MediaLibraryPicker) — Task 3 only wrote step_id at upload time via
 * uploadMedia, with no way to re-attach existing campaign media to a
 * different step afterwards, which the wizard's "multi-select for attaching
 * to the currently-edited step" requirement needs.
 */
export async function attachMediaToStep(mediaId, stepId) {
  const { data, error } = await supabase
    .from('wa_campaign_media')
    .update({ step_id: stepId ?? null })
    .eq('id', mediaId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

const waMediaService = {
  inferMediaCategory,
  uploadMedia,
  listMedia,
  mediaUrl,
  attachMediaToStep,
};

export default waMediaService;
