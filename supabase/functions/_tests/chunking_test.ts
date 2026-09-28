import { assertEquals } from "@std/assert";
import { chunkPages, estimateTokens } from "../_shared/chunking.ts";

const paragraph = (words: number, word = "alpha") => Array(words).fill(word).join(" ");

Deno.test("short documents stay in a single chunk", () => {
  const chunks = chunkPages([{ page: 1, text: "Photosynthesis converts light into sugar." }]);
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].index, 0);
  assertEquals(chunks[0].pageFrom, 1);
  assertEquals(chunks[0].pageTo, 1);
});

Deno.test("chunks stay under the target and overlap the previous one", () => {
  const pages = [{
    page: 1,
    text: Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${paragraph(60)}`).join("\n\n"),
  }];
  const chunks = chunkPages(pages, { targetTokens: 200, overlapRatio: 0.15 });

  assertEquals(chunks.length > 1, true);
  for (const chunk of chunks) assertEquals(chunk.tokenCount <= 200, true);
  assertEquals(chunks.map((chunk) => chunk.index), chunks.map((_, index) => index));

  // The tail of each chunk reappears at the head of the next.
  for (let i = 1; i < chunks.length; i++) {
    const previousTail = chunks[i - 1].content.split("\n\n").at(-1)!;
    assertEquals(chunks[i].content.startsWith(previousTail), true);
  }
});

Deno.test("page ranges follow the content", () => {
  const chunks = chunkPages(
    [
      { page: 4, text: paragraph(40) },
      { page: 5, text: paragraph(40) },
    ],
    { targetTokens: 400 },
  );
  assertEquals(chunks[0].pageFrom, 4);
  assertEquals(chunks[0].pageTo, 5);
});

Deno.test("a paragraph larger than a chunk is split on sentences", () => {
  const huge = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about mitochondria.`)
    .join(" ");
  const chunks = chunkPages([{ page: 1, text: huge }], { targetTokens: 60 });
  assertEquals(chunks.length > 1, true);
  for (const chunk of chunks) assertEquals(chunk.tokenCount <= 60 * 1.5, true);
  // Nothing is lost: every sentence survives somewhere.
  const joined = chunks.map((chunk) => chunk.content).join(" ");
  assertEquals(joined.includes("Sentence number 39"), true);
});

Deno.test("empty pages produce no chunks", () => {
  assertEquals(chunkPages([{ page: 1, text: "   \n\n  " }]), []);
});

Deno.test("token estimation is never zero", () => {
  assertEquals(estimateTokens(""), 1);
  assertEquals(estimateTokens("abcd"), 1);
  assertEquals(estimateTokens("a".repeat(400)), 100);
});
