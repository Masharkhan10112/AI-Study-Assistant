import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./errors.ts";

export interface IdempotencyHandle {
  replay?: unknown;
  complete(response: unknown): Promise<void>;
  release(): Promise<void>;
}

const NO_OP: IdempotencyHandle = {
  complete: () => Promise.resolve(),
  release: () => Promise.resolve(),
};

/**
 * Honours the `Idempotency-Key` header on generation endpoints so a retried
 * click does not produce a second deck. The unique index on
 * (user_id, function_name, key) is what makes the claim atomic: the second
 * caller loses the insert and either replays the stored response or is told
 * the first call is still running.
 */
export async function beginIdempotent(
  ctx: { userId: string; admin: SupabaseClient },
  functionName: string,
  req: Request,
): Promise<IdempotencyHandle> {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) return NO_OP;
  if (key.length > 200) throw new ApiError("invalid_request", "Idempotency-Key is too long.");

  const { error } = await ctx.admin.from("idempotency_keys").insert({
    user_id: ctx.userId,
    function_name: functionName,
    key,
  });

  if (error) {
    if (error.code !== "23505") throw new ApiError("internal_error", error.message);
    const { data: existing } = await ctx.admin
      .from("idempotency_keys")
      .select("response")
      .eq("user_id", ctx.userId)
      .eq("function_name", functionName)
      .eq("key", key)
      .maybeSingle();
    if (existing?.response) return { ...NO_OP, replay: existing.response };
    throw new ApiError("conflict", "A request with this Idempotency-Key is still in flight.");
  }

  const match = { user_id: ctx.userId, function_name: functionName, key };
  return {
    async complete(response: unknown) {
      await ctx.admin.from("idempotency_keys").update({ response }).match(match);
    },
    async release() {
      // A failed request should be retryable with the same key.
      await ctx.admin.from("idempotency_keys").delete().match(match);
    },
  };
}
