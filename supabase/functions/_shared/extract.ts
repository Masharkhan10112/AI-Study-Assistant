import { ApiError } from "./errors.ts";
import type { Page } from "./chunking.ts";

export type SupportedSource = "pdf" | "txt" | "markdown" | "paste";

// docx/pptx/image need a converter or OCR and are rejected explicitly rather
// than silently producing an empty document.
export function assertSupportedSource(sourceType: string): asserts sourceType is SupportedSource {
  if (!["pdf", "txt", "markdown", "paste"].includes(sourceType)) {
    throw new ApiError(
      "invalid_request",
      `Documents of type "${sourceType}" cannot be ingested yet. Supported: pdf, txt, markdown, paste.`,
    );
  }
}

export function pagesFromText(text: string): Page[] {
  return [{ page: 1, text }];
}

export async function extractPdfPages(bytes: Uint8Array): Promise<Page[]> {
  // Imported lazily: pdf.js is heavy and only needed for PDFs.
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [String(text)];
    return pages.map((value, index) => ({ page: index + 1, text: value }));
  } catch (cause) {
    throw new ApiError(
      "invalid_request",
      `The PDF could not be read: ${cause instanceof Error ? cause.message : cause}`,
    );
  }
}

export function assertHasText(pages: Page[]): void {
  const total = pages.reduce((sum, page) => sum + page.text.trim().length, 0);
  if (total === 0) {
    throw new ApiError(
      "invalid_request",
      "No text could be extracted. Scanned documents need OCR, which is not available yet.",
    );
  }
}
