import type { AuthContext } from "../_shared/auth.ts";
import { ApiError } from "../_shared/errors.ts";

export interface ContextChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page_from: number | null;
}

export interface GenerationContext {
  chunks: ContextChunk[];
  documents: { id: string; title: string }[];
  text: string;
}

const MAX_CONTEXT_CHARS = 24_000;

/**
 * Loads the source passages for a generation request. Reads run as the user,
 * so an unowned document id yields nothing and is reported as not_found
 * rather than silently generating from a smaller corpus.
 */
export async function loadGenerationContext(
  ctx: AuthContext,
  documentIds: string[],
): Promise<GenerationContext> {
  const { data: documents, error: documentError } = await ctx.db
    .from("documents")
    .select("id, title, status")
    .in("id", documentIds);
  if (documentError) throw new ApiError("internal_error", documentError.message);

  const found = documents ?? [];
  if (found.length !== documentIds.length) {
    throw new ApiError("not_found", "One or more documents do not exist.");
  }
  const notReady = found.filter((document) => document.status !== "ready");
  if (notReady.length > 0) {
    throw new ApiError(
      "document_not_ready",
      `Ingestion has not finished for: ${notReady.map((d) => d.title).join(", ")}.`,
      { document_ids: notReady.map((d) => d.id) },
    );
  }

  const { data: chunks, error: chunkError } = await ctx.db
    .from("document_chunks")
    .select("id, document_id, chunk_index, content, page_from")
    .in("document_id", documentIds)
    .order("document_id", { ascending: true })
    .order("chunk_index", { ascending: true });
  if (chunkError) throw new ApiError("internal_error", chunkError.message);
  if (!chunks || chunks.length === 0) {
    throw new ApiError("document_not_ready", "These documents have no indexed content yet.");
  }

  const selected: ContextChunk[] = [];
  const parts: string[] = [];
  let total = 0;
  for (const chunk of chunks as ContextChunk[]) {
    const part = `[${selected.length}] ${chunk.content}`;
    if (total + part.length > MAX_CONTEXT_CHARS) break;
    selected.push(chunk);
    parts.push(part);
    total += part.length;
  }

  return {
    chunks: selected,
    documents: found.map((document) => ({ id: document.id, title: document.title })),
    text: parts.join("\n\n"),
  };
}

// The model refers to passages by their position in the prompt; this maps that
// number back to a real chunk id, ignoring anything out of range.
export function chunkIdAt(context: GenerationContext, index: number | undefined): string | null {
  if (index === undefined || index < 0 || index >= context.chunks.length) return null;
  return context.chunks[index].id;
}
