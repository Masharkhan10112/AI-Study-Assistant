import { assertEquals } from "@std/assert";
import {
  buildContext,
  extractCitations,
  type Hit,
  hybridSearch,
  resolveDocumentIds,
} from "../_shared/retrieval.ts";
import { FakeDb, FakeProvider } from "./fakes.ts";

const hit = (id: string, content = "content of " + id): Hit => ({
  chunk_id: id,
  document_id: "doc-1",
  content,
  page_from: 3,
  page_to: 3,
  heading: null,
  score: 0.9,
});

Deno.test("explicit document ids win over a subject", async () => {
  const db = new FakeDb();
  assertEquals(
    await resolveDocumentIds(db.asClient(), { documentIds: ["a"], subjectId: "s" }),
    ["a"],
  );
});

Deno.test("an unscoped search searches everything", async () => {
  assertEquals(await resolveDocumentIds(new FakeDb().asClient(), {}), null);
});

Deno.test("a subject resolves to its documents", async () => {
  const db = new FakeDb({
    documents: [
      { id: "d1", subject_id: "s1" },
      { id: "d2", subject_id: "s2" },
    ],
  });
  assertEquals(await resolveDocumentIds(db.asClient(), { subjectId: "s1" }), ["d1"]);
});

Deno.test("an empty subject scope returns nothing instead of searching everything", async () => {
  const db = new FakeDb({ documents: [] });
  const provider = new FakeProvider();
  const result = await hybridSearch(db.asClient(), provider, "cells", { subjectId: "s-empty" });
  assertEquals(result.hits, []);
  // No embedding was bought for a search that cannot match.
  assertEquals(provider.embedCalls.length, 0);
  assertEquals(db.rpcCalls.length, 0);
});

Deno.test("the query embedding is passed to the hybrid rpc", async () => {
  const db = new FakeDb();
  db.rpcResults["hybrid_search_chunks"] = [hit("c1")];
  const provider = new FakeProvider({ embedding: [0.5, 0.25] });

  const result = await hybridSearch(db.asClient(), provider, "mitochondria", { limit: 5 });

  assertEquals(result.hits.length, 1);
  assertEquals(result.embeddingModel, "fake-embed");
  assertEquals(db.rpcCalls[0].name, "hybrid_search_chunks");
  assertEquals(db.rpcCalls[0].args, {
    query_text: "mitochondria",
    query_embedding: "[0.5,0.25]",
    match_count: 5,
    filter_document_ids: null,
  });
});

Deno.test("context is numbered from one and truncated to a budget", () => {
  const context = buildContext([hit("c1", "first"), hit("c2", "second")]);
  assertEquals(context, "[1] (p.3) first\n\n[2] (p.3) second");
  assertEquals(buildContext([hit("c1", "x".repeat(50))], 20), "");
});

Deno.test("only markers that exist become citations", () => {
  const hits = [hit("c1"), hit("c2")];
  assertEquals(
    extractCitations("Photosynthesis [2] happens in chloroplasts [2][9].", hits),
    [{ chunkId: "c2", rank: 1, snippet: "content of c2" }],
  );
  assertEquals(extractCitations("no markers at all", hits), []);
});
