import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChatScope, type ChatSource, streamChat } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, ChatThread } from "@/lib/types";

export function useThreads() {
  return useQuery({
    queryKey: ["threads"],
    queryFn: async (): Promise<ChatThread[]> => {
      const { data, error } = await supabase
        .from("chat_threads")
        .select("id, subject_id, title, scope, last_message_at")
        .order("last_message_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ChatThread[];
    },
  });
}

export function useMessages(threadId: string | undefined) {
  return useQuery({
    enabled: Boolean(threadId),
    queryKey: ["messages", threadId],
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, thread_id, role, content, created_at")
        .eq("thread_id", threadId!)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as ChatMessage[];
    },
  });
}

export function useCreateThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; title?: string; subjectId?: string | null; scope?: ChatScope }) => {
      const { data, error } = await supabase
        .from("chat_threads")
        .insert({
          user_id: input.userId,
          title: input.title?.trim() || "New chat",
          subject_id: input.subjectId ?? null,
          scope: input.scope ?? {},
        })
        .select("id, subject_id, title, scope, last_message_at")
        .single();
      if (error) throw new Error(error.message);
      return data as ChatThread;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      const { error } = await supabase.from("chat_threads").delete().eq("id", threadId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["threads"] }),
  });
}

export interface StreamingAnswer {
  content: string;
  sources: ChatSource[];
}

/**
 * Drives one streamed turn. The answer is held in local state while it streams
 * and the message list is refetched on `done`, so the rendered transcript is
 * always what the server actually persisted.
 */
export function useChatStream(threadId: string | undefined) {
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState<StreamingAnswer | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (message: string, scope?: ChatScope) => {
    if (!threadId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPending(true);
    setError(null);
    setAnswer({ content: "", sources: [] });

    // Show the question immediately; the server persists it as the turn starts.
    queryClient.setQueryData<ChatMessage[]>(["messages", threadId], (previous) => [
      ...(previous ?? []),
      {
        id: `optimistic-${crypto.randomUUID()}`,
        thread_id: threadId,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      await streamChat({ thread_id: threadId, message, scope }, {
        signal: controller.signal,
        onSources: (sources) => setAnswer((current) => ({ content: current?.content ?? "", sources })),
        onToken: (delta) =>
          setAnswer((current) => ({ content: (current?.content ?? "") + delta, sources: current?.sources ?? [] })),
        onDone: () => {
          setAnswer(null);
          queryClient.invalidateQueries({ queryKey: ["messages", threadId] });
          queryClient.invalidateQueries({ queryKey: ["threads"] });
          queryClient.invalidateQueries({ queryKey: ["usage-today"] });
        },
      });
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause);
      setAnswer(null);
      queryClient.invalidateQueries({ queryKey: ["messages", threadId] });
    } finally {
      setPending(false);
    }
  }, [threadId, queryClient]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { answer, error, pending, send, stop };
}

export function useCitations(messageIds: string[]) {
  return useQuery({
    enabled: messageIds.length > 0,
    queryKey: ["citations", messageIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_citations")
        .select("message_id, chunk_id, rank, snippet")
        .in("message_id", messageIds)
        .order("rank");
      if (error) throw new Error(error.message);
      return (data ?? []) as { message_id: string; chunk_id: string; rank: number; snippet: string | null }[];
    },
  });
}
