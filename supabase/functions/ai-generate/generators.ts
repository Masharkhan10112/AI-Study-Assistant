import type { AuthContext } from "../_shared/auth.ts";
import { ApiError } from "../_shared/errors.ts";
import { type AiProvider, parseJsonContent } from "../_shared/provider.ts";
import {
  flashcardsOutputSchema,
  type GenerateRequest,
  parse,
  planOutputSchema,
  quizOutputSchema,
  summaryOutputSchema,
} from "../_shared/validation.ts";
import { chunkIdAt, type GenerationContext } from "./context.ts";

export interface GenerationResult {
  resourceId: string;
  resource: string;
  created: number;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

type Generator = (
  ctx: AuthContext,
  provider: AiProvider,
  request: GenerateRequest,
  context: GenerationContext,
  now: Date,
) => Promise<GenerationResult>;

function insertError(error: { message: string } | null): void {
  if (error) throw new ApiError("internal_error", error.message);
}

// Unwraps a `.select("id").single()` insert into the new row's id.
function insertedId(
  result: { data: { id: string } | null; error: { message: string } | null },
): string {
  insertError(result.error);
  if (!result.data) throw new ApiError("internal_error", "The row was inserted but not returned.");
  return result.data.id;
}

const CITE_RULE =
  "Passages are numbered from 0. Reference the passage you used with its number in `chunk_index`.";

async function completeJson(provider: AiProvider, system: string, user: string) {
  const completion = await provider.complete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    { json: true },
  );
  return { payload: parseJsonContent(completion.content), completion };
}

const generateSummary: Generator = async (ctx, provider, request, context) => {
  if (request.kind !== "summary") throw new ApiError("internal_error", "wrong generator");
  const { style } = request.options;
  const { payload, completion } = await completeJson(
    provider,
    `You summarise study material as markdown. Style: ${style}. ` +
      'Reply as JSON: {"content_md": "..."}. Use only the passages given.',
    `Passages:\n${context.text}`,
  );
  const output = parse(summaryOutputSchema, payload);

  // One cached summary per (document, style) — regenerating replaces it.
  const summaryId = insertedId(
    await ctx.db.from("summaries").upsert({
      user_id: ctx.userId,
      document_id: request.document_ids[0],
      style,
      content_md: output.content_md,
      model: completion.model,
    }, { onConflict: "document_id,style" }).select("id").single(),
  );

  return {
    resourceId: summaryId,
    resource: "summary",
    created: 1,
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
    model: completion.model,
  };
};

const generateFlashcards: Generator = async (ctx, provider, request, context) => {
  if (request.kind !== "flashcards") throw new ApiError("internal_error", "wrong generator");
  const { count, deck_id, deck_name, subject_id } = request.options;
  const { payload, completion } = await completeJson(
    provider,
    `You write ${count} flashcards from study material. Each card tests one idea, ` +
      "the front is a question, the back is a complete but short answer. " +
      'Reply as JSON: {"cards": [{"front","back","card_type":"basic"|"cloze","source_quote","chunk_index"}]}. ' +
      CITE_RULE,
    `Passages:\n${context.text}`,
  );
  const output = parse(flashcardsOutputSchema, payload);

  const deckId = deck_id ?? insertedId(
    await ctx.db.from("decks").insert({
      user_id: ctx.userId,
      subject_id: subject_id ?? null,
      name: deck_name ?? `${context.documents[0].title} — generated`,
      description: `Generated from ${context.documents.map((d) => d.title).join(", ")}.`,
    }).select("id").single(),
  );

  const cards = output.cards.slice(0, count);
  const { error } = await ctx.db.from("cards").insert(cards.map((card) => ({
    user_id: ctx.userId,
    deck_id: deckId,
    document_id: context.documents[0].id,
    chunk_id: chunkIdAt(context, card.chunk_index),
    card_type: card.card_type,
    front: card.front,
    back: card.back,
    source_quote: card.source_quote ?? null,
  })));
  insertError(error);

  return {
    resourceId: deckId,
    resource: "deck",
    created: cards.length,
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
    model: completion.model,
  };
};

