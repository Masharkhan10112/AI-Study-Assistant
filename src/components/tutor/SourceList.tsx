import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import type { ChatSource } from "@/lib/api";
import type { Document } from "@/lib/types";

interface Props {
  sources: ChatSource[];
  documents: Document[];
}

/** The `[n]` markers in an answer map to these cards, so a claim is checkable. */
export function SourceList({ sources, documents }: Props) {
  if (sources.length === 0) return null;
  const titleFor = (id: string) => documents.find((document) => document.id === id)?.title ?? "Document";

  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((source) => (
        <Link
          key={source.chunk_id}
          to={`/library/${source.document_id}`}
          className="group flex max-w-xs items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:border-brand-300 hover:bg-brand-50/50"
        >
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700">
            {source.n}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 truncate font-medium text-slate-700">
              <FileText className="h-3 w-3 shrink-0" aria-hidden />
              {titleFor(source.document_id)}
            </span>
            {(source.heading || source.page_from) && (
              <span className="block truncate text-slate-500">
                {source.heading ?? `Page ${source.page_from}${
                  source.page_to && source.page_to !== source.page_from ? `–${source.page_to}` : ""
                }`}
              </span>
            )}
          </span>
        </Link>
      ))}
    </div>
  );
}
