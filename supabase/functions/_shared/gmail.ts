// Gmail send helpers: refresh an access token from a stored offline refresh
// token, build an RFC 2822 MIME message, and send via the Gmail API.
//
// Requires Edge Function secrets:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   (same OAuth client used for login)
// and a per-account refresh_token stored in public.email_accounts.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: string;
}> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on the Edge Function.");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${data.error || res.status} ${data.error_description || ""}`.trim());
  }
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3500) * 1000).toISOString();
  return { accessToken: data.access_token as string, expiresAt };
}

// URL-safe base64 without padding — what Gmail's API expects for `raw`.
function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// RFC 2047 encode a header value so non-ASCII (names, subjects) survives.
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Plain text → simple HTML (paragraphs + line breaks), with an optional 1x1
// open-tracking pixel appended.
function textToHtml(text: string, trackOpenUrl?: string | null): string {
  const body = escapeHtml(text).replace(/\r?\n/g, "<br>");
  const pixel = trackOpenUrl
    ? `<img src="${trackOpenUrl}" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px" />`
    : "";
  return `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5">` +
    `<div>${body}</div>${pixel}</body></html>`;
}

export function buildMime(opts: {
  to: string;
  fromEmail: string;
  fromName?: string | null;
  subject: string;
  body: string; // plain text
  inReplyTo?: string | null; // Message-Id of the prior email, for threading
  references?: string | null;
  trackOpenUrl?: string | null; // when set, send multipart/alternative + pixel
}): string {
  const from = opts.fromName ? `${encodeHeader(opts.fromName)} <${opts.fromEmail}>` : opts.fromEmail;
  const baseHeaders = [
    `From: ${from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (opts.inReplyTo) baseHeaders.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) baseHeaders.push(`References: ${opts.references}`);

  // Plain-text only (default — best deliverability).
  if (!opts.trackOpenUrl) {
    const headers = [
      ...baseHeaders,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
    ];
    return headers.join("\r\n") + "\r\n\r\n" + opts.body;
  }

  // multipart/alternative: text fallback + HTML with tracking pixel.
  const boundary = `b_${crypto.randomUUID().replace(/-/g, "")}`;
  const headers = [...baseHeaders, `Content-Type: multipart/alternative; boundary="${boundary}"`];
  const html = textToHtml(opts.body, opts.trackOpenUrl);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.body,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}--`,
    "",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n");
}

// List threadIds of recent INBOX (inbound) messages — i.e. replies. Our own
// sent mail lives in SENT, so anything in INBOX on a sequence thread is a reply.
export async function gmailInboundThreadIds(accessToken: string, query = "in:inbox newer_than:2d"): Promise<Set<string>> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gmail list failed (${res.status})`);
  const ids = new Set<string>();
  for (const m of (data.messages || [])) if (m.threadId) ids.add(m.threadId);
  return ids;
}

export async function sendGmail(opts: {
  accessToken: string;
  mime: string;
  threadId?: string | null;
}): Promise<{ id: string; threadId: string }> {
  const payload: Record<string, unknown> = { raw: base64Url(opts.mime) };
  if (opts.threadId) payload.threadId = opts.threadId;

  const res = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Gmail send failed (${res.status})`;
    throw new Error(msg);
  }
  return { id: data.id, threadId: data.threadId };
}
