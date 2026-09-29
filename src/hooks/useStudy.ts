import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { grade } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { type Rating, schedule, type ScheduleState } from "@/lib/scheduling";
import type { Deck, DueCard, PlanItem, Quiz, QuizAnswer, QuizAttempt, QuizQuestion, StudyPlan } from "@/lib/types";

// --- decks and review -----------------------------------------------------

export function useDecks() {
  return useQuery({
    queryKey: ["decks"],
    queryFn: async (): Promise<Deck[]> => {
      const { data, error } = await supabase
        .from("decks")
        .select("id, subject_id, name, description, created_at")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Deck[];
    },
  });
}

export function useDueCards(deckId?: string | null) {
  return useQuery({
    queryKey: ["due-cards", deckId ?? "all"],
    queryFn: async (): Promise<DueCard[]> => {
      let query = supabase
        .from("due_cards")
        .select("card_id, deck_id, deck_name, front, back, card_type, state, due_at, reps, lapses")
        .order("due_at");
      if (deckId) query = query.eq("deck_id", deckId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as DueCard[];
    },
  });
}

export function useCardSchedule(cardId: string | undefined) {
  return useQuery({
    enabled: Boolean(cardId),
    queryKey: ["card-schedule", cardId],
    queryFn: async (): Promise<ScheduleState> => {
      const { data, error } = await supabase
        .from("card_schedule")
        .select("state, stability, difficulty, reps, lapses")
        .eq("card_id", cardId!)
        .single();
      if (error) throw new Error(error.message);
      return data as ScheduleState;
    },
  });
}

/** Writes the review log and the next due date in one transaction. */
export function useReviewCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      cardId: string;
      current: ScheduleState;
      rating: Rating;
      elapsedMs: number;
    }) => {
      const next = schedule(input.current, input.rating);

      const { error } = await supabase.rpc("review_card", {
        p_card_id: input.cardId,
        p_rating: input.rating,
        p_state: next.state,
        p_stability: next.stability,
        p_difficulty: next.difficulty,
        p_reps: next.reps,
        p_lapses: next.lapses,
        p_due_at: next.dueAt.toISOString(),
        p_elapsed_ms: Math.min(input.elapsedMs, 600_000),
      });
      if (error) throw new Error(error.message);

      return next;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["due-cards"] });
      queryClient.invalidateQueries({ queryKey: ["review-stats"] });
    },
  });
}

export function useReviewStats() {
  return useQuery({
    queryKey: ["review-stats"],
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const [reviewed, due] = await Promise.all([
        supabase
          .from("review_logs")
          .select("rating", { count: "exact" })
          .gte("reviewed_at", since.toISOString()),
        supabase.from("due_cards").select("card_id", { count: "exact", head: true }),
      ]);
      if (reviewed.error) throw new Error(reviewed.error.message);
      if (due.error) throw new Error(due.error.message);
      const ratings = (reviewed.data ?? []) as { rating: number }[];
      const correct = ratings.filter((row) => row.rating >= 3).length;
      return {
        reviewedToday: reviewed.count ?? 0,
        dueNow: due.count ?? 0,
        retention: ratings.length ? Math.round((correct / ratings.length) * 100) : null,
      };
    },
  });
}

// --- quizzes --------------------------------------------------------------

export function useQuizzes() {
  return useQuery({
    queryKey: ["quizzes"],
    queryFn: async (): Promise<Quiz[]> => {
      const { data, error } = await supabase
        .from("quizzes")
        .select("id, subject_id, document_id, title, difficulty, created_at")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Quiz[];
    },
  });
}

export function useQuiz(quizId: string | undefined) {
  return useQuery({
    enabled: Boolean(quizId),
    queryKey: ["quiz", quizId],
    queryFn: async (): Promise<{ quiz: Quiz; questions: QuizQuestion[] }> => {
      const [quiz, questions] = await Promise.all([
        supabase
          .from("quizzes")
          .select("id, subject_id, document_id, title, difficulty, created_at")
          .eq("id", quizId!)
          .single(),
        supabase
          .from("quiz_questions")
          // `correct_answer` is deliberately not selected: grading happens
          // server-side so the answer key never reaches the browser.
          .select("id, quiz_id, position, question_type, stem, options, explanation, points")
          .eq("quiz_id", quizId!)
          .order("position"),
      ]);
      if (quiz.error) throw new Error(quiz.error.message);
      if (questions.error) throw new Error(questions.error.message);
      return { quiz: quiz.data as Quiz, questions: (questions.data ?? []) as QuizQuestion[] };
    },
  });
}

