/// <reference types="vite/client" />

// Sync configuration comes from the build, not from code. Absent values
// leave the sync engine inert rather than pointing it at a guess.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_SCHEMA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
