import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./errors.ts";

export interface UsageDelta {
  functionName: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  requests?: number;
}

const DEFAULT_TOKEN_CAP = 200_000;

// Checked before every provider call. `ai_usage` is service-role-write-only, so
// a client cannot reset its own counters to get past this.
export async function assertWithinQuota(
  ctx: { userId: string; admin: SupabaseClient },
  estimatedTokens = 0,
): Promise<void> {
  const [{ data: profile, error: profileError }, { data: usage, error: usageError }] = await Promise
    .all([
      ctx.admin.from("profiles").select("ai_daily_token_cap").eq("id", ctx.userId).maybeSingle(),
      ctx.admin.from("ai_usage_today").select("total_tokens").eq("user_id", ctx.userId)
        .maybeSingle(),
    ]);
  if (profileError) throw new ApiError("internal_error", profileError.message);
  if (usageError) throw new ApiError("internal_error", usageError.message);

  const cap = profile?.ai_daily_token_cap ?? DEFAULT_TOKEN_CAP;
  const used = usage?.total_tokens ?? 0;
  if (used + estimatedTokens >= cap) {
    throw new ApiError(
      "quota_exceeded",
      `Daily AI token cap reached (${used} of ${cap} tokens used). It resets at midnight UTC.`,
      { used, cap },
    );
  }
}

// One counter row per user/day/function/model; repeated calls accumulate.
export async function recordUsage(
  ctx: { userId: string; admin: SupabaseClient },
  delta: UsageDelta,
): Promise<void> {
  const { error } = await ctx.admin.rpc("record_ai_usage", {
    p_user_id: ctx.userId,
    p_function_name: delta.functionName,
    p_model: delta.model,
    p_requests: delta.requests ?? 1,
    p_prompt_tokens: delta.promptTokens,
    p_completion_tokens: delta.completionTokens,
  });
  // Usage accounting must never fail the user's request; it is logged instead.
  if (error) console.error("failed to record ai_usage:", error.message);
}

interface RateLimitState {
  hits: number[];
}

const buckets = new Map<string, RateLimitState>();

// Best-effort burst protection, per isolate — the daily cap above is the
// authoritative limit, this only blunts rapid-fire retries.
export function assertNotRateLimited(
  key: string,
  { limit = 20, windowMs = 60_000, now = Date.now() }: {
    limit?: number;
    windowMs?: number;
    now?: number;
  } = {},
): void {
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    throw new ApiError(
      "rate_limited",
      "Too many requests. Please slow down and try again shortly.",
    );
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
}

export function resetRateLimits(): void {
  buckets.clear();
}
