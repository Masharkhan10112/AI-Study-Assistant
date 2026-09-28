import { assertEquals } from "@std/assert";
import { resetRateLimits } from "../_shared/quota.ts";
import { createIngestHandler } from "../ingest/handler.ts";
import { fakeContext, FakeDb, fakeDeps, FakeProvider, postRequest, withQuota } from "./fakes.ts";

const DOC = "22222222-2222-4222-8222-222222222222";

function setup(document: Record<string, unknown> = {}) {
  resetRateLimits();
  const db = withQuota(new FakeDb(), 0, 100_000);
  db.rows("documents").push({
    id: DOC,
    source_type: "paste",
    storage_path: null,
    status: "queued",
    ...document,
  });
  db.rows("ingestion_jobs").push({ document_id: DOC, status: "queued" });
  const provider = new FakeProvider();
  return { db, provider, handler: createIngestHandler(fakeDeps(fakeContext(db), provider)) };
}

Deno.test("pasted text is chunked, embedded and stored", async () => {
  const { db, provider, handler } = setup();
  const response = await handler(postRequest({ document_id: DOC, text: "Cells have membranes." }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "ready", chunk_count: 1, skipped: false });

  const chunk = db.rows("document_chunks")[0];
  assertEquals(chunk.content, "Cells have membranes.");
  assertEquals(chunk.chunk_index, 0);
  assertEquals(chunk.embedding, "[0.1,0.2,0.3]");
  assertEquals(provider.embedCalls, [["Cells have membranes."]]);

  assertEquals(db.rows("documents")[0].status, "ready");
  assertEquals(db.rows("documents")[0].ingested_at, "2026-01-02T03:04:05.000Z");
  assertEquals(db.rows("ingestion_jobs")[0].status, "succeeded");
  assertEquals(db.rpcCalls.at(-1)?.args.p_function_name, "ingest");
});

Deno.test("an already-ready document is a no-op", async () => {
  const { db, provider, handler } = setup({ status: "ready" });
  db.rows("document_chunks").push({ document_id: DOC }, { document_id: DOC });

  const response = await handler(postRequest({ document_id: DOC }));
  assertEquals(await response.json(), { status: "ready", chunk_count: 2, skipped: true });
  assertEquals(provider.embedCalls.length, 0);
});

Deno.test("re-ingesting with force replaces the old chunks instead of duplicating", async () => {
  const { db, handler } = setup({ status: "ready" });
  db.rows("document_chunks").push({ document_id: DOC, chunk_index: 0, content: "stale" });

  await handler(postRequest({ document_id: DOC, text: "Fresh text.", force: true }));
  assertEquals(db.rows("document_chunks").length, 1);
  assertEquals(db.rows("document_chunks")[0].content, "Fresh text.");
});

Deno.test("a document being processed is not ingested twice", async () => {
  const { handler } = setup({ status: "processing" });
  const response = await handler(postRequest({ document_id: DOC, text: "hi" }));
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error.code, "conflict");
});

Deno.test("another user's document is simply not found", async () => {
  const { handler } = setup();
  const response = await handler(
    postRequest({ document_id: "33333333-3333-4333-8333-333333333333", text: "hi" }),
  );
  assertEquals(response.status, 404);
  assertEquals((await response.json()).error.code, "not_found");
});

Deno.test("a pasted document without text fails the document and reports why", async () => {
  const { db, handler } = setup();
  const response = await handler(postRequest({ document_id: DOC }));

  assertEquals(response.status, 400);
  assertEquals(db.rows("documents")[0].status, "failed");
  assertEquals(
    db.rows("documents")[0].error,
    "A pasted document needs its `text` in the request.",
  );
  assertEquals(db.rows("ingestion_jobs")[0].status, "failed");
});

Deno.test("text files are read from storage", async () => {
  const { db, handler } = setup({ source_type: "txt", storage_path: `user/${DOC}/source.txt` });
  db.storageFiles[`user/${DOC}/source.txt`] = "Newton's second law.";

  const response = await handler(postRequest({ document_id: DOC }));
  assertEquals(response.status, 200);
  assertEquals(db.rows("document_chunks")[0].content, "Newton's second law.");
});

Deno.test("a missing storage object is document_not_ready, not a 500", async () => {
  const { db, handler } = setup({ source_type: "txt", storage_path: "user/missing.txt" });
  const response = await handler(postRequest({ document_id: DOC }));
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error.code, "document_not_ready");
  assertEquals(db.rows("documents")[0].status, "failed");
});

Deno.test("unsupported source types are rejected with a clear message", async () => {
  const { handler } = setup({ source_type: "image", storage_path: "user/scan.png" });
  const response = await handler(postRequest({ document_id: DOC }));
  assertEquals(response.status, 400);
  assertEquals(
    (await response.json()).error.message.includes("cannot be ingested yet"),
    true,
  );
});

Deno.test("a provider outage leaves the document failed and retryable", async () => {
  resetRateLimits();
  const db = withQuota(new FakeDb(), 0, 100_000);
  db.rows("documents").push({
    id: DOC,
    source_type: "paste",
    storage_path: null,
    status: "queued",
  });
  const provider = new FakeProvider({ failWith: new Error("provider down") });
  const handler = createIngestHandler(fakeDeps(fakeContext(db), provider));

  const response = await handler(postRequest({ document_id: DOC, text: "Some notes." }));
  assertEquals(response.status, 500);
  assertEquals(db.rows("documents")[0].status, "failed");
  assertEquals(db.rows("document_chunks").length, 0);
});
