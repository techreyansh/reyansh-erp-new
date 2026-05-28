// Supabase Google OAuth redirect configuration.
const oauthConfig = {
  scopes: [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ],
  // Get the current origin for OAuth redirect
  getRedirectUri: () => {
    return window.location.origin;
  },
  // Get allowed origins for CORS
  getAllowedOrigins: () => {
    return [
      'http://localhost:3000',
      'https://erp-final-update-guje.vercel.app'
    ];
  }
};

export default oauthConfig; 