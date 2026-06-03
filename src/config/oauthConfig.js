// Supabase Google OAuth redirect configuration.
import { getAllowedAppOrigins, getRuntimeOrigin } from './env';

const oauthConfig = {
  scopes: [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ],
  getRedirectUri: () => getRuntimeOrigin(),
  getAllowedOrigins: () => getAllowedAppOrigins(),
};

export default oauthConfig;
