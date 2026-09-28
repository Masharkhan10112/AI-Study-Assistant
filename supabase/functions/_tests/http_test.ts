import { assertEquals, assertObjectMatch } from "@std/assert";
import { ApiError, toApiError } from "../_shared/errors.ts";
import { errorResponse, jsonResponse, readJsonBody, withHttp } from "../_shared/http.ts";

const ok = withHttp(() => Promise.resolve(jsonResponse({ ok: true })));

Deno.test("preflight is answered without auth", async () => {
  const response = await ok(new Request("https://x.test", { method: "OPTIONS" }));
  assertEquals(response.status, 204);
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
  assertEquals(
    response.headers.get("access-control-allow-headers")?.includes("idempotency-key"),
    true,
  );
});

Deno.test("non-POST methods are rejected with a stable code", async () => {
  const response = await ok(new Request("https://x.test", { method: "GET" }));
  assertEquals(response.status, 405);
  assertObjectMatch(await response.json(), { error: { code: "method_not_allowed" } });
});

Deno.test("handler errors become the documented error envelope", async () => {
  const failing = withHttp(() => Promise.reject(new ApiError("quota_exceeded", "no tokens left")));
  const response = await failing(new Request("https://x.test", { method: "POST" }));
  assertEquals(response.status, 429);
  assertEquals(await response.json(), {
    error: { code: "quota_exceeded", message: "no tokens left" },
  });
});

Deno.test("unexpected errors are not leaked to the client", async () => {
  const response = errorResponse(new Error("connection string postgres://secret@host"));
  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error.code, "internal_error");
  assertEquals(body.error.message.includes("secret"), false);
});

Deno.test("toApiError passes ApiError through untouched", () => {
  const original = new ApiError("not_found", "gone");
  assertEquals(toApiError(original), original);
});

Deno.test("body must be json", async () => {
  const request = new Request("https://x.test", { method: "POST", body: "hello" });
  const error = await readJsonBody(request).catch((cause) => cause as ApiError);
  assertObjectMatch(error as ApiError, { code: "invalid_request" });
});

Deno.test("malformed json is a 400, not a crash", async () => {
  const request = new Request("https://x.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  const error = await readJsonBody(request).catch((cause) => cause as ApiError);
  assertEquals((error as ApiError).message, "Request body is not valid JSON.");
});

Deno.test("an empty body is rejected", async () => {
  const request = new Request("https://x.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "   ",
  });
  const error = await readJsonBody(request).catch((cause) => cause as ApiError);
  assertEquals((error as ApiError).message, "Request body is required.");
});

Deno.test("oversized bodies are refused before parsing", async () => {
  const request = new Request("https://x.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "x".repeat(1_000_001) }),
  });
  const error = await readJsonBody(request).catch((cause) => cause as ApiError);
  assertEquals((error as ApiError).message, "Request body is too large.");
});

Deno.test("every error code maps to a sane status", () => {
  assertEquals(new ApiError("unauthorized", "").status, 401);
  assertEquals(new ApiError("forbidden", "").status, 403);
  assertEquals(new ApiError("document_not_ready", "").status, 409);
  assertEquals(new ApiError("rate_limited", "").status, 429);
  assertEquals(new ApiError("provider_unavailable", "").status, 503);
});