export function useStartAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; quizId: string }): Promise<QuizAttempt> => {
      const { data, error } = await supabase
        .from("quiz_attempts")
        .insert({ user_id: input.userId, quiz_id: input.quizId })
        .select("id, quiz_id, started_at, submitted_at, score, max_score")
        .single();
      if (error) throw new Error(error.message);
      return data as QuizAttempt;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attempts"] }),
  });
}

/** Saves every response, then lets `ai-grade` score the attempt. */
export function useSubmitAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      attemptId: string;
      responses: { questionId: string; response: string }[];
    }) => {
      const { error } = await supabase.from("quiz_answers").upsert(
        input.responses.map((entry) => ({
          attempt_id: input.attemptId,
          question_id: entry.questionId,
          user_id: input.userId,
          response: entry.response,
        })),
        { onConflict: "attempt_id,question_id" },
      );
      if (error) throw new Error(error.message);
      return grade(input.attemptId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attempts"] });
      queryClient.invalidateQueries({ queryKey: ["usage-today"] });
    },
  });
}

export function useAttempts(quizId: string | undefined) {
  return useQuery({
    enabled: Boolean(quizId),
    queryKey: ["attempts", quizId],
    queryFn: async (): Promise<QuizAttempt[]> => {
      const { data, error } = await supabase
        .from("quiz_attempts")
        .select("id, quiz_id, started_at, submitted_at, score, max_score")
        .eq("quiz_id", quizId!)
        .order("started_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as QuizAttempt[];
    },
  });
}

export function useAttemptAnswers(attemptId: string | undefined) {
  return useQuery({
    enabled: Boolean(attemptId),
    queryKey: ["attempt-answers", attemptId],
    queryFn: async (): Promise<QuizAnswer[]> => {
      const { data, error } = await supabase
        .from("quiz_answers")
        .select("id, attempt_id, question_id, response, is_correct, score, feedback")
        .eq("attempt_id", attemptId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as QuizAnswer[];
    },
  });
}

// --- plans ----------------------------------------------------------------

export function usePlans() {
  return useQuery({
    queryKey: ["plans"],
    queryFn: async (): Promise<StudyPlan[]> => {
      const { data, error } = await supabase
        .from("study_plans")
        .select("id, subject_id, goal, exam_date, daily_minutes, created_at")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as StudyPlan[];
    },
  });
}

export function usePlanItems(planId: string | undefined) {
  return useQuery({
    enabled: Boolean(planId),
    queryKey: ["plan-items", planId],
    queryFn: async (): Promise<PlanItem[]> => {
      const { data, error } = await supabase
        .from("plan_items")
        .select(
          "id, plan_id, scheduled_for, position, activity, title, document_id, deck_id, estimated_minutes, completed_at",
        )
        .eq("plan_id", planId!)
        .order("scheduled_for")
        .order("position");
      if (error) throw new Error(error.message);
      return (data ?? []) as PlanItem[];
    },
  });
}

export function useTogglePlanItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; completed: boolean }) => {
      const { error } = await supabase
        .from("plan_items")
        .update({ completed_at: input.completed ? new Date().toISOString() : null })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plan-items"] });
      queryClient.invalidateQueries({ queryKey: ["today-plan"] });
    },
  });
}

export function useTodayPlanItems() {
  return useQuery({
    queryKey: ["today-plan"],
    queryFn: async (): Promise<PlanItem[]> => {
      const { data, error } = await supabase
        .from("plan_items")
        .select(
          "id, plan_id, scheduled_for, position, activity, title, document_id, deck_id, estimated_minutes, completed_at",
        )
        .eq("scheduled_for", new Date().toISOString().slice(0, 10))
        .order("position");
      if (error) throw new Error(error.message);
      return (data ?? []) as PlanItem[];
    },
  });
}
