import { useEffect, useState } from "react";
import { Page, PageHeader } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useProfile, useUpdateProfile, useUsageToday } from "@/hooks/useProfile";
import { useAuth } from "@/providers/AuthProvider";

export function SettingsPage() {
  const { signOut } = useAuth();
  const profile = useProfile();
  const usage = useUsageToday();
  const updateProfile = useUpdateProfile();

  const [fullName, setFullName] = useState("");
  const [reviewTarget, setReviewTarget] = useState(40);
  const [minutesTarget, setMinutesTarget] = useState(60);
  const [tokenCap, setTokenCap] = useState(200000);

  useEffect(() => {
    if (!profile.data) return;
    setFullName(profile.data.full_name);
    setReviewTarget(profile.data.daily_review_target);
    setMinutesTarget(profile.data.daily_study_minutes_target);
    setTokenCap(profile.data.ai_daily_token_cap);
  }, [profile.data]);

  if (profile.isLoading) return <LoadingBlock />;

  const used = usage.data?.total_tokens ?? 0;
  const percent = tokenCap > 0 ? Math.min(100, Math.round((used / tokenCap) * 100)) : 0;

  return (
    <Page>
      <PageHeader title="Settings" description="Your profile, study targets and AI budget." />

      <Card>
        <CardHeader title="Profile" />
        <CardBody className="space-y-4">
          <Input label="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          <Input label="Email" value={profile.data?.email ?? ""} disabled hint="Managed by your sign-in identity." />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Daily targets" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Cards to review"
            type="number"
            min={0}
            max={1000}
            value={reviewTarget}
            onChange={(event) => setReviewTarget(Number(event.target.value))}
          />
          <Input
            label="Study minutes"
            type="number"
            min={0}
            max={1440}
            value={minutesTarget}
            onChange={(event) => setMinutesTarget(Number(event.target.value))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="AI budget" description="Generation stops once the daily cap is reached." />
        <CardBody className="space-y-4">
          <div>
            <div className="mb-1 flex justify-between text-sm text-slate-600">
              <span>{used.toLocaleString()} tokens used today</span>
              <span>{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <Input
            label="Daily token cap"
            type="number"
            min={0}
            step={10000}
            value={tokenCap}
            onChange={(event) => setTokenCap(Number(event.target.value))}
          />
        </CardBody>
      </Card>

      <ErrorNotice error={updateProfile.error} />

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        <Button
          loading={updateProfile.isPending}
          onClick={() =>
            updateProfile.mutate({
              id: profile.data?.id,
              full_name: fullName,
              daily_review_target: reviewTarget,
              daily_study_minutes_target: minutesTarget,
              ai_daily_token_cap: tokenCap,
            })}
        >
          Save changes
        </Button>
      </div>
    </Page>
  );
}
