import type { AuthContext } from "../_shared/auth.ts";
import type { Deps } from "../_shared/deps.ts";
import { ApiError } from "../_shared/errors.ts";
import { CORS_HEADERS, jsonResponse, readJsonBody, withHttp } from "../_shared/http.ts";
import type { ChatMessage } from "../_shared/provider.ts";
import { assertNotRateLimited, assertWithinQuota, recordUsage } from "../_shared/quota.ts";
import { buildContext, extractCitations, type Hit, hybridSearch } from "../_shared/retrieval.ts";
import { chatRequestSchema, parse } from "../_shared/validation.ts";

const HISTORY_LIMIT = 10;

const SYSTEM_PROMPT = [
  "You are a study tutor. Answer only from the numbered context passages.",
  "Cite every claim with the passage number in square brackets, e.g. [1].",
  "If the passages do not contain the answer, say so plainly and suggest what to upload.",
  "Be concise and explain, do not just quote.",
].join(" ");

/**
 * Retrieval-augmented tutor turn. Streams tokens as SSE and persists the
 * assistant message plus its citations once the stream completes; pass
 * `stream: false` for a single JSON response.
 */
export function createChatHandler(deps: Deps) {
  return withHttp(async (req) => {
    const ctx = await deps.authenticate(req);
    assertNotRateLimited(`ai-chat:${ctx.userId}`, { limit: 30 });
    const body = parse(chatRequestSchema, await readJsonBody(req));
    await assertWithinQuota(ctx);

    // RLS keeps this to the caller's own threads.
    const { data: thread, error: threadError } = await ctx.db
      .from("chat_threads")
      .select("id, subject_id, scope")
      .eq("id", body.thread_id)
      .maybeSingle();
    if (threadError) throw new ApiError("internal_error", threadError.message);
    if (!thread) throw new ApiError("not_found", "Chat thread not found.");

    const threadScope = (thread.scope ?? {}) as { document_ids?: string[] };
    const provider = deps.provider();
    const { hits, embeddingTokens, embeddingModel } = await hybridSearch(
      ctx.db,
      provider,
      body.message,
      {
        documentIds: body.scope.document_ids ?? threadScope.document_ids,
        subjectId: body.scope.subject_id ?? thread.subject_id,
        limit: 8,
      },
    );

    // History is read before the new turn is stored, so the question is not
    // repeated to the model.
    const messages = await buildMessages(ctx, thread.id, body.message, hits);

    const { error: userMessageError } = await ctx.db.from("chat_messages").insert({
      thread_id: thread.id,
      user_id: ctx.userId,
      role: "user",
      content: body.message,
    });
    if (userMessageError) throw new ApiError("internal_error", userMessageError.message);

    const startedAt = deps.now().getTime();

    const finish = async (
      content: string,
      promptTokens: number,
      completionTokens: number,
      model: string,
    ) => {
      const messageId = await persistAnswer(ctx, {
        threadId: thread.id,
        content,
        model,
        promptTokens,
        completionTokens,
        latencyMs: deps.now().getTime() - startedAt,
        hits,
      });
      await recordUsage(ctx, {
        functionName: "ai-chat",
        model,
        promptTokens: promptTokens + embeddingTokens,
        completionTokens,
      });
      return { messageId, citations: extractCitations(content, hits) };
    };

    if (!body.stream) {
      const completion = await provider.complete(messages);
      const { messageId, citations } = await finish(
        completion.content,
        completion.promptTokens,
        completion.completionTokens,
        completion.model,
      );
      return jsonResponse({
        message_id: messageId,
        content: completion.content,
        citations,
        sources: hits.map(toSource),
      });
    }

    const { tokens, usage } = await provider.stream(messages);
    return new Response(
      toEventStream(tokens, usage, hits, finish, embeddingModel),
      {
        headers: {
          ...CORS_HEADERS,
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      },
    );
  });
}

function toSource(hit: Hit, index: number) {
  return {
    n: index + 1,
    chunk_id: hit.chunk_id,
    document_id: hit.document_id,
    page_from: hit.page_from,
    page_to: hit.page_to,
    heading: hit.heading,
  };
}

async function buildMessages(
  ctx: AuthContext,
  threadId: string,
  question: string,
  hits: Hit[],
): Promise<ChatMessage[]> {
  const { data: history } = await ctx.db
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const previous = ((history ?? []) as ChatMessage[])
    .filter((message) => message.role !== "system")
    .reverse();

  const context = hits.length > 0
    ? buildContext(hits)
    : "(no passages matched — say so instead of guessing)";

  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...previous,
    { role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` },
  ];
}

async function persistAnswer(
  ctx: AuthContext,
  answer: {
    threadId: string;
    content: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    hits: Hit[];
  },
): Promise<string> {
  const { data, error } = await ctx.db.from("chat_messages").insert({
    thread_id: answer.threadId,
    user_id: ctx.userId,
    role: "assistant",
    content: answer.content,
    model: answer.model,
    prompt_tokens: answer.promptTokens,
    completion_tokens: answer.completionTokens,
    latency_ms: answer.latencyMs,
  }).select("id").single();
  if (error) throw new ApiError("internal_error", error.message);

  const citations = extractCitations(answer.content, answer.hits);
  if (citations.length > 0) {
    await ctx.db.from("message_citations").insert(
      citations.map((citation) => ({
        message_id: data.id,
        user_id: ctx.userId,
        chunk_id: citation.chunkId,
        rank: citation.rank,
        snippet: citation.snippet,
      })),
    );
  }
  return data.id as string;
}

// `token` frames while generating, then one `done` frame carrying the ids the
// client needs; a mid-stream failure arrives as an `error` frame, since the
// status line has already been sent.
export function toEventStream(
  tokens: ReadableStream<string>,
  usage: Promise<
    { content: string; promptTokens: number; completionTokens: number; model: string }
  >,
  hits: Hit[],
  finish: (
    content: string,
    promptTokens: number,
    completionTokens: number,
    model: string,
  ) => Promise<{ messageId: string; citations: unknown[] }>,
  embeddingModel: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frame = (event: string, data: unknown) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(frame("sources", { sources: hits.map(toSource), embeddingModel }));
      const reader = tokens.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(frame("token", { delta: value }));
        }
        const completion = await usage;
        const { messageId, citations } = await finish(
          completion.content,
          completion.promptTokens,
          completion.completionTokens,
          completion.model,
        );
        controller.enqueue(frame("done", { message_id: messageId, citations }));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const code = cause instanceof ApiError ? cause.code : "internal_error";
        controller.enqueue(frame("error", { error: { code, message } }));
      } finally {
        controller.close();
      }
    },
  });
}
