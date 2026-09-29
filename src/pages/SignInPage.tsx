import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";

type Mode = "sign-in" | "sign-up";

export function SignInPage() {
  const { session, loading, signIn, signUp } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <LoadingBlock label="Checking your session…" />;
  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (mode === "sign-in") {
        await signIn(email, password);
      } else {
        const { needsConfirmation } = await signUp(email, password, fullName);
        if (needsConfirmation) {
          setNotice("Check your inbox to confirm the address, then sign in.");
          setMode("sign-in");
        }
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <GraduationCap className="h-10 w-10 text-brand-600" aria-hidden />
          <h1 className="text-2xl font-semibold text-slate-900">AI Study Assistant</h1>
          <p className="text-sm text-slate-500">
            Your notes, turned into answers, flashcards, quizzes and a plan.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            {(["sign-in", "sign-up"] as Mode[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {value === "sign-in" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {mode === "sign-up" && (
            <Input
              label="Full name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              required
            />
          )}

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            minLength={8}
            hint={mode === "sign-up" ? "At least 8 characters." : undefined}
            required
          />

          {notice && (
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
              {notice}
            </p>
          )}
          <ErrorNotice error={error} />

          <Button type="submit" className="w-full" loading={submitting} size="lg">
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </div>
    </div>
  );
}
