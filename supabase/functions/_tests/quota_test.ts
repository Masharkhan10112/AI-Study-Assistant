import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ApiError } from "../_shared/errors.ts";
import {
  assertNotRateLimited,
  assertWithinQuota,
  recordUsage,
  resetRateLimits,
} from "../_shared/quota.ts";
import { fakeContext, FakeDb, TEST_USER, withQuota } from "./fakes.ts";

Deno.test("a user under their cap passes", async () => {
  const ctx = fakeContext(withQuota(new FakeDb(), 100, 1000));
  await assertWithinQuota(ctx, 10);
});

Deno.test("the cap is enforced before the provider is called", async () => {
  const ctx = fakeContext(withQuota(new FakeDb(), 990, 1000));
  const error = await assertRejects(() => assertWithinQuota(ctx, 50), ApiError);
  assertEquals(error.code, "quota_exceeded");
  assertEquals((error.details as { cap: number }).cap, 1000);
});

Deno.test("a user with no usage row today falls back to the default cap", async () => {
  const db = new FakeDb();
  db.rows("profiles").push({ id: TEST_USER, ai_daily_token_cap: null });
  await assertWithinQuota(fakeContext(db));
});

Deno.test("usage is accumulated through the service-role rpc", async () => {
  const db = withQuota(new FakeDb());
  await recordUsage(fakeContext(db), {
    functionName: "ai-chat",
    model: "gpt-test",
    promptTokens: 30,
    completionTokens: 7,
  });
  assertEquals(db.rpcCalls[0], {
    name: "record_ai_usage",
    args: {
      p_user_id: TEST_USER,
      p_function_name: "ai-chat",
      p_model: "gpt-test",
      p_requests: 1,
      p_prompt_tokens: 30,
      p_completion_tokens: 7,
    },
  });
});

Deno.test("a usage write failure does not fail the user's request", async () => {
  const db = withQuota(new FakeDb());
  db.failures["rpc:record_ai_usage"] = "connection lost";
  await recordUsage(fakeContext(db), {
    functionName: "search",
    model: "m",
    promptTokens: 1,
    completionTokens: 0,
  });
});

Deno.test("the rate limiter allows a burst then blocks within the window", () => {
  resetRateLimits();
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assertNotRateLimited("user-a", { limit: 3, now });
  assertThrows(() => assertNotRateLimited("user-a", { limit: 3, now }), ApiError);
  // A different user has their own bucket.
  assertNotRateLimited("user-b", { limit: 3, now });
  // And the window slides.
  assertNotRateLimited("user-a", { limit: 3, now: now + 61_000 });
});
