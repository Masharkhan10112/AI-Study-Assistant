import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { Page, PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useQuizzes } from "@/hooks/useStudy";
import { formatRelative } from "@/lib/utils";

export function QuizzesPage() {
  const quizzes = useQuizzes();

  return (
    <Page>
      <PageHeader
        title="Quizzes"
        description="Generated from your documents and graded against them."
      />

      <ErrorNotice error={quizzes.error} />

      <Card>
        {quizzes.isLoading
          ? <LoadingBlock />
          : (quizzes.data?.length ?? 0) === 0
          ? (
            <EmptyState
              icon={<ListChecks className="h-8 w-8" />}
              title="No quizzes yet"
              description="Open a ready document and generate a quiz from it."
              action={<Link to="/library"><Button size="sm">Go to library</Button></Link>}
            />
          )
          : (
            <ul className="divide-y divide-slate-100">
              {(quizzes.data ?? []).map((quiz) => (
                <li key={quiz.id}>
                  <Link
                    to={`/quizzes/${quiz.id}`}
                    className="flex items-center gap-3 p-4 hover:bg-slate-50 sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{quiz.title}</p>
                      <p className="text-xs text-slate-500">{formatRelative(quiz.created_at)}</p>
                    </div>
                    <Badge tone="info" className="capitalize">{quiz.difficulty}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </Card>
    </Page>
  );
}
