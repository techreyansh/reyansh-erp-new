// Pure helpers for the Campaign Wizard (Task 8). Kept side-effect-free and
// framework-free so they're cheap to unit test (see wizardHelpers.test.js) —
// the step components import these instead of re-deriving the logic inline.

/** Suggestion chips offered on StepBasics' free-text Category field. */
export const CAMPAIGN_CATEGORY_SUGGESTIONS = [
  'Lead Nurturing',
  'Customer Follow-up',
  'Festival Campaign',
  'Product Launch',
  'OEM Outreach',
  'Payment Reminder',
  'KIT Campaign',
];

/** Variable chips offered on StepMessages' body_text editor. Clicking a chip inserts the token at the cursor. */
export const CAMPAIGN_VARIABLES = [
  'CustomerName',
  'CompanyName',
  'ContactPerson',
  'SalesPerson',
  'Product',
  'City',
  'LastOrder',
];

/**
 * Validate the business-hours window (StepSchedule).
 *
 * CARRY-FORWARD from Task 5's review: business_hours_end must be strictly
 * greater than business_hours_start. A start==end (or end<start) window is a
 * permanently-closed window — wa-scheduler would push next_send_at forward
 * forever without ever finding an open hour to send in. Returns an error
 * string to show inline, or null when the window is valid.
 */
export function validateBusinessHours(start, end) {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 'Business hours start/end are required.';
  if (s < 0 || s > 23 || e < 0 || e > 23) return 'Business hours must be between 0 and 23.';
  if (e <= s) {
    return 'End hour must be later than the start hour — an end that equals or precedes the start creates a window that never opens, so scheduled messages would never send.';
  }
  return null;
}

/** Map a step's { delay_type, delay_days } to the UI's radio "kind" ('immediate' | 'after_days'). */
export function delayKind(step) {
  return step && step.delay_type === 'after_days' ? 'after_days' : 'immediate';
}

/**
 * Serialize the UI's radio-kind + free numeric-days input back into
 * { delay_type, delay_days } for persistence. Arbitrary day counts allowed
 * (no fixed presets) — only floored to a positive integer.
 */
export function serializeDelay(kind, days) {
  if (kind !== 'after_days') return { delay_type: 'immediate', delay_days: 0 };
  const n = Math.trunc(Number(days));
  return { delay_type: 'after_days', delay_days: Number.isFinite(n) && n > 0 ? n : 1 };
}

/** Human-readable delay summary for StepReview. */
export function delayLabel(step) {
  if (!step || step.delay_type !== 'after_days') return 'Immediately';
  const n = Number(step.delay_days) || 0;
  return `After ${n} day${n === 1 ? '' : 's'}`;
}

/**
 * Insert `insertion` into `text` at the given selection range, returning the
 * new text and the cursor position it should land at (right after the
 * inserted text) — used by the variable-chip row and the textarea ref.
 */
export function insertAtCursor(text, selectionStart, selectionEnd, insertion) {
  const src = text || '';
  const start = Number.isFinite(selectionStart) ? selectionStart : src.length;
  const end = Number.isFinite(selectionEnd) ? selectionEnd : start;
  const before = src.slice(0, start);
  const after = src.slice(end);
  const nextText = `${before}${insertion}${after}`;
  return { text: nextText, cursor: before.length + insertion.length };
}

/**
 * Diff an existing campaign-media list against a step-picker's current
 * checkbox selection, so MediaLibraryPicker only issues the minimum number of
 * attach/detach writes on "Attach" instead of re-writing every row.
 * `mediaItems` are wa_campaign_media rows (each with .id and .step_id);
 * `selectedIds` is the set of ids currently checked for `stepId`.
 */
export function computeMediaAttachDiff(mediaItems, selectedIds, stepId) {
  const selected = new Set(selectedIds || []);
  const toAttach = [];
  const toDetach = [];
  (mediaItems || []).forEach((item) => {
    const isForStep = item.step_id === stepId;
    const isSelected = selected.has(item.id);
    if (isSelected && !isForStep) toAttach.push(item.id);
    else if (!isSelected && isForStep) toDetach.push(item.id);
  });
  return { toAttach, toDetach };
}

/** Move an array element from one index to another (used by StepMessages' up/down reorder buttons). Pure, immutable. */
export function moveItem(arr, fromIndex, toIndex) {
  const list = Array.isArray(arr) ? arr.slice() : [];
  if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return list;
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);
  return list;
}
