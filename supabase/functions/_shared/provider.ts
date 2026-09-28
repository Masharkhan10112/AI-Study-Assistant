import { ApiError } from "./errors.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface EmbeddingResult {
  embeddings: number[][];
  promptTokens: number;
  model: string;
}

export interface AiProvider {
  chatModel: string;
  embeddingModel: string;
  complete(
    messages: ChatMessage[],
    options?: { json?: boolean; maxTokens?: number },
  ): Promise<CompletionResult>;
  stream(
    messages: ChatMessage[],
  ): Promise<{ tokens: ReadableStream<string>; usage: Promise<CompletionResult> }>;
  embed(inputs: string[]): Promise<EmbeddingResult>;
}

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  fetchImpl?: typeof fetch;
}

export function providerConfigFromEnv(): ProviderConfig {
  const apiKey = Deno.env.get("AI_API_KEY");
  if (!apiKey) throw new ApiError("internal_error", "AI_API_KEY is not configured.");
  return {
    baseUrl: Deno.env.get("AI_BASE_URL") ?? "https://api.openai.com/v1",
    apiKey,
    chatModel: Deno.env.get("AI_CHAT_MODEL") ?? "gpt-4o-mini",
    embeddingModel: Deno.env.get("AI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
  };
}

// Any OpenAI-compatible provider (OpenAI, Groq, OpenRouter, Together) works —
// only AI_BASE_URL and the model names change.
export function openAiCompatibleProvider(config: ProviderConfig): AiProvider {
  const doFetch = config.fetchImpl ?? fetch;

  async function call(path: string, body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new ApiError(
        "provider_unavailable",
        `The AI provider could not be reached: ${cause instanceof Error ? cause.message : cause}`,
      );
    }
    if (response.status === 429) {
      throw new ApiError("rate_limited", "The AI provider is rate limiting this request.");
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new ApiError(
        "provider_unavailable",
        `The AI provider returned ${response.status}.`,
        detail || undefined,
      );
    }
    return response;
  }

  return {
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,

    async complete(messages, options = {}) {
      const response = await call("/chat/completions", {
        model: config.chatModel,
        messages,
        temperature: 0.2,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      });
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new ApiError("provider_unavailable", "The AI provider returned an empty completion.");
      }
      return {
        content,
        promptTokens: payload?.usage?.prompt_tokens ?? 0,
        completionTokens: payload?.usage?.completion_tokens ?? 0,
        model: payload?.model ?? config.chatModel,
      };
    },

    async stream(messages) {
      const response = await call("/chat/completions", {
        model: config.chatModel,
        messages,
        temperature: 0.2,
        stream: true,
        stream_options: { include_usage: true },
      });
      if (!response.body) {
        throw new ApiError("provider_unavailable", "The AI provider returned no stream.");
      }
      return readSseCompletion(response.body, config.chatModel);
    },

    async embed(inputs) {
      const response = await call("/embeddings", { model: config.embeddingModel, input: inputs });
      const payload = await response.json();
      const rows = payload?.data;
      if (!Array.isArray(rows) || rows.length !== inputs.length) {
        throw new ApiError(
          "provider_unavailable",
          "The AI provider returned unexpected embeddings.",
        );
      }
      return {
        embeddings: rows.map((row: { embedding: number[] }) => row.embedding),
        promptTokens: payload?.usage?.prompt_tokens ?? 0,
        model: payload?.model ?? config.embeddingModel,
      };
    },
  };
}

// Turns the provider's SSE frames into a plain token stream plus a promise that
// resolves with the full text and usage once the stream is done.
export function readSseCompletion(
  body: ReadableStream<Uint8Array>,
  fallbackModel: string,
): { tokens: ReadableStream<string>; usage: Promise<CompletionResult> } {
  let resolveUsage: (value: CompletionResult) => void;
  let rejectUsage: (reason: unknown) => void;
  const usage = new Promise<CompletionResult>((resolve, reject) => {
    resolveUsage = resolve;
    rejectUsage = reject;
  });

  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let model = fallbackModel;

  const tokens = new ReadableStream<string>({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (data === "" || data === "[DONE]") continue;
              let parsed: Record<string, never>;
              try {
                parsed = JSON.parse(data);
              } catch {
                continue;
              }
              const payload = parsed as unknown as {
                model?: string;
                choices?: { delta?: { content?: string } }[];
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              if (payload.model) model = payload.model;
              if (payload.usage) {
                promptTokens = payload.usage.prompt_tokens ?? promptTokens;
                completionTokens = payload.usage.completion_tokens ?? completionTokens;
              }
              const delta = payload.choices?.[0]?.delta?.content;
              if (delta) {
                content += delta;
                controller.enqueue(delta);
              }
            }
          }
        }
        controller.close();
        resolveUsage({ content, promptTokens, completionTokens, model });
      } catch (cause) {
        controller.error(cause);
        rejectUsage(cause);
      }
    },
  });

  return { tokens, usage };
}

// The provider is told to answer in JSON, but it is not trusted to: fenced
// blocks and prose around the object are stripped before parsing.
export function parseJsonContent(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : content).trim();
  const start = candidate.search(/[{[]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (start === -1 || end === -1 || end < start) {
    throw new ApiError("provider_unavailable", "The AI provider did not return JSON.");
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new ApiError("provider_unavailable", "The AI provider returned malformed JSON.");
  }
}
