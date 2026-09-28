import type { Deps } from "../_shared/deps.ts";
import { jsonResponse, readJsonBody, withHttp } from "../_shared/http.ts";
import { beginIdempotent } from "../_shared/idempotency.ts";
import { assertNotRateLimited, assertWithinQuota, recordUsage } from "../_shared/quota.ts";
import { generateRequestSchema, parse } from "../_shared/validation.ts";
import { loadGenerationContext } from "./context.ts";
import { GENERATORS } from "./generators.ts";

/**
 * Turns documents into a summary, a flashcard deck, a quiz or a study plan.
 * Honours `Idempotency-Key`, so a client retry after a timeout replays the
 * first response instead of creating a second deck.
 */
export function createGenerateHandler(deps: Deps) {
  return withHttp(async (req) => {
    const ctx = await deps.authenticate(req);
    assertNotRateLimited(`ai-generate:${ctx.userId}`, { limit: 20 });
    const body = parse(generateRequestSchema, await readJsonBody(req));
    await assertWithinQuota(ctx);

    const idempotent = await beginIdempotent(ctx, "ai-generate", req);
    if (idempotent.replay) return jsonResponse(idempotent.replay);

    try {
      const context = await loadGenerationContext(ctx, body.document_ids);
      const result = await GENERATORS[body.kind](
        ctx,
        deps.provider(),
        body,
        context,
        deps.now(),
      );

      await recordUsage(ctx, {
        functionName: "ai-generate",
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });

      const payload = {
        kind: body.kind,
        resource: result.resource,
        resource_id: result.resourceId,
        created: result.created,
        model: result.model,
      };
      await idempotent.complete(payload);
      return jsonResponse(payload, 201);
    } catch (cause) {
      // Release the key so the client may retry the same request.
      await idempotent.release();
      throw cause;
    }
  });
}
