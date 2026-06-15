// Supabase Google OAuth redirect configuration.
import { getAllowedAppOrigins, getRuntimeOrigin } from './env';

const oauthConfig = {
  scopes: [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ],
  // Extra scopes requested only by the Email Campaigns "Connect Gmail" flow
  // (emailAccountsService.connectGmail), not by normal login. Listed here so the
  // OAuth consent screen / troubleshooting docs know to allow them.
  gmailScopes: [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly"
  ],
  getRedirectUri: () => getRuntimeOrigin(),
  getAllowedOrigins: () => getAllowedAppOrigins(),
};

export default oauthConfig;
