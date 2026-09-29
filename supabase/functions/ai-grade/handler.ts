import type { Deps } from "../_shared/deps.ts";
import { ApiError } from "../_shared/errors.ts";
import { jsonResponse, readJsonBody, withHttp } from "../_shared/http.ts";
import { type AiProvider, parseJsonContent } from "../_shared/provider.ts";
import { assertNotRateLimited, assertWithinQuota, recordUsage } from "../_shared/quota.ts";
import { gradeOutputSchema, gradeRequestSchema, parse } from "../_shared/validation.ts";

interface AnswerRow {
  id: string;
  question_id: string;
  response: string | null;
  quiz_questions: {
    question_type: "mcq" | "true_false" | "short_answer";
    stem: string;
    correct_answer: string;
    explanation: string | null;
  };
}

interface Graded {
  answerId: string;
  questionId: string;
  isCorrect: boolean;
  score: number;
  feedback: string | null;
}

/**
 * Grades a submitted attempt. Objective questions are compared directly — no
 * model call and no tokens spent — and only short answers go to the provider.
 */
export function createGradeHandler(deps: Deps) {
  return withHttp(async (req) => {
    const ctx = await deps.authenticate(req);
    assertNotRateLimited(`ai-grade:${ctx.userId}`, { limit: 30 });
    const body = parse(gradeRequestSchema, await readJsonBody(req));

    const { data: attempt, error: attemptError } = await ctx.db
      .from("quiz_attempts")
      .select("id, quiz_id, score, submitted_at, started_at")
      .eq("id", body.attempt_id)
      .maybeSingle();
    if (attemptError) throw new ApiError("internal_error", attemptError.message);
    if (!attempt) throw new ApiError("not_found", "Quiz attempt not found.");

    // The answer key is not readable by the student's own role, so the join
    // runs as the service role — against the attempt RLS just confirmed is
    // theirs.
    const { data, error } = await ctx.admin
      .from("quiz_answers")
      .select(
        "id, question_id, response, quiz_questions(question_type, stem, correct_answer, explanation)",
      )
      .eq("attempt_id", attempt.id);
    if (error) throw new ApiError("internal_error", error.message);

    const answers = (data ?? []) as unknown as AnswerRow[];
    if (answers.length === 0) {
      throw new ApiError("invalid_request", "This attempt has no answers to grade.");
    }

    const objective = answers.filter((answer) =>
      answer.quiz_questions.question_type !== "short_answer"
    );
    const subjective = answers.filter((answer) =>
      answer.quiz_questions.question_type === "short_answer"
    );

    const graded: Graded[] = objective.map(gradeObjective);
    let promptTokens = 0;
    let completionTokens = 0;
    let model: string | null = null;

    if (subjective.length > 0) {
      await assertWithinQuota(ctx);
      const result = await gradeShortAnswers(deps.provider(), subjective);
      graded.push(...result.graded);
      promptTokens = result.promptTokens;
      completionTokens = result.completionTokens;
      model = result.model;
      await recordUsage(ctx, {
        functionName: "ai-grade",
        model: result.model,
        promptTokens,
        completionTokens,
      });
    }

    for (const item of graded) {
      const { error: updateError } = await ctx.db.from("quiz_answers").update({
        is_correct: item.isCorrect,
        score: item.score,
        feedback: item.feedback,
        graded_by_model: item.feedback ? model : null,
      }).eq("id", item.answerId);
      if (updateError) throw new ApiError("internal_error", updateError.message);
    }

    const score = graded.reduce((sum, item) => sum + item.score, 0) / graded.length;
    const submittedAt = attempt.submitted_at ?? deps.now().toISOString();
    const durationSeconds = Math.max(
      0,
      Math.round(
        (new Date(submittedAt).getTime() - new Date(attempt.started_at).getTime()) / 1000,
      ),
    );
    const { error: attemptUpdateError } = await ctx.db.from("quiz_attempts").update({
      score: Number(score.toFixed(4)),
      submitted_at: submittedAt,
      duration_seconds: durationSeconds,
    }).eq("id", attempt.id);
    if (attemptUpdateError) throw new ApiError("internal_error", attemptUpdateError.message);

    return jsonResponse({
      attempt_id: attempt.id,
      score: Number(score.toFixed(4)),
      per_question: graded.map((item) => ({
        question_id: item.questionId,
        is_correct: item.isCorrect,
        score: item.score,
        feedback: item.feedback,
      })),
    });
  });
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
}

function gradeObjective(answer: AnswerRow): Graded {
  const isCorrect = normalise(answer.response ?? "") ===
    normalise(answer.quiz_questions.correct_answer);
  return {
    answerId: answer.id,
    questionId: answer.question_id,
    isCorrect,
    score: isCorrect ? 1 : 0,
    feedback: isCorrect ? null : answer.quiz_questions.explanation,
  };
}

async function gradeShortAnswers(
  provider: AiProvider,
  answers: AnswerRow[],
): Promise<{ graded: Graded[]; promptTokens: number; completionTokens: number; model: string }> {
  const rubric = answers.map((answer, index) =>
    `[${index}] Question: ${answer.quiz_questions.stem}\n` +
    `Reference answer: ${answer.quiz_questions.correct_answer}\n` +
    `Student answer: ${answer.response ?? "(blank)"}`
  ).join("\n\n");

  const completion = await provider.complete([
    {
      role: "system",
      content:
        "You mark short answers against a reference answer. Score 1 for equivalent meaning, " +
        "0.5 for partially correct, 0 for wrong or blank. Feedback is one or two sentences " +
        'addressed to the student. Reply as JSON: {"results":[{"question_index","score","feedback"}]} ' +
        "with one entry per question, in order.",
    },
    { role: "user", content: rubric },
  ], { json: true });

  const output = parse(gradeOutputSchema, parseJsonContent(completion.content));
  const byIndex = new Map(output.results.map((result) => [result.question_index, result]));

  return {
    graded: answers.map((answer, index) => {
      const result = byIndex.get(index);
      if (!result) {
        throw new ApiError("provider_unavailable", "The grader did not return every question.");
      }
      return {
        answerId: answer.id,
        questionId: answer.question_id,
        isCorrect: result.score >= 0.999,
        score: result.score,
        feedback: result.feedback,
      };
    }),
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
    model: completion.model,
  };
}
