import Markdown from "react-markdown";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatRole } from "@/lib/types";

interface Props {
  role: ChatRole;
  content: string;
  streaming?: boolean;
  footer?: React.ReactNode;
}

export function MessageBubble({ role, content, streaming = false, footer }: Props) {
  const isUser = role === "user";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-slate-200 text-slate-600" : "bg-brand-100 text-brand-700",
        )}
        aria-hidden
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={cn("min-w-0 max-w-[85ch] flex-1", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5",
            isUser ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200",
          )}
        >
          {isUser
            ? <p className="whitespace-pre-wrap text-sm">{content}</p>
            : (
              <div className="prose-study">
                <Markdown>{content}</Markdown>
                {streaming && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand-500 align-middle" />
                )}
              </div>
            )}
        </div>
        {footer && <div className="mt-2 w-full">{footer}</div>}
      </div>
    </div>
  );
}
