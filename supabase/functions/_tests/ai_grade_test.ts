import { assertEquals } from "@std/assert";
import { resetRateLimits } from "../_shared/quota.ts";
import { createGradeHandler } from "../ai-grade/handler.ts";
import { fakeContext, FakeDb, fakeDeps, FakeProvider, postRequest, withQuota } from "./fakes.ts";

const ATTEMPT = "99999999-9999-4999-8999-999999999999";

interface AnswerSpec {
  id: string;
  type: "mcq" | "true_false" | "short_answer";
  response: string | null;
  correct: string;
  explanation?: string;
}

function setup(answers: AnswerSpec[], completion = "{}") {
  resetRateLimits();
  const db = withQuota(new FakeDb(), 0, 100_000);
  db.rows("quiz_attempts").push({
    id: ATTEMPT,
    quiz_id: "quiz-1",
    score: null,
    submitted_at: null,
    started_at: "2026-01-02T03:00:05.000Z",
  });
  for (const answer of answers) {
    db.rows("quiz_answers").push({
      id: answer.id,
      attempt_id: ATTEMPT,
      question_id: `q-${answer.id}`,
      response: answer.response,
      quiz_questions: {
        question_type: answer.type,
        stem: "stem",
        correct_answer: answer.correct,
        explanation: answer.explanation ?? null,
      },
    });
  }
  const provider = new FakeProvider({ completion });
  return { db, provider, handler: createGradeHandler(fakeDeps(fakeContext(db), provider)) };
}

Deno.test("objective questions are graded without spending tokens", async () => {
  const { db, provider, handler } = setup([
    { id: "a1", type: "mcq", response: "Mitochondria", correct: "Mitochondria" },
    {
      id: "a2",
      type: "true_false",
      response: "false",
      correct: "true",
      explanation: "It is true.",
    },
  ]);

  const response = await handler(postRequest({ attempt_id: ATTEMPT }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.score, 0.5);
  assertEquals(body.per_question.map((q: { is_correct: boolean }) => q.is_correct), [true, false]);
  assertEquals(provider.completions.length, 0);
  assertEquals(db.rpcCalls.length, 0);

  assertEquals(db.rows("quiz_answers")[1].feedback, "It is true.");
  assertEquals(db.rows("quiz_attempts")[0].score, 0.5);
  assertEquals(db.rows("quiz_attempts")[0].submitted_at, "2026-01-02T03:04:05.000Z");
  assertEquals(db.rows("quiz_attempts")[0].duration_seconds, 240);
});

Deno.test("objective matching ignores case, spacing and trailing punctuation", async () => {
  const { handler } = setup([
    { id: "a1", type: "short_answer", response: null, correct: "x" },
    { id: "a2", type: "mcq", response: "  the  Nucleus. ", correct: "The Nucleus" },
  ], JSON.stringify({ results: [{ question_index: 0, score: 0, feedback: "blank" }] }));

  const body = await (await handler(postRequest({ attempt_id: ATTEMPT }))).json();
  const mcq = body.per_question.find((q: { question_id: string }) => q.question_id === "q-a2");
  assertEquals(mcq.is_correct, true);
});

Deno.test("short answers are graded by the model and billed", async () => {
  const { db, provider, handler } = setup(
    [
      {
        id: "a1",
        type: "short_answer",
        response: "Light makes sugar",
        correct: "Photosynthesis makes sugar",
      },
      { id: "a2", type: "mcq", response: "wrong", correct: "right" },
    ],
    JSON.stringify({ results: [{ question_index: 0, score: 0.5, feedback: "Partly right." }] }),
  );

  const body = await (await handler(postRequest({ attempt_id: ATTEMPT }))).json();

  assertEquals(body.score, 0.25);
  assertEquals(provider.completions.length, 1);
  // Only the short answer was sent to the model.
  assertEquals(provider.completions[0][1].content.includes("Light makes sugar"), true);
  assertEquals(provider.completions[0][1].content.includes("wrong"), false);
  assertEquals(db.rows("quiz_answers")[0].feedback, "Partly right.");
  assertEquals(db.rpcCalls[0].args.p_function_name, "ai-grade");
});

Deno.test("a grader that skips a question is a provider fault", async () => {
  const { handler } = setup(
    [{ id: "a1", type: "short_answer", response: "something", correct: "other" }],
    JSON.stringify({ results: [] }),
  );
  const response = await handler(postRequest({ attempt_id: ATTEMPT }));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error.code, "provider_unavailable");
});

Deno.test("another user's attempt is not found", async () => {
  const { handler } = setup([{ id: "a1", type: "mcq", response: "a", correct: "a" }]);
  const response = await handler(
    postRequest({ attempt_id: "12121212-1212-4121-8121-121212121212" }),
  );
  assertEquals(response.status, 404);
});

Deno.test("an attempt with no answers is a client error", async () => {
  const { handler } = setup([]);
  const response = await handler(postRequest({ attempt_id: ATTEMPT }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "invalid_request");
});
