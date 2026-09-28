import { z } from "zod";
import { ApiError } from "./errors.ts";

// Request validation. Every handler parses its body through `parse`, so a bad
// request is a 400 with field-level details instead of a database error later.
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
  throw new ApiError("invalid_request", "Request failed validation.", details);
}

const uuid = z.string().uuid();
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const ingestRequestSchema = z.object({
  document_id: uuid,
  // Pasted documents have no file in Storage, so their text comes with the
  // request; every other source type is read from the bucket.
  text: z.string().max(400_000).optional(),
  force: z.boolean().default(false),
}).strict();

export const searchRequestSchema = z.object({
  query: trimmed(2, 500),
  subject_id: uuid.nullish(),
  document_ids: z.array(uuid).max(50).nullish(),
  limit: z.number().int().min(1).max(50).default(10),
}).strict();

export const chatRequestSchema = z.object({
  thread_id: uuid,
  message: trimmed(1, 4000),
  scope: z.object({
    document_ids: z.array(uuid).max(50).optional(),
    subject_id: uuid.nullish(),
  }).strict().default({}),
  stream: z.boolean().default(true),
}).strict();

export const gradeRequestSchema = z.object({
  attempt_id: uuid,
}).strict();

const documentIds = z.array(uuid).min(1).max(10);

export const generateRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("summary"),
    // `summaries` is keyed by a single document, so summarising several at
    // once would have nowhere to live.
    document_ids: z.array(uuid).length(1),
    options: z.object({
      style: z.enum(["brief", "detailed", "outline"]).default("brief"),
    }).strict().default({}),
  }).strict(),
  z.object({
    kind: z.literal("flashcards"),
    document_ids: documentIds,
    options: z.object({
      count: z.number().int().min(1).max(50).default(15),
      deck_id: uuid.nullish(),
      deck_name: trimmed(1, 120).optional(),
      subject_id: uuid.nullish(),
    }).strict().default({}),
  }).strict(),
  z.object({
    kind: z.literal("quiz"),
    document_ids: documentIds,
    options: z.object({
      count: z.number().int().min(1).max(30).default(10),
      difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
      question_types: z.array(z.enum(["mcq", "true_false", "short_answer"]))
        .min(1).default(["mcq"]),
      title: trimmed(1, 200).optional(),
      subject_id: uuid.nullish(),
    }).strict().default({}),
  }).strict(),
  z.object({
    kind: z.literal("plan"),
    document_ids: documentIds,
    options: z.object({
      goal: trimmed(3, 500),
      exam_date: z.string().date(),
      daily_minutes: z.number().int().min(10).max(600).default(60),
      subject_id: uuid.nullish(),
    }).strict(),
  }).strict(),
]);

export type IngestRequest = z.infer<typeof ingestRequestSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type GradeRequest = z.infer<typeof gradeRequestSchema>;
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

// Model output validation. The provider returns free-form JSON, so it is
// validated with the same rigour as user input before any insert — a
// hallucinated shape becomes a provider error, never a malformed row.
export const summaryOutputSchema = z.object({
  content_md: trimmed(1, 20_000),
}).strict();

export const flashcardsOutputSchema = z.object({
  cards: z.array(
    z.object({
      front: trimmed(1, 500),
      back: trimmed(1, 2000),
      card_type: z.enum(["basic", "cloze"]).default("basic"),
      source_quote: z.string().trim().max(1000).optional(),
      chunk_index: z.number().int().min(0).optional(),
    }).strict(),
  ).min(1).max(50),
}).strict();

export const quizOutputSchema = z.object({
  title: trimmed(1, 200).optional(),
  questions: z.array(
    z.object({
      question_type: z.enum(["mcq", "true_false", "short_answer"]),
      stem: trimmed(1, 1000),
      options: z.array(trimmed(1, 500)).min(2).max(8).optional(),
      correct_answer: trimmed(1, 500),
      explanation: z.string().trim().max(2000).optional(),
      chunk_index: z.number().int().min(0).optional(),
    }).strict(),
  ).min(1).max(30),
}).strict()
  // Mirrors the `quiz_questions_options_shape` check constraint, so a bad
  // question is rejected before it reaches Postgres.
  .refine(
    (value) =>
      value.questions.every((q) =>
        q.question_type === "mcq"
          ? Array.isArray(q.options) && q.options.includes(q.correct_answer)
          : q.options === undefined
      ),
    { message: "MCQ questions need options containing the correct answer; other types need none." },
  );

export const planOutputSchema = z.object({
  items: z.array(
    z.object({
      scheduled_for: z.string().date(),
      activity: z.enum(["read", "review", "quiz", "practice"]),
      title: trimmed(1, 200),
      estimated_minutes: z.number().int().min(5).max(480).default(30),
      document_index: z.number().int().min(0).optional(),
    }).strict(),
  ).min(1).max(200),
}).strict();

export const gradeOutputSchema = z.object({
  results: z.array(
    z.object({
      question_index: z.number().int().min(0),
      score: z.number().min(0).max(1),
      feedback: z.string().trim().max(1000),
    }).strict(),
  ),
}).strict();
