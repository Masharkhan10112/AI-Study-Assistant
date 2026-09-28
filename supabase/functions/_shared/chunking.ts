export interface Chunk {
  content: string;
  tokenCount: number;
  index: number;
  pageFrom: number | null;
  pageTo: number | null;
}

export interface Page {
  page: number;
  text: string;
}

// ~4 characters per token is the usual English approximation; exact counts
// would need the provider's tokenizer and are not worth the payload here.
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

interface ChunkOptions {
  targetTokens?: number;
  overlapRatio?: number;
}

// Splits on paragraph boundaries and keeps a 15% overlap so a sentence spanning
// two chunks is still retrievable from either side.
export function chunkPages(pages: Page[], options: ChunkOptions = {}): Chunk[] {
  const targetTokens = options.targetTokens ?? 800;
  const overlapTokens = Math.floor(targetTokens * (options.overlapRatio ?? 0.15));

  const units: { text: string; tokens: number; page: number }[] = [];
  for (const page of pages) {
    for (const paragraph of page.text.split(/\n\s*\n/)) {
      const text = paragraph.trim();
      if (text === "") continue;
      for (const piece of splitOversized(text, targetTokens)) {
        units.push({ text: piece, tokens: estimateTokens(piece), page: page.page });
      }
    }
  }

  const chunks: Chunk[] = [];
  let current: typeof units = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      index: chunks.length,
      content: current.map((unit) => unit.text).join("\n\n"),
      tokenCount: currentTokens,
      pageFrom: current[0].page,
      pageTo: current[current.length - 1].page,
    });
    const overlap: typeof units = [];
    let overlapCount = 0;
    for (let i = current.length - 1; i >= 0 && overlapCount < overlapTokens; i--) {
      overlap.unshift(current[i]);
      overlapCount += current[i].tokens;
    }
    // A single unit that already fills the chunk would otherwise repeat forever.
    current = overlap.length === current.length ? [] : overlap;
    currentTokens = current.reduce((sum, unit) => sum + unit.tokens, 0);
  };

  for (const unit of units) {
    if (currentTokens + unit.tokens > targetTokens) flush();
    current.push(unit);
    currentTokens += unit.tokens;
  }
  flush();

  return chunks;
}

// Paragraphs longer than a whole chunk are cut on sentence boundaries.
function splitOversized(text: string, targetTokens: number): string[] {
  if (estimateTokens(text) <= targetTokens) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text];
  const pieces: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    if (buffer !== "" && estimateTokens(buffer + sentence) > targetTokens) {
      pieces.push(buffer.trim());
      buffer = "";
    }
    buffer += sentence;
  }
  if (buffer.trim() !== "") pieces.push(buffer.trim());
  return pieces;
}
