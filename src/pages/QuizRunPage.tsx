import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { Page, PageHeader } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useQuiz, useStartAttempt, useSubmitAttempt } from "@/hooks/useStudy";
import { useAuth } from "@/providers/AuthProvider";
import type { GradeResult } from "@/lib/api";
import { cn } from "@/lib/utils";

export function QuizRunPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const { user } = useAuth();
  const quiz = useQuiz(quizId);
  const startAttempt = useStartAttempt();
  const submitAttempt = useSubmitAttempt();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GradeResult | null>(null);

  if (quiz.isLoading) return <LoadingBlock />;
  if (quiz.error || !quiz.data) {
    return <Page><ErrorNotice error={quiz.error ?? new Error("Quiz not found.")} /></Page>;
  }

  const { quiz: current, questions } = quiz.data;
  const answered = questions.filter((question) => (responses[question.id] ?? "").trim()).length;

  async function onStart() {
    if (!user || !quizId) return;
    const attempt = await startAttempt.mutateAsync({ userId: user.id, quizId });
    setAttemptId(attempt.id);
    setResponses({});
    setResult(null);
  }

  async function onSubmit() {
    if (!user || !attemptId) return;
    const graded = await submitAttempt.mutateAsync({
      userId: user.id,
      attemptId,
      responses: questions.map((question) => ({
        questionId: question.id,
        response: responses[question.id] ?? "",
      })),
    });
    setResult(graded);
  }

  const maxScore = questions.reduce((total, question) => total + question.points, 0);

  return (
    <Page>
      <Link to="/quizzes" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Quizzes
      </Link>

      <PageHeader
        title={current.title}
        description={`${questions.length} questions · ${maxScore} points`}
        action={result
          ? <Badge tone={result.score / Math.max(maxScore, 1) >= 0.5 ? "success" : "warning"}>
            Scored {result.score} / {maxScore}
          </Badge>
          : attemptId
          ? <Badge tone="info">{answered} of {questions.length} answered</Badge>
          : <Button onClick={onStart} loading={startAttempt.isPending}>Start attempt</Button>}
      />

      <ErrorNotice error={startAttempt.error ?? submitAttempt.error} />

      <div className="space-y-4">
        {questions.map((question, position) => {
          const graded = result?.per_question.find((entry) => entry.question_id === question.id);
          return (
            <Card key={question.id}>
              <CardHeader
                title={`${position + 1}. ${question.stem}`}
                action={graded
                  ? graded.is_correct
                    ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="Correct" />
                    : <XCircle className="h-5 w-5 text-rose-600" aria-label="Incorrect" />
                  : <Badge className="capitalize">{question.question_type.replace("_", " ")}</Badge>}
              />
              <CardBody className="space-y-3">
                {question.question_type === "short_answer"
                  ? (
                    <Textarea
                      rows={3}
                      disabled={!attemptId || Boolean(result)}
                      value={responses[question.id] ?? ""}
                      onChange={(event) =>
                        setResponses((current) => ({ ...current, [question.id]: event.target.value }))}
                      placeholder="Write your answer…"
                    />
                  )
                  : (
                    <div className="space-y-2">
                      {(question.options ?? ["True", "False"]).map((option) => (
                        <label
                          key={option}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors",
                            responses[question.id] === option
                              ? "border-brand-300 bg-brand-50"
                              : "border-slate-200 hover:bg-slate-50",
                            (!attemptId || result) && "cursor-not-allowed opacity-75",
                          )}
                        >
                          <input
                            type="radio"
                            name={question.id}
                            value={option}
                            disabled={!attemptId || Boolean(result)}
                            checked={responses[question.id] === option}
                            onChange={() => setResponses((current) => ({ ...current, [question.id]: option }))}
                            className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-600"
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  )}

                {graded && (
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                    <p className="font-medium">Score: {graded.score} / {question.points}</p>
                    {graded.feedback && <p className="mt-1">{graded.feedback}</p>}
                    {question.explanation && <p className="mt-1 text-slate-500">{question.explanation}</p>}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {result
          ? <Button variant="secondary" onClick={onStart} loading={startAttempt.isPending}>Try again</Button>
          : (
            <Button
              size="lg"
              disabled={!attemptId || answered === 0}
              loading={submitAttempt.isPending}
              onClick={onSubmit}
            >
              Submit for grading
            </Button>
          )}
      </div>
    </Page>
  );
}
