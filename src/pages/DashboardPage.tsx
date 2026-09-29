import { Link } from "react-router-dom";
import { BookOpen, Flame, Layers, MessagesSquare, Sparkles, Target } from "lucide-react";
import { Page, PageHeader } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { StatCard } from "@/components/StatCard";
import { useDocuments } from "@/hooks/useDocuments";
import { useProfile, useUsageToday } from "@/hooks/useProfile";
import { useReviewStats, useTodayPlanItems, useTogglePlanItem } from "@/hooks/useStudy";
import { formatRelative } from "@/lib/utils";

export function DashboardPage() {
  const { data: profile } = useProfile();
  const documents = useDocuments();
  const usage = useUsageToday();
  const reviewStats = useReviewStats();
  const planItems = useTodayPlanItems();
  const togglePlanItem = useTogglePlanItem();

  const recentDocuments = (documents.data ?? []).slice(0, 5);
  const tokenCap = profile?.ai_daily_token_cap ?? 0;
  const tokensUsed = usage.data?.total_tokens ?? 0;
  const usedPercent = tokenCap > 0 ? Math.min(100, Math.round((tokensUsed / tokenCap) * 100)) : 0;

  return (
    <Page>
      <PageHeader
        title={`Hi${profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`}
        description="Everything due today, and what your material can still become."
        action={
          <>
            <Link to="/library">
              <Button variant="secondary" icon={<BookOpen className="h-4 w-4" />}>Library</Button>
            </Link>
            <Link to="/tutor">
              <Button icon={<MessagesSquare className="h-4 w-4" />}>Ask the tutor</Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Cards due"
          value={reviewStats.data?.dueNow ?? "—"}
          icon={<Layers className="h-5 w-5" />}
          to="/review"
        />
        <StatCard
          label="Reviewed today"
          value={reviewStats.data
            ? `${reviewStats.data.reviewedToday}/${profile?.daily_review_target ?? 0}`
            : "—"}
          icon={<Flame className="h-5 w-5" />}
        />
        <StatCard
          label="Retention"
          value={reviewStats.data?.retention === null || reviewStats.data === undefined
            ? "—"
            : `${reviewStats.data.retention}%`}
          icon={<Target className="h-5 w-5" />}
        />
        <StatCard
          label="AI tokens today"
          value={tokensUsed.toLocaleString()}
          hint={tokenCap ? `${usedPercent}% of cap` : undefined}
          icon={<Sparkles className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Today's plan"
            description={planItems.data?.length ? `${planItems.data.length} scheduled items` : undefined}
            action={<Link to="/plan" className="text-sm font-medium text-brand-600 hover:text-brand-700">View plan</Link>}
          />
          {planItems.isLoading
            ? <LoadingBlock />
            : planItems.data && planItems.data.length > 0
            ? (
              <ul className="divide-y divide-slate-100">
                {planItems.data.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 p-4 sm:px-5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                      checked={Boolean(item.completed_at)}
                      onChange={(event) =>
                        togglePlanItem.mutate({ id: item.id, completed: event.target.checked })}
                      aria-label={`Mark ${item.title} complete`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm font-medium ${
                          item.completed_at ? "text-slate-400 line-through" : "text-slate-900"
                        }`}
                      >
                        {item.title}
                      </p>
                      <p className="text-xs capitalize text-slate-500">
                        {item.activity} · {item.estimated_minutes} min
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )
            : (
              <EmptyState
                title="Nothing scheduled today"
                description="Generate a study plan from your material and it will show up here."
                action={
                  <Link to="/plan">
                    <Button variant="secondary" size="sm">Build a plan</Button>
                  </Link>
                }
              />
            )}
        </Card>

        <Card>
          <CardHeader
            title="Recent material"
            action={<Link to="/library" className="text-sm font-medium text-brand-600 hover:text-brand-700">Library</Link>}
          />
          {documents.isLoading
            ? <LoadingBlock />
            : documents.error
            ? <CardBody><ErrorNotice error={documents.error} /></CardBody>
            : recentDocuments.length > 0
            ? (
              <ul className="divide-y divide-slate-100">
                {recentDocuments.map((document) => (
                  <li key={document.id}>
                    <Link
                      to={`/library/${document.id}`}
                      className="flex items-center gap-3 p-4 hover:bg-slate-50 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{document.title}</p>
                        <p className="text-xs text-slate-500">{formatRelative(document.created_at)}</p>
                      </div>
                      <StatusBadge status={document.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )
            : (
              <EmptyState
                icon={<BookOpen className="h-8 w-8" />}
                title="No material yet"
                description="Upload lecture notes or a past paper to get started."
                action={
                  <Link to="/library">
                    <Button size="sm">Upload material</Button>
                  </Link>
                }
              />
            )}
        </Card>
      </div>
    </Page>
  );
}
