// Supabase Google OAuth redirect configuration.
const oauthConfig = {
  scopes: [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ],
  // Get the current origin for OAuth redirect
  getRedirectUri: () => {
    const isLocal =
      window.location.hostname === 'localhost';

    const redirectUrl = isLocal
      ? window.location.origin
      : 'https://erp-final-with-all-the-changes.vercel.app';

    return redirectUrl;
  },
  // Get allowed origins for CORS
  getAllowedOrigins: () => {
    return [
      'http://localhost:3000',
      'https://erp-final-with-all-the-changes.vercel.app'
    ];
  }
};

export default oauthConfig; 