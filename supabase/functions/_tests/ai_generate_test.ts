import { assertEquals } from "@std/assert";
import { resetRateLimits } from "../_shared/quota.ts";
import { createGenerateHandler } from "../ai-generate/handler.ts";
import { fakeContext, FakeDb, fakeDeps, FakeProvider, postRequest, withQuota } from "./fakes.ts";

const DOC = "66666666-6666-4666-8666-666666666666";

function setup(completion: string, document: Record<string, unknown> = {}) {
  resetRateLimits();
  const db = withQuota(new FakeDb(), 0, 100_000);
  db.rows("documents").push({ id: DOC, title: "Cell Biology", status: "ready", ...document });
  db.rows("document_chunks").push(
    {
      id: "chunk-a",
      document_id: DOC,
      chunk_index: 0,
      content: "Mitochondria make ATP.",
      page_from: 1,
    },
    {
      id: "chunk-b",
      document_id: DOC,
      chunk_index: 1,
      content: "Chloroplasts capture light.",
      page_from: 2,
    },
  );
  const provider = new FakeProvider({ completion });
  return { db, provider, handler: createGenerateHandler(fakeDeps(fakeContext(db), provider)) };
}

Deno.test("a summary is stored against its document", async () => {
  const { db, handler } = setup(JSON.stringify({ content_md: "## Cells\n- ATP" }));
  const response = await handler(
    postRequest({ kind: "summary", document_ids: [DOC], options: { style: "outline" } }),
  );

  assertEquals(response.status, 201);
  const body = await response.json();
  assertEquals(body.resource, "summary");
  assertEquals(db.rows("summaries")[0].content_md, "## Cells\n- ATP");
  assertEquals(db.rows("summaries")[0].style, "outline");
});

Deno.test("regenerating a summary replaces the cached one", async () => {
  const { db, handler } = setup(JSON.stringify({ content_md: "second pass" }));
  db.rows("summaries").push({
    id: "s1",
    document_id: DOC,
    style: "brief",
    content_md: "first pass",
  });

  await handler(postRequest({ kind: "summary", document_ids: [DOC] }));
  assertEquals(db.rows("summaries").length, 1);
  assertEquals(db.rows("summaries")[0].content_md, "second pass");
});

Deno.test("flashcards create a deck and cards that point back at their chunk", async () => {
  const { db, handler } = setup(JSON.stringify({
    cards: [
      { front: "What makes ATP?", back: "Mitochondria", card_type: "basic", chunk_index: 0 },
      { front: "What captures light?", back: "Chloroplasts", card_type: "basic", chunk_index: 1 },
    ],
  }));

  const response = await handler(
    postRequest({ kind: "flashcards", document_ids: [DOC], options: { count: 2 } }),
  );
  const body = await response.json();

  assertEquals(body.created, 2);
  assertEquals(db.rows("decks")[0].name, "Cell Biology — generated");
  assertEquals(db.rows("cards").map((card) => card.chunk_id), ["chunk-a", "chunk-b"]);
  assertEquals(db.rows("cards")[0].deck_id, body.resource_id);
});

Deno.test("cards land in an existing deck when one is given", async () => {
  const { db, handler } = setup(
    JSON.stringify({ cards: [{ front: "q", back: "a", chunk_index: 99 }] }),
  );
  const deckId = "77777777-7777-4777-8777-777777777777";

  const response = await handler(postRequest({
    kind: "flashcards",
    document_ids: [DOC],
    options: { deck_id: deckId },
  }));

  assertEquals((await response.json()).resource_id, deckId);
  assertEquals(db.rows("decks").length, 0);
  // An out-of-range citation is dropped rather than inserted as a bad reference.
  assertEquals(db.rows("cards")[0].chunk_id, null);
});

Deno.test("only the requested number of cards is kept", async () => {
  const { db, handler } = setup(JSON.stringify({
    cards: Array.from({ length: 5 }, (_, i) => ({ front: `q${i}`, back: `a${i}` })),
  }));
  await handler(postRequest({ kind: "flashcards", document_ids: [DOC], options: { count: 2 } }));
  assertEquals(db.rows("cards").length, 2);
});

