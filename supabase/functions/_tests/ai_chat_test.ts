import { assertEquals } from "@std/assert";
import { resetRateLimits } from "../_shared/quota.ts";
import { createChatHandler } from "../ai-chat/handler.ts";
import { fakeContext, FakeDb, fakeDeps, FakeProvider, postRequest, withQuota } from "./fakes.ts";

const THREAD = "44444444-4444-4444-8444-444444444444";

function setup(options: { completion?: string; used?: number } = {}) {
  resetRateLimits();
  const db = withQuota(new FakeDb(), options.used ?? 0, 100_000);
  db.rows("chat_threads").push({ id: THREAD, subject_id: null, scope: {} });
  db.rpcResults["hybrid_search_chunks"] = [
    {
      chunk_id: "c1",
      document_id: "d1",
      content: "Mitochondria produce ATP.",
      page_from: 7,
      page_to: 7,
      heading: null,
      score: 0.9,
    },
  ];
  const provider = new FakeProvider({ completion: options.completion ?? "ATP is made there [1]." });
  return { db, provider, handler: createChatHandler(fakeDeps(fakeContext(db), provider)) };
}

async function readSse(response: Response): Promise<{ event: string; data: any }[]> {
  const raw = await response.text();
  return raw.split("\n\n").filter(Boolean).map((frame) => {
    const [eventLine, dataLine] = frame.split("\n");
    return { event: eventLine.replace("event: ", ""), data: JSON.parse(dataLine.slice(6)) };
  });
}

Deno.test("a non-streaming turn answers with citations and persists both messages", async () => {
  const { db, handler } = setup();
  const response = await handler(
    postRequest({ thread_id: THREAD, message: "How is ATP made?", stream: false }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.content, "ATP is made there [1].");
  assertEquals(body.citations, [{ chunkId: "c1", rank: 1, snippet: "Mitochondria produce ATP." }]);
  assertEquals(body.sources[0].n, 1);

  const messages = db.rows("chat_messages");
  assertEquals(messages.map((message) => message.role), ["user", "assistant"]);
  assertEquals(messages[1].prompt_tokens, 100);
  assertEquals(db.rows("message_citations").length, 1);
  assertEquals(db.rpcCalls.at(-1)?.args, {
    p_user_id: messages[1].user_id,
    p_function_name: "ai-chat",
    p_model: "fake-chat",
    // Embedding tokens for retrieval are billed with the completion.
    p_prompt_tokens: 105,
    p_completion_tokens: 20,
    p_requests: 1,
  });
});

Deno.test("the prompt carries numbered context and prior turns", async () => {
  const { db, provider, handler } = setup();
  db.rows("chat_messages").push({
    thread_id: THREAD,
    role: "assistant",
    content: "earlier answer",
    created_at: "2026-01-01",
  });

  await handler(postRequest({ thread_id: THREAD, message: "and then?", stream: false }));
  const messages = provider.completions[0];
  assertEquals(messages[0].role, "system");
  assertEquals(messages[1].content, "earlier answer");
  assertEquals(messages.at(-1)!.content.includes("[1] (p.7) Mitochondria produce ATP."), true);
});

Deno.test("streaming emits sources, tokens and a final done frame", async () => {
  const { db, handler } = setup();
  const response = await handler(postRequest({ thread_id: THREAD, message: "How is ATP made?" }));

  assertEquals(response.headers.get("content-type"), "text/event-stream");
  const frames = await readSse(response);
  assertEquals(frames[0].event, "sources");
  assertEquals(
    frames.filter((frame) => frame.event === "token").map((f) => f.data.delta).join(""),
    "ATP is made there [1].",
  );

  const done = frames.at(-1)!;
  assertEquals(done.event, "done");
  assertEquals(done.data.citations.length, 1);
  assertEquals(db.rows("chat_messages")[1].content, "ATP is made there [1].");
});

Deno.test("an answer without markers persists no citations", async () => {
  const { db, handler } = setup({ completion: "I could not find that in your notes." });
  await handler(postRequest({ thread_id: THREAD, message: "unrelated", stream: false }));
  assertEquals(db.rows("message_citations").length, 0);
});

Deno.test("another user's thread is not found", async () => {
  const { handler } = setup();
  const response = await handler(
    postRequest({
      thread_id: "55555555-5555-4555-8555-555555555555",
      message: "hi",
      stream: false,
    }),
  );
  assertEquals(response.status, 404);
});

Deno.test("an exhausted quota blocks the turn before retrieval", async () => {
  const { provider, handler } = setup({ used: 100_000 });
  const response = await handler(postRequest({ thread_id: THREAD, message: "hi", stream: false }));
  assertEquals(response.status, 429);
  assertEquals(provider.embedCalls.length, 0);
});
