import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

const CONTROL = cn(
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm",
  "ring-1 ring-inset ring-slate-300 placeholder:text-slate-400",
  "focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500",
);

interface LabelledProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
}

function Wrapper({ label, hint, error, id, children }: LabelledProps & { id: string; children: ReactNode }) {
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      {children}
      {error
        ? <p className="mt-1.5 text-sm text-rose-600">{error}</p>
        : hint
        ? <p className="mt-1.5 text-sm text-slate-500">{hint}</p>
        : null}
    </div>
  );
}

export function Input({ label, hint, error, className, ...props }: LabelledProps & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <Wrapper label={label} hint={hint} error={error} id={id}>
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL, error && "ring-rose-400", className)}
      />
    </Wrapper>
  );
}

export function Textarea(
  { label, hint, error, className, ...props }: LabelledProps & TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <Wrapper label={label} hint={hint} error={error} id={id}>
      <textarea {...props} id={id} className={cn(CONTROL, "resize-y", error && "ring-rose-400", className)} />
    </Wrapper>
  );
}

export function Select(
  { label, hint, error, className, children, ...props }: LabelledProps & SelectHTMLAttributes<HTMLSelectElement>,
) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <Wrapper label={label} hint={hint} error={error} id={id}>
      <select {...props} id={id} className={cn(CONTROL, "pr-8", className)}>
        {children}
      </select>
    </Wrapper>
  );
}
