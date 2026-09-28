import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./errors.ts";

export interface AuthContext {
  userId: string;
  // Runs as the caller: RLS applies, so reads and writes cannot escape the user.
  db: SupabaseClient;
  // Bypasses RLS. Only for pipeline-owned tables (document_chunks,
  // ingestion_jobs, ai_usage) that clients are not allowed to write.
  admin: SupabaseClient;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new ApiError("internal_error", `Missing ${name} in the function environment.`);
  return value;
}

export function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError("unauthorized", "A bearer token is required.");
  return match[1].trim();
}

export async function authenticate(req: Request): Promise<AuthContext> {
  const token = bearerToken(req);
  const url = requireEnv("SUPABASE_URL");

  const db = createClient(url, requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiError("unauthorized", "The bearer token is missing, expired or invalid.");
  }

  const admin = createClient(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { userId: data.user.id, db, admin };
}
