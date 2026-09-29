import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DocumentStatus } from "@/lib/types";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-brand-50 text-brand-700 ring-brand-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const DOCUMENT_TONES: Record<DocumentStatus, Tone> = {
  pending: "neutral",
  processing: "info",
  ready: "success",
  failed: "danger",
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <Badge tone={DOCUMENT_TONES[status]}>
      {status === "processing" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      )}
      {status}
    </Badge>
  );
}
