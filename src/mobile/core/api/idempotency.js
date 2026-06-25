// Idempotency-key generation. Runtime-only (uses crypto/uuid), so it is NOT in the
// pure-test path — outboxPolicy's dedupe tests inject keys explicitly.

/** Generate a fresh idempotency key (UUID v4 when available, else a random fallback). */
export function newKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}

export default { newKey };
