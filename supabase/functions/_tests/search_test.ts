import { assertEquals } from "@std/assert";
import { resetRateLimits } from "../_shared/quota.ts";
import { createSearchHandler } from "../search/handler.ts";
import {
  fakeContext,
  FakeDb,
  fakeDeps,
  FakeProvider,
  postRequest,
  TEST_USER,
  withQuota,
} from "./fakes.ts";

function setup(usedTokens = 0) {
  resetRateLimits();
  const db = withQuota(new FakeDb(), usedTokens, 1000);
  db.rpcResults["hybrid_search_chunks"] = [{
    chunk_id: "c1",
    document_id: "d1",
    content: "Chloroplasts capture light.",
    page_from: 2,
    page_to: 2,
    heading: "Photosynthesis",
    score: 0.81,
  }];
  const provider = new FakeProvider();
  return { db, provider, handler: createSearchHandler(fakeDeps(fakeContext(db), provider)) };
}

Deno.test("search returns hits and bills the embedding", async () => {
  const { db, handler } = setup();
  const response = await handler(postRequest({ query: "photosynthesis", limit: 3 }));

  assertEquals(response.status, 200);
  assertEquals((await response.json()).hits[0].chunk_id, "c1");
  assertEquals(db.rpcCalls[0].args.match_count, 3);
  assertEquals(db.rpcCalls[1], {
    name: "record_ai_usage",
    args: {
      p_user_id: TEST_USER,
      p_function_name: "search",
      p_model: "fake-embed",
      p_requests: 1,
      p_prompt_tokens: 5,
      p_completion_tokens: 0,
    },
  });
});

Deno.test("an invalid query never reaches the provider", async () => {
  const { provider, handler } = setup();
  const response = await handler(postRequest({ query: "a", limit: 3 }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "invalid_request");
  assertEquals(provider.embedCalls.length, 0);
});

Deno.test("an exhausted quota blocks the search before the provider call", async () => {
  const { provider, handler } = setup(1000);
  const response = await handler(postRequest({ query: "photosynthesis" }));
  assertEquals(response.status, 429);
  assertEquals((await response.json()).error.code, "quota_exceeded");
  assertEquals(provider.embedCalls.length, 0);
});

Deno.test("a burst of requests is rate limited", async () => {
  const { handler } = setup();
  let last = new Response();
  for (let i = 0; i < 61; i++) last = await handler(postRequest({ query: "photosynthesis" }));
  assertEquals(last.status, 429);
  assertEquals((await last.json()).error.code, "rate_limited");
});