Deno.test("a quiz stores questions in order with their options", async () => {
  const { db, handler } = setup(JSON.stringify({
    title: "Cells quiz",
    questions: [
      {
        question_type: "mcq",
        stem: "Which organelle makes ATP?",
        options: ["Mitochondria", "Ribosome"],
        correct_answer: "Mitochondria",
        explanation: "It is the powerhouse.",
        chunk_index: 0,
      },
      {
        question_type: "short_answer",
        stem: "Explain photosynthesis.",
        correct_answer: "light to sugar",
      },
    ],
  }));

  const response = await handler(
    postRequest({ kind: "quiz", document_ids: [DOC], options: { count: 5 } }),
  );
  assertEquals(response.status, 201);
  assertEquals(db.rows("quizzes")[0].title, "Cells quiz");
  const questions = db.rows("quiz_questions");
  assertEquals(questions.map((question) => question.position), [1, 2]);
  assertEquals(questions[0].options, ["Mitochondria", "Ribosome"]);
  assertEquals(questions[1].options, null);
});

Deno.test("a quiz whose mcq answer is not among its options is a provider fault", async () => {
  const { db, handler } = setup(JSON.stringify({
    questions: [{
      question_type: "mcq",
      stem: "Which?",
      options: ["a", "b"],
      correct_answer: "c",
    }],
  }));

  const response = await handler(postRequest({ kind: "quiz", document_ids: [DOC] }));
  assertEquals(response.status, 400);
  assertEquals(db.rows("quizzes").length, 0);
  assertEquals(db.rows("quiz_questions").length, 0);
});

Deno.test("plan items are numbered per day", async () => {
  const { db, handler } = setup(JSON.stringify({
    items: [
      { scheduled_for: "2026-03-01", activity: "read", title: "Ch 1", document_index: 0 },
      { scheduled_for: "2026-03-01", activity: "quiz", title: "Ch 1 quiz" },
      { scheduled_for: "2026-03-02", activity: "review", title: "Recall" },
    ],
  }));

  await handler(postRequest({
    kind: "plan",
    document_ids: [DOC],
    options: { goal: "Pass the midterm", exam_date: "2026-03-03" },
  }));

  assertEquals(db.rows("study_plans")[0].goal, "Pass the midterm");
  assertEquals(db.rows("plan_items").map((item) => item.position), [1, 2, 1]);
  assertEquals(db.rows("plan_items")[0].document_id, DOC);
  assertEquals(db.rows("plan_items")[1].document_id, null);
});

Deno.test("a document that is still ingesting is reported as not ready", async () => {
  const { provider, handler } = setup("{}", { status: "processing" });
  const response = await handler(postRequest({ kind: "summary", document_ids: [DOC] }));
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error.code, "document_not_ready");
  assertEquals(provider.completions.length, 0);
});

Deno.test("an unknown document is not found", async () => {
  const { handler } = setup("{}");
  const response = await handler(
    postRequest({ kind: "summary", document_ids: ["88888888-8888-4888-8888-888888888888"] }),
  );
  assertEquals(response.status, 404);
});

Deno.test("a retry with the same Idempotency-Key replays instead of regenerating", async () => {
  const { db, provider, handler } = setup(
    JSON.stringify({ cards: [{ front: "q", back: "a" }] }),
  );
  const headers = { "idempotency-key": "retry-1" };

  const first = await handler(postRequest({ kind: "flashcards", document_ids: [DOC] }, headers));
  assertEquals(first.status, 201);

  db.failures["idempotency_keys:unique"] = "23505";
  const second = await handler(postRequest({ kind: "flashcards", document_ids: [DOC] }, headers));

  assertEquals(second.status, 200);
  assertEquals(await second.json(), await first.json());
  assertEquals(db.rows("decks").length, 1);
  assertEquals(provider.completions.length, 1);
});

Deno.test("a failed generation releases its key so the retry can run", async () => {
  resetRateLimits();
  const db = withQuota(new FakeDb(), 0, 100_000);
  db.rows("documents").push({ id: DOC, title: "Cell Biology", status: "ready" });
  db.rows("document_chunks").push({
    id: "chunk-a",
    document_id: DOC,
    chunk_index: 0,
    content: "text",
  });
  const provider = new FakeProvider({ completion: "not json at all" });
  const handler = createGenerateHandler(fakeDeps(fakeContext(db), provider));

  const response = await handler(
    postRequest({ kind: "summary", document_ids: [DOC] }, { "idempotency-key": "k" }),
  );
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error.code, "provider_unavailable");
  assertEquals(db.rows("idempotency_keys").length, 0);
});
