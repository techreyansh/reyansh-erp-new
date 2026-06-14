// Linking a Gmail sender account for the Email Campaigns module.
//
// Reuses the app's Supabase Google OAuth, but requests the extra `gmail.send`
// scope with offline access so the scheduler can send in the background. After
// the redirect back, Supabase exposes `provider_token` / `provider_refresh_token`
// on the freshly-exchanged session — we capture them once and persist them in
// public.email_accounts (RLS-locked to the owner).
import { supabase } from '../lib/supabaseClient';
import { getOAuthRedirectUrl } from '../lib/oauthCallbackParams';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  // readonly is requested ahead of v1.1 reply-detection; harmless if unused.
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const PENDING_KEY = 'reyansh_gmail_connect_pending';

const emailAccountsService = {
  async listAccounts() {
    const { data, error } = await supabase.from('email_accounts')
      .select('id, email, display_name, status, scopes, sent_today, sent_today_date, connected_at, last_error')
      .order('connected_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Kick off the OAuth redirect with the Gmail send scope.
  connectGmail() {
    try { window.localStorage.setItem(PENDING_KEY, '1'); } catch { /* ignore */ }
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getOAuthRedirectUrl(),
        scopes: GMAIL_SCOPES.join(' '),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  },

  isConnectPending() {
    try { return window.localStorage.getItem(PENDING_KEY) === '1'; } catch { return false; }
  },

  clearPending() {
    try { window.localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  },

  // Call right after returning from the OAuth redirect. Reads provider tokens
  // from the current session and stores/updates the email_accounts row.
  // Returns { ok, account } or { ok:false, reason }.
  async captureFromSessionIfPending() {
    if (!this.isConnectPending()) return { ok: false, reason: 'not_pending' };

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    const providerToken = session?.provider_token || null;
    const refreshToken = session?.provider_refresh_token || null;
    const email = session?.user?.email || session?.user?.user_metadata?.email || null;

    if (!email) return { ok: false, reason: 'no_email' };

    // Without a refresh token the scheduler can't send in the background.
    if (!refreshToken) {
      this.clearPending();
      return {
        ok: false,
        reason: 'no_refresh_token',
        detail:
          'Google did not return a refresh token. Ensure the Supabase Google provider has offline access, ' +
          'and that you approved the consent screen (prompt=consent). You may need to remove the app from ' +
          'https://myaccount.google.com/permissions and reconnect.',
      };
    }

    const userId = session?.user?.id;
    const { data, error } = await supabase.from('email_accounts').upsert({
      user_id: userId,
      email,
      display_name: session?.user?.user_metadata?.full_name || email,
      provider: 'gmail',
      refresh_token: refreshToken,
      access_token: providerToken,
      token_expires_at: providerToken ? new Date(Date.now() + 3500 * 1000).toISOString() : null,
      scopes: GMAIL_SCOPES,
      status: 'connected',
      last_error: null,
    }, { onConflict: 'user_id,email' }).select('*').single();

    this.clearPending();
    if (error) return { ok: false, reason: 'db_error', detail: error.message };
    return { ok: true, account: data };
  },

  async disconnect(id) {
    const { error } = await supabase.from('email_accounts').update({ status: 'revoked', refresh_token: null }).eq('id', id);
    if (error) throw error;
  },

  async sendTest({ accountId, to, subject, body }) {
    const { data, error } = await supabase.functions.invoke('email-send', {
      body: { test: { account_id: accountId, to, subject, body } },
    });
    if (error) throw new Error(error.message || 'email-send not reachable — deploy it first.');
    if (data?.error) throw new Error(data.error);
    return data;
  },
};

export default emailAccountsService;
