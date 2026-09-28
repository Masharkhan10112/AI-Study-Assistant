import type { Deps } from "../_shared/deps.ts";
import { jsonResponse, readJsonBody, withHttp } from "../_shared/http.ts";
import { assertNotRateLimited, assertWithinQuota, recordUsage } from "../_shared/quota.ts";
import { hybridSearch } from "../_shared/retrieval.ts";
import { parse, searchRequestSchema } from "../_shared/validation.ts";

// Retrieval without generation: powers global search and "find in my notes".
export function createSearchHandler(deps: Deps) {
  return withHttp(async (req) => {
    const ctx = await deps.authenticate(req);
    assertNotRateLimited(`search:${ctx.userId}`, { limit: 60 });
    const body = parse(searchRequestSchema, await readJsonBody(req));
    await assertWithinQuota(ctx);

    const provider = deps.provider();
    const { hits, embeddingTokens, embeddingModel } = await hybridSearch(
      ctx.db,
      provider,
      body.query,
      { documentIds: body.document_ids, subjectId: body.subject_id, limit: body.limit },
    );

    await recordUsage(ctx, {
      functionName: "search",
      model: embeddingModel,
      promptTokens: embeddingTokens,
      completionTokens: 0,
    });

    return jsonResponse({ hits });
  });
}
