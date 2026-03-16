/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly TENCENT_SECRET_ID?: string;
  readonly TENCENT_SECRET_KEY?: string;
  readonly TRIPAY_API_KEY?: string;
  readonly TRIPAY_PRIVATE_KEY?: string;
  readonly TRIPAY_MERCHANT_CODE?: string;
  readonly TRIPAY_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css' {
  const content: string;
  export default content;
}
