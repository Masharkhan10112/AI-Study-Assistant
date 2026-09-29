import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Sparkles } from "lucide-react";
import { Page, PageHeader } from "@/components/layout/AppShell";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { usePlanItems, usePlans, useTogglePlanItem } from "@/hooks/useStudy";
import { useGenerate } from "@/hooks/useGenerate";
import { useDocuments } from "@/hooks/useDocuments";
import { useSubjects } from "@/hooks/useSubjects";
import { addDays, formatDate, today } from "@/lib/utils";
import type { PlanItem } from "@/lib/types";

const ACTIVITY_TONES = {
  read: "info",
  review: "success",
  quiz: "warning",
  practice: "neutral",
} as const;

export function PlanPage() {
  const plans = usePlans();
  const [planId, setPlanId] = useState<string | null>(null);
  const items = usePlanItems(planId ?? undefined);
  const toggleItem = useTogglePlanItem();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!planId && plans.data && plans.data.length > 0) setPlanId(plans.data[0].id);
  }, [plans.data, planId]);

  const byDate = useMemo(() => {
    const groups = new Map<string, PlanItem[]>();
    for (const item of items.data ?? []) {
      const bucket = groups.get(item.scheduled_for) ?? [];
      bucket.push(item);
      groups.set(item.scheduled_for, bucket);
    }
    return [...groups.entries()];
  }, [items.data]);

  const activePlan = plans.data?.find((plan) => plan.id === planId);

  return (
    <Page>
      <PageHeader
        title="Study plan"
        description="A dated schedule built from your material and your exam date."
        action={
          <>
            {(plans.data?.length ?? 0) > 1 && (
              <Select
                className="w-56"
                value={planId ?? ""}
                onChange={(event) => setPlanId(event.target.value)}
                aria-label="Plan"
              >
                {(plans.data ?? []).map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.goal}</option>
                ))}
              </Select>
            )}
            <Button icon={<Sparkles className="h-4 w-4" />} onClick={() => setDialogOpen(true)}>
              New plan
            </Button>
          </>
        }
      />

      <ErrorNotice error={plans.error ?? items.error} />

      {activePlan && (
        <div className="flex flex-wrap gap-2">
          <Badge tone="info">Exam {formatDate(activePlan.exam_date)}</Badge>
          <Badge>{activePlan.daily_minutes} min/day</Badge>
        </div>
      )}

      {plans.isLoading
        ? <LoadingBlock />
        : (plans.data?.length ?? 0) === 0
        ? (
          <Card>
            <EmptyState
              icon={<CalendarCheck className="h-8 w-8" />}
              title="No plan yet"
              description="Pick your ready documents and an exam date, and the assistant schedules the work."
              action={<Button size="sm" onClick={() => setDialogOpen(true)}>Build a plan</Button>}
            />
          </Card>
        )
        : items.isLoading
        ? <LoadingBlock />
        : (
          <div className="space-y-4">
            {byDate.map(([date, dayItems]) => (
              <Card key={date}>
                <CardHeader
                  title={formatDate(date)}
                  description={`${dayItems.reduce((total, item) => total + item.estimated_minutes, 0)} minutes`}
                  action={date === today() ? <Badge tone="info">Today</Badge> : undefined}
                />
                <ul className="divide-y divide-slate-100">
                  {dayItems.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 p-4 sm:px-5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                        checked={Boolean(item.completed_at)}
                        onChange={(event) => toggleItem.mutate({ id: item.id, completed: event.target.checked })}
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
                        <p className="text-xs text-slate-500">{item.estimated_minutes} min</p>
                      </div>
                      <Badge tone={ACTIVITY_TONES[item.activity]} className="capitalize">{item.activity}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}

      <NewPlanDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreated={setPlanId} />
    </Page>
  );
}

function NewPlanDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  onCreated(planId: string): void;
}) {
  const documents = useDocuments();
  const subjects = useSubjects();
  const generatePlan = useGenerate();
  const [goal, setGoal] = useState("");
  const [examDate, setExamDate] = useState(addDays(today(), 14));
  const [dailyMinutes, setDailyMinutes] = useState(60);
  const [subjectId, setSubjectId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const ready = (documents.data ?? []).filter((document) =>
    document.status === "ready" && (!subjectId || document.subject_id === subjectId)
  );

  async function onSubmit() {
    const result = await generatePlan.mutateAsync({
      kind: "plan",
      document_ids: selected,
      options: {
        goal: goal.trim(),
        exam_date: examDate,
        daily_minutes: dailyMinutes,
        subject_id: subjectId || null,
      },
    });
    onCreated(result.resource_id);
    setSelected([]);
    setGoal("");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Build a study plan"
      description="The schedule is generated from the documents you pick."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={generatePlan.isPending}
            disabled={!goal.trim() || selected.length === 0}
            onClick={onSubmit}
          >
            Generate plan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Pass the algorithms final"
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Exam date"
            type="date"
            min={today()}
            value={examDate}
            onChange={(event) => setExamDate(event.target.value)}
          />
          <Input
            label="Minutes per day"
            type="number"
            min={15}
            max={480}
            value={dailyMinutes}
            onChange={(event) => setDailyMinutes(Number(event.target.value))}
          />
        </div>
        <Select label="Subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
          <option value="">All subjects</option>
          {(subjects.data ?? []).map((subject) => (
            <option key={subject.id} value={subject.id}>{subject.name}</option>
          ))}
        </Select>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Documents</span>
          {ready.length === 0
            ? <p className="text-sm text-slate-500">No ready documents — ingest some material first.</p>
            : (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {ready.map((document) => (
                  <li key={document.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                        checked={selected.includes(document.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, document.id]
                              : current.filter((id) => id !== document.id)
                          )}
                      />
                      <span className="truncate">{document.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <ErrorNotice error={generatePlan.error} />
      </div>
    </Modal>
  );
}
