/// <reference types="react-scripts" />

declare namespace NodeJS {
  interface ProcessEnv {
    readonly REACT_APP_SUPABASE_URL?: string;
    readonly REACT_APP_SUPABASE_ANON_KEY?: string;
    readonly REACT_APP_APP_URL?: string;
    readonly REACT_APP_LOCAL_DEV_ORIGIN?: string;
    readonly REACT_APP_WHATSAPP_LINK?: string;
    readonly NODE_ENV: 'development' | 'production' | 'test';
  }
}