const generateQuiz: Generator = async (ctx, provider, request, context) => {
  if (request.kind !== "quiz") throw new ApiError("internal_error", "wrong generator");
  const { count, difficulty, question_types, title, subject_id } = request.options;
  const { payload, completion } = await completeJson(
    provider,
    `You write a ${difficulty} quiz of ${count} questions of types: ${
      question_types.join(", ")
    }. ` +
      "MCQs need 4 options and the correct_answer must be one of them; true_false answers are " +
      '"true" or "false"; short_answer needs a reference answer. Every question needs an explanation. ' +
      'Reply as JSON: {"title","questions":[{"question_type","stem","options","correct_answer","explanation","chunk_index"}]}. ' +
      CITE_RULE,
    `Passages:\n${context.text}`,
  );
  const output = parse(quizOutputSchema, payload);

  const quizId = insertedId(
    await ctx.db.from("quizzes").insert({
      user_id: ctx.userId,
      subject_id: subject_id ?? null,
      document_id: context.documents[0].id,
      title: title ?? output.title ?? `${context.documents[0].title} — quiz`,
      difficulty,
      generated_by_model: completion.model,
    }).select("id").single(),
  );

  const questions = output.questions.slice(0, count);
  const { error } = await ctx.db.from("quiz_questions").insert(
    questions.map((question, index) => ({
      quiz_id: quizId,
      user_id: ctx.userId,
      position: index + 1,
      question_type: question.question_type,
      stem: question.stem,
      options: question.question_type === "mcq" ? question.options : null,
      correct_answer: question.correct_answer,
      explanation: question.explanation ?? null,
      chunk_id: chunkIdAt(context, question.chunk_index),
    })),
  );
  insertError(error);

  return {
    resourceId: quizId,
    resource: "quiz",
    created: questions.length,
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
    model: completion.model,
  };
};

const generatePlan: Generator = async (ctx, provider, request, context, now) => {
  if (request.kind !== "plan") throw new ApiError("internal_error", "wrong generator");
  const { goal, exam_date, daily_minutes, subject_id } = request.options;
  const today = now.toISOString().slice(0, 10);
  const { payload, completion } = await completeJson(
    provider,
    `You build a study plan from ${today} to ${exam_date}, at most ${daily_minutes} minutes per day. ` +
      "Interleave reading, review, quizzes and practice, and leave the last day for revision. " +
      'Reply as JSON: {"items":[{"scheduled_for":"YYYY-MM-DD","activity","title","estimated_minutes","document_index"}]}.',
    `Goal: ${goal}\nDocuments: ${
      context.documents.map((d, i) => `[${i}] ${d.title}`).join(", ")
    }\n\n` +
      `Passages:\n${context.text}`,
  );
  const output = parse(planOutputSchema, payload);

  const planId = insertedId(
    await ctx.db.from("study_plans").insert({
      user_id: ctx.userId,
      subject_id: subject_id ?? null,
      goal,
      exam_date,
      daily_minutes,
      generated_by_model: completion.model,
    }).select("id").single(),
  );

  // `position` is unique per (plan, day), so items are numbered within a day.
  const positions = new Map<string, number>();
  const { error } = await ctx.db.from("plan_items").insert(output.items.map((item) => {
    const position = (positions.get(item.scheduled_for) ?? 0) + 1;
    positions.set(item.scheduled_for, position);
    const document = context.documents[item.document_index ?? -1];
    return {
      plan_id: planId,
      user_id: ctx.userId,
      scheduled_for: item.scheduled_for,
      position,
      activity: item.activity,
      title: item.title,
      document_id: document?.id ?? null,
      estimated_minutes: item.estimated_minutes,
    };
  }));
  insertError(error);

  return {
    resourceId: planId,
    resource: "study_plan",
    created: output.items.length,
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
    model: completion.model,
  };
};

export const GENERATORS: Record<GenerateRequest["kind"], Generator> = {
  summary: generateSummary,
  flashcards: generateFlashcards,
  quiz: generateQuiz,
  plan: generatePlan,
};
