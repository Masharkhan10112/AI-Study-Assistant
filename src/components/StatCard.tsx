import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  to?: string;
}

export function StatCard({ label, value, hint, icon, to }: Props) {
  const content = (
    <div
      className={cn(
        "flex h-full items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
        to && "transition-colors hover:border-brand-200 hover:bg-brand-50/40",
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {icon && <span className="shrink-0 rounded-lg bg-brand-50 p-2 text-brand-600">{icon}</span>}
    </div>
  );

  return to ? <Link to={to}>{content}</Link> : content;
}
