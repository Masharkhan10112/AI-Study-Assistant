import { assertEquals, assertThrows } from "@std/assert";
import { ApiError } from "../_shared/errors.ts";
import {
  chatRequestSchema,
  generateRequestSchema,
  ingestRequestSchema,
  parse,
  planOutputSchema,
  quizOutputSchema,
  searchRequestSchema,
} from "../_shared/validation.ts";

const UUID = "11111111-1111-4111-8111-111111111111";

Deno.test("validation failures carry field level details", () => {
  const error = assertThrows(
    () => parse(ingestRequestSchema, { document_id: "nope" }),
    ApiError,
  ) as ApiError;
  assertEquals(error.code, "invalid_request");
  assertEquals((error.details as { path: string }[])[0].path, "document_id");
});

Deno.test("unknown fields are rejected rather than ignored", () => {
  assertThrows(() => parse(ingestRequestSchema, { document_id: UUID, admin: true }), ApiError);
});

Deno.test("defaults are applied", () => {
  assertEquals(parse(ingestRequestSchema, { document_id: UUID }).force, false);
  assertEquals(parse(searchRequestSchema, { query: "photosynthesis" }).limit, 10);
  assertEquals(parse(chatRequestSchema, { thread_id: UUID, message: "hi" }).stream, true);
});

Deno.test("search limits are bounded", () => {
  assertThrows(() => parse(searchRequestSchema, { query: "hi", limit: 500 }), ApiError);
  assertThrows(() => parse(searchRequestSchema, { query: "a" }), ApiError);
});

Deno.test("generate is a discriminated union with per-kind options", () => {
  const flashcards = parse(generateRequestSchema, {
    kind: "flashcards",
    document_ids: [UUID],
  });
  assertEquals(flashcards.kind === "flashcards" && flashcards.options.count, 15);

  // A summary has nowhere to store a second document.
  assertThrows(
    () => parse(generateRequestSchema, { kind: "summary", document_ids: [UUID, UUID] }),
    ApiError,
  );
  // A plan needs its goal and exam date.
  assertThrows(
    () => parse(generateRequestSchema, { kind: "plan", document_ids: [UUID], options: {} }),
    ApiError,
  );
  assertThrows(
    () => parse(generateRequestSchema, { kind: "podcast", document_ids: [UUID] }),
    ApiError,
  );
});

Deno.test("quiz output mirrors the database option constraint", () => {
  const mcq = {
    questions: [{
      question_type: "mcq",
      stem: "Which organelle?",
      options: ["Nucleus", "Chloroplast"],
      correct_answer: "Chloroplast",
    }],
  };
  assertEquals(parse(quizOutputSchema, mcq).questions.length, 1);

  // Correct answer missing from the options.
  assertThrows(
    () =>
      parse(quizOutputSchema, {
        questions: [{ ...mcq.questions[0], correct_answer: "Ribosome" }],
      }),
    ApiError,
  );
  // Non-MCQ questions must not carry options.
  assertThrows(
    () =>
      parse(quizOutputSchema, {
        questions: [{
          question_type: "short_answer",
          stem: "Explain.",
          options: ["a", "b"],
          correct_answer: "because",
        }],
      }),
    ApiError,
  );
});

Deno.test("plan items need real dates", () => {
  assertThrows(
    () =>
      parse(planOutputSchema, {
        items: [{ scheduled_for: "next tuesday", activity: "read", title: "Ch. 1" }],
      }),
    ApiError,
  );
  const plan = parse(planOutputSchema, {
    items: [{ scheduled_for: "2026-03-01", activity: "read", title: "Ch. 1" }],
  });
  assertEquals(plan.items[0].estimated_minutes, 30);
});
