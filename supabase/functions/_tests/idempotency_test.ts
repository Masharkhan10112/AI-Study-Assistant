import { assertEquals, assertRejects } from "@std/assert";
import { ApiError } from "../_shared/errors.ts";
import { beginIdempotent } from "../_shared/idempotency.ts";
import { fakeContext, FakeDb, postRequest, TEST_USER } from "./fakes.ts";

const withKey = (key: string) => postRequest({}, { "idempotency-key": key });

Deno.test("no header means no bookkeeping", async () => {
  const db = new FakeDb();
  const handle = await beginIdempotent(fakeContext(db), "ai-generate", postRequest({}));
  assertEquals(handle.replay, undefined);
  await handle.complete({ ok: true });
  assertEquals(db.rows("idempotency_keys").length, 0);
});

Deno.test("an over-long key is a client error", async () => {
  const error = await assertRejects(
    () => beginIdempotent(fakeContext(new FakeDb()), "ai-generate", withKey("k".repeat(201))),
    ApiError,
  );
  assertEquals(error.code, "invalid_request");
});

Deno.test("the first call claims the key and stores its response", async () => {
  const db = new FakeDb();
  const handle = await beginIdempotent(fakeContext(db), "ai-generate", withKey("abc"));
  await handle.complete({ resource_id: "deck-1" });

  assertEquals(db.rows("idempotency_keys").length, 1);
  assertEquals(db.rows("idempotency_keys")[0].user_id, TEST_USER);
  assertEquals(db.rows("idempotency_keys")[0].response, { resource_id: "deck-1" });
});

Deno.test("a retry replays the stored response instead of regenerating", async () => {
  const db = new FakeDb({
    idempotency_keys: [{
      user_id: TEST_USER,
      function_name: "ai-generate",
      key: "abc",
      response: { resource_id: "deck-1" },
    }],
  });
  db.failures["idempotency_keys:unique"] = "23505";

  const handle = await beginIdempotent(fakeContext(db), "ai-generate", withKey("abc"));
  assertEquals(handle.replay, { resource_id: "deck-1" });
});

Deno.test("a duplicate while the first call is still running is a conflict", async () => {
  const db = new FakeDb({
    idempotency_keys: [{
      user_id: TEST_USER,
      function_name: "ai-generate",
      key: "abc",
      response: null,
    }],
  });
  db.failures["idempotency_keys:unique"] = "23505";

  const error = await assertRejects(
    () => beginIdempotent(fakeContext(db), "ai-generate", withKey("abc")),
    ApiError,
  );
  assertEquals(error.code, "conflict");
});

Deno.test("a failed request releases the key so the retry can proceed", async () => {
  const db = new FakeDb();
  const handle = await beginIdempotent(fakeContext(db), "ai-generate", withKey("abc"));
  await handle.release();
  assertEquals(db.rows("idempotency_keys").length, 0);
});
