import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set — copy .env.example to .env and fill them in from `npx supabase status`.",
  );
}

// Access and refresh tokens travel on every request, so plain HTTP is only
// ever the local stack.
if (url.startsWith("http://") && window.location.protocol === "https:") {
  throw new Error("VITE_SUPABASE_URL must use https when the app is served over https.");
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;
