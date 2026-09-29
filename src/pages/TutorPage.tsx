import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MessagesSquare, Plus, SendHorizonal, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { MessageBubble } from "@/components/tutor/MessageBubble";
import { SourceList } from "@/components/tutor/SourceList";
import {
  useChatStream,
  useCitations,
  useCreateThread,
  useDeleteThread,
  useMessages,
  useThreads,
} from "@/hooks/useChat";
import { useDocuments } from "@/hooks/useDocuments";
import { useSubjects } from "@/hooks/useSubjects";
import { useAuth } from "@/providers/AuthProvider";
import { cn, formatRelative } from "@/lib/utils";

export function TutorPage() {
  const { user } = useAuth();
  const threads = useThreads();
  const subjects = useSubjects();
  const documents = useDocuments();
  const createThread = useCreateThread();
  const deleteThread = useDeleteThread();

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [scopeSubjectId, setScopeSubjectId] = useState("");
  const [draft, setDraft] = useState("");
  const [threadListOpen, setThreadListOpen] = useState(false);

  const messages = useMessages(activeThreadId ?? undefined);
  const stream = useChatStream();
  const bottomRef = useRef<HTMLDivElement>(null);

  // A stream belongs to the chat it was started in; another chat must not show
  // its answer or be blocked by it.
  const streamingAnswer = stream.answer?.threadId === activeThreadId ? stream.answer : null;
  const streaming = activeThreadId !== null && stream.pendingThreadId === activeThreadId;

  const assistantMessageIds = useMemo(
    () =>
      (messages.data ?? [])
        .filter((message) => message.role === "assistant")
        .map((message) => message.id),
    [messages.data],
  );
  const citations = useCitations(assistantMessageIds);

  useEffect(() => {
    if (!activeThreadId && threads.data && threads.data.length > 0) setActiveThreadId(threads.data[0].id);
  }, [threads.data, activeThreadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data, streamingAnswer]);

  async function onNewThread() {
    if (!user) return;
    const thread = await createThread.mutateAsync({
      userId: user.id,
      subjectId: scopeSubjectId || null,
      scope: scopeSubjectId ? { subject_id: scopeSubjectId } : {},
    });
    setActiveThreadId(thread.id);
    setThreadListOpen(false);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || streaming) return;

    let threadId = activeThreadId;
    if (!threadId && user) {
      const thread = await createThread.mutateAsync({
        userId: user.id,
        title: message.slice(0, 60),
        subjectId: scopeSubjectId || null,
        scope: scopeSubjectId ? { subject_id: scopeSubjectId } : {},
      });
      threadId = thread.id;
      setActiveThreadId(thread.id);
    }
    if (!threadId) return;

    setDraft("");
    await stream.send(threadId, message, scopeSubjectId ? { subject_id: scopeSubjectId } : undefined);
  }

  const threadList = (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 p-3">
        <Button className="w-full" size="sm" icon={<Plus className="h-4 w-4" />} onClick={onNewThread}>
          New chat
        </Button>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {(threads.data ?? []).map((thread) => (
          <li key={thread.id} className="group relative">
            <button
              type="button"
              onClick={() => {
                setActiveThreadId(thread.id);
                setThreadListOpen(false);
              }}
              className={cn(
                "w-full rounded-lg px-3 py-2 pr-9 text-left transition-colors",
                thread.id === activeThreadId ? "bg-brand-50 text-brand-800" : "hover:bg-slate-100",
              )}
            >
              <span className="block truncate text-sm font-medium">{thread.title}</span>
              <span className="block text-xs text-slate-500">{formatRelative(thread.last_message_at)}</span>
            </button>
            <button
              type="button"
              aria-label={`Delete ${thread.title}`}
              onClick={() => {
                deleteThread.mutate(thread.id);
                if (thread.id === activeThreadId) setActiveThreadId(null);
              }}
              className="absolute right-2 top-2.5 rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-700 focus:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white lg:block">{threadList}</aside>

      {threadListOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setThreadListOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">{threadList}</div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <Button
            variant="secondary"
            size="sm"
            className="lg:hidden"
            onClick={() => setThreadListOpen(true)}
          >
            Chats
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">
              {threads.data?.find((thread) => thread.id === activeThreadId)?.title ?? "New chat"}
            </p>
            <p className="text-xs text-slate-500">Answers are grounded in your material and cited.</p>
          </div>
          <Select
            className="w-44"
            value={scopeSubjectId}
            onChange={(event) => setScopeSubjectId(event.target.value)}
            aria-label="Limit retrieval to a subject"
          >
            <option value="">All material</option>
            {(subjects.data ?? []).map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </Select>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {messages.isLoading && activeThreadId
            ? <LoadingBlock />
            : (messages.data?.length ?? 0) === 0 && !streamingAnswer
            ? (
              <EmptyState
                icon={<MessagesSquare className="h-8 w-8" />}
                title="Ask anything about your material"
                description="The tutor retrieves the relevant passages first, then answers with citations back to them."
              />
            )
            : (messages.data ?? []).map((message) => (
              <MessageBubble
                key={message.id}
                role={message.role}
                content={message.content}
                footer={
                  citations.data?.[message.id]
                    ? <SourceList sources={citations.data[message.id]} documents={documents.data ?? []} />
                    : undefined
                }
              />
            ))}

          {streamingAnswer && (
            <MessageBubble
              role="assistant"
              content={streamingAnswer.content || "…"}
              streaming
              footer={<SourceList sources={streamingAnswer.sources} documents={documents.data ?? []} />}
            />
          )}

          <ErrorNotice error={stream.error ?? createThread.error} />
          <div ref={bottomRef} />
        </div>

        <form onSubmit={onSubmit} className="border-t border-slate-200 bg-white p-3 sm:p-4">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void onSubmit(event);
                }
              }}
              rows={1}
              placeholder="Ask about your notes…"
              className="max-h-40 min-h-[2.75rem] flex-1 resize-y rounded-lg border-0 px-3 py-2.5 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600"
            />
            {streaming
              ? (
                <Button type="button" variant="secondary" icon={<Square className="h-4 w-4" />} onClick={stream.stop}>
                  Stop
                </Button>
              )
              : (
                <Button type="submit" icon={<SendHorizonal className="h-4 w-4" />} disabled={!draft.trim()}>
                  <span className="hidden sm:inline">Send</span>
                </Button>
              )}
          </div>
        </form>
      </section>
    </div>
  );
}
