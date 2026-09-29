import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-slate-400", className)} aria-label="Loading" />;
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500">
      <Spinner />
      {label}
    </div>
  );
}

/** Renders the API's error envelope: the code drives the wording, not a status. */
export function ErrorNotice({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message = error instanceof ApiError
    ? error.friendlyMessage
    : error instanceof Error
    ? error.message
    : "Something went wrong.";
  const details = error instanceof ApiError ? error.details : undefined;

  return (
    <div
      role="alert"
      className={cn("rounded-lg bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-200", className)}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p>{message}</p>
          {details && details.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-rose-600">
              {details.map((detail) => <li key={detail.path}>{detail.path}: {detail.message}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <div>
        <p className="font-medium text-slate-900">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
