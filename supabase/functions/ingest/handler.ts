import type { AuthContext } from "../_shared/auth.ts";
import { chunkPages, type Page } from "../_shared/chunking.ts";
import type { Deps } from "../_shared/deps.ts";
import { ApiError } from "../_shared/errors.ts";
import {
  assertHasText,
  assertSupportedSource,
  extractPdfPages,
  pagesFromText,
} from "../_shared/extract.ts";
import { jsonResponse, readJsonBody, withHttp } from "../_shared/http.ts";
import { assertNotRateLimited, assertWithinQuota, recordUsage } from "../_shared/quota.ts";
import { ingestRequestSchema, parse } from "../_shared/validation.ts";

const EMBED_BATCH = 32;

/**
 * Downloads a document, extracts text, chunks it and embeds the chunks.
 * Idempotent per document: an already-ready document is a no-op unless
 * `force` is set, and a re-run replaces that document's chunks rather than
 * appending a second copy.
 */
export function createIngestHandler(deps: Deps) {
  return withHttp(async (req) => {
    const ctx = await deps.authenticate(req);
    assertNotRateLimited(`ingest:${ctx.userId}`, { limit: 30 });
    const body = parse(ingestRequestSchema, await readJsonBody(req));

    // Read as the user: a document belonging to someone else is simply absent.
    const { data: document, error } = await ctx.db
      .from("documents")
      .select("id, source_type, storage_path, status")
      .eq("id", body.document_id)
      .maybeSingle();
    if (error) throw new ApiError("internal_error", error.message);
    if (!document) throw new ApiError("not_found", "Document not found.");

    if (document.status === "ready" && !body.force) {
      const { count } = await ctx.db
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("document_id", document.id);
      return jsonResponse({ status: "ready", chunk_count: count ?? 0, skipped: true });
    }
    if (document.status === "processing" && !body.force) {
      throw new ApiError("conflict", "This document is already being processed.");
    }

    await assertWithinQuota(ctx);
    await ctx.admin.from("documents").update({ status: "processing", error: null })
      .eq("id", document.id);

    try {
      const pages = await loadPages(ctx, document, body.text);
      assertHasText(pages);

      const chunks = chunkPages(pages);
      const provider = deps.provider();
      const embeddings: number[][] = [];
      let embeddingTokens = 0;
      let embeddingModel = provider.embeddingModel;

      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH);
        const result = await provider.embed(batch.map((chunk) => chunk.content));
        embeddings.push(...result.embeddings);
        embeddingTokens += result.promptTokens;
        embeddingModel = result.model;
      }

      // Replace rather than append, so a forced re-run cannot double the corpus.
      await ctx.admin.from("document_chunks").delete().eq("document_id", document.id);
      const { error: insertError } = await ctx.admin.from("document_chunks").insert(
        chunks.map((chunk, index) => ({
          document_id: document.id,
          user_id: ctx.userId,
          chunk_index: chunk.index,
          content: chunk.content,
          token_count: chunk.tokenCount,
          page_from: chunk.pageFrom,
          page_to: chunk.pageTo,
          embedding: JSON.stringify(embeddings[index]),
        })),
      );
      if (insertError) throw new ApiError("internal_error", insertError.message);

      await ctx.admin.from("documents").update({
        status: "ready",
        error: null,
        page_count: pages.length,
        ingested_at: deps.now().toISOString(),
      }).eq("id", document.id);
      await ctx.admin.from("ingestion_jobs")
        .update({ status: "succeeded", locked_at: null, last_error: null })
        .eq("document_id", document.id)
        .in("status", ["queued", "running"]);

      await recordUsage(ctx, {
        functionName: "ingest",
        model: embeddingModel,
        promptTokens: embeddingTokens,
        completionTokens: 0,
      });

      return jsonResponse({ status: "ready", chunk_count: chunks.length, skipped: false });
    } catch (cause) {
      await markFailed(ctx, document.id, cause);
      throw cause;
    }
  });
}

async function loadPages(
  ctx: AuthContext,
  document: { source_type: string; storage_path: string | null },
  pastedText: string | undefined,
): Promise<Page[]> {
  assertSupportedSource(document.source_type);

  if (document.source_type === "paste") {
    if (!pastedText || pastedText.trim() === "") {
      throw new ApiError("invalid_request", "A pasted document needs its `text` in the request.");
    }
    return pagesFromText(pastedText);
  }

  if (!document.storage_path) {
    throw new ApiError("document_not_ready", "The document has no file in storage yet.");
  }
  const { data, error } = await ctx.db.storage.from("materials").download(document.storage_path);
  if (error || !data) {
    throw new ApiError("document_not_ready", `The file could not be downloaded: ${error?.message}`);
  }
  const bytes = new Uint8Array(await data.arrayBuffer());

  return document.source_type === "pdf"
    ? await extractPdfPages(bytes)
    : pagesFromText(new TextDecoder().decode(bytes));
}

async function markFailed(
  ctx: AuthContext,
  documentId: string,
  cause: unknown,
): Promise<void> {
  const message = cause instanceof ApiError
    ? cause.message
    : cause instanceof Error
    ? cause.message
    : String(cause);
  await ctx.admin.from("documents").update({ status: "failed", error: message.slice(0, 500) })
    .eq("id", documentId);
  await ctx.admin.from("ingestion_jobs")
    .update({ status: "failed", locked_at: null, last_error: message.slice(0, 500) })
    .eq("document_id", documentId)
    .in("status", ["queued", "running"]);
}
