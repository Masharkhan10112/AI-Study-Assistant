import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ApiError } from "../_shared/errors.ts";
import {
  openAiCompatibleProvider,
  parseJsonContent,
  readSseCompletion,
} from "../_shared/provider.ts";

function providerWith(responder: (url: string, init: RequestInit) => Response) {
  const requests: { url: string; body: unknown }[] = [];
  const provider = openAiCompatibleProvider({
    baseUrl: "https://provider.test/v1",
    apiKey: "test-key",
    chatModel: "test-chat",
    embeddingModel: "test-embed",
    fetchImpl: ((input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Promise.resolve(responder(String(input), init ?? {}));
    }) as typeof fetch,
  });
  return { provider, requests };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("completions send the configured model and return usage", async () => {
  const { provider, requests } = providerWith(() =>
    json({
      model: "test-chat-0625",
      choices: [{ message: { content: "hello" } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    })
  );
  const result = await provider.complete([{ role: "user", content: "hi" }], { json: true });
  assertEquals(result, {
    content: "hello",
    promptTokens: 12,
    completionTokens: 3,
    model: "test-chat-0625",
  });
  assertEquals(requests[0].url, "https://provider.test/v1/chat/completions");
  assertEquals((requests[0].body as { response_format: unknown }).response_format, {
    type: "json_object",
  });
});

Deno.test("a provider 429 is surfaced as rate_limited, not a 500", async () => {
  const { provider } = providerWith(() => json({ error: "slow down" }, 429));
  const error = await assertRejects(
    () => provider.complete([{ role: "user", content: "hi" }]),
    ApiError,
  );
  assertEquals(error.code, "rate_limited");
});

Deno.test("other provider failures become provider_unavailable", async () => {
  const { provider } = providerWith(() => json({ error: "boom" }, 500));
  const error = await assertRejects(() => provider.embed(["hi"]), ApiError);
  assertEquals(error.code, "provider_unavailable");
});

Deno.test("a network failure is a provider error, not a crash", async () => {
  const { provider } = providerWith(() => {
    throw new TypeError("connection refused");
  });
  const error = await assertRejects(() => provider.embed(["hi"]), ApiError);
  assertEquals(error.code, "provider_unavailable");
});

Deno.test("a short embedding batch is treated as a provider fault", async () => {
  const { provider } = providerWith(() => json({ data: [{ embedding: [0.1] }] }));
  const error = await assertRejects(() => provider.embed(["a", "b"]), ApiError);
  assertEquals(error.code, "provider_unavailable");
});

Deno.test("sse frames become tokens plus a usage promise", async () => {
  const frames = [
    'data: {"model":"test-chat","choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    "data: not-json\n\n",
    'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\n',
    "data: [DONE]\n\n",
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      // Split mid-frame to prove the reader buffers across chunks.
      const raw = frames.join("");
      controller.enqueue(encoder.encode(raw.slice(0, 40)));
      controller.enqueue(encoder.encode(raw.slice(40)));
      controller.close();
    },
  });

  const { tokens, usage } = readSseCompletion(body, "fallback");
  const seen: string[] = [];
  for await (const token of tokens) seen.push(token);
  assertEquals(seen, ["Hel", "lo"]);
  assertEquals(await usage, {
    content: "Hello",
    promptTokens: 9,
    completionTokens: 2,
    model: "test-chat",
  });
});

Deno.test("json content survives fences and prose", () => {
  assertEquals(parseJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  assertEquals(parseJsonContent('Sure! {"a":[1,2]} hope that helps'), { a: [1, 2] });
  assertThrows(() => parseJsonContent("no json here"), ApiError);
  assertThrows(() => parseJsonContent('{"a": }'), ApiError);
});
