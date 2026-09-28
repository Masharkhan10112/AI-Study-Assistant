import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./errors.ts";
import type { AiProvider } from "./provider.ts";

export interface Hit {
  chunk_id: string;
  document_id: string;
  content: string;
  page_from: number | null;
  page_to: number | null;
  heading: string | null;
  score: number;
}

export interface RetrievalScope {
  documentIds?: string[] | null;
  subjectId?: string | null;
  limit?: number;
}

// Resolves a subject to its documents so callers can scope retrieval either
// way. Runs as the user, so an id they do not own simply yields nothing.
export async function resolveDocumentIds(
  db: SupabaseClient,
  scope: RetrievalScope,
): Promise<string[] | null> {
  if (scope.documentIds && scope.documentIds.length > 0) return scope.documentIds;
  if (!scope.subjectId) return null;
  const { data, error } = await db.from("documents").select("id").eq("subject_id", scope.subjectId);
  if (error) throw new ApiError("internal_error", error.message);
  return (data ?? []).map((row: { id: string }) => row.id);
}

export async function hybridSearch(
  db: SupabaseClient,
  provider: AiProvider,
  query: string,
  scope: RetrievalScope = {},
): Promise<{ hits: Hit[]; embeddingTokens: number; embeddingModel: string }> {
  const filterDocumentIds = await resolveDocumentIds(db, scope);
  // An empty (not null) filter means "a scope was requested but matched
  // nothing" — searching everything instead would leak out of that scope.
  if (filterDocumentIds !== null && filterDocumentIds.length === 0) {
    return { hits: [], embeddingTokens: 0, embeddingModel: provider.embeddingModel };
  }

  const embedding = await provider.embed([query]);
  const { data, error } = await db.rpc("hybrid_search_chunks", {
    query_text: query,
    query_embedding: JSON.stringify(embedding.embeddings[0]),
    match_count: scope.limit ?? 10,
    filter_document_ids: filterDocumentIds,
  });
  if (error) throw new ApiError("internal_error", error.message);

  return {
    hits: (data ?? []) as Hit[],
    embeddingTokens: embedding.promptTokens,
    embeddingModel: embedding.model,
  };
}

// Numbered so the model can cite [1], [2]; the numbers map back to hits by index.
export function buildContext(hits: Hit[], maxChars = 12_000): string {
  const parts: string[] = [];
  let total = 0;
  for (const [index, hit] of hits.entries()) {
    const location = hit.page_from ? ` (p.${hit.page_from})` : "";
    const part = `[${index + 1}]${location} ${hit.content}`;
    if (total + part.length > maxChars) break;
    parts.push(part);
    total += part.length;
  }
  return parts.join("\n\n");
}

// The model is asked to cite with [n]; only markers that exist become citations.
export function extractCitations(
  answer: string,
  hits: Hit[],
): { chunkId: string; rank: number; snippet: string }[] {
  const seen = new Set<number>();
  for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < hits.length) seen.add(index);
  }
  return [...seen].sort((a, b) => a - b).map((index, rank) => ({
    chunkId: hits[index].chunk_id,
    rank: rank + 1,
    snippet: hits[index].content.slice(0, 300),
  }));
}
