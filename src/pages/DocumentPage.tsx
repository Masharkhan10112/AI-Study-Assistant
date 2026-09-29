import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import { ArrowLeft, Download, Layers, ListChecks, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Page, PageHeader } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import {
  signedUrlFor,
  useDeleteDocument,
  useDocument,
  useReingestDocument,
  useSummaries,
} from "@/hooks/useDocuments";
import { useGenerate } from "@/hooks/useGenerate";
import type { SummaryStyle } from "@/lib/types";
import { formatBytes, formatDate } from "@/lib/utils";

const STYLES: SummaryStyle[] = ["brief", "detailed", "outline"];

export function DocumentPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const document = useDocument(documentId);
  const summaries = useSummaries(documentId);
  const generateResource = useGenerate();
  const reingest = useReingestDocument();
  const deleteDocument = useDeleteDocument();
  const [style, setStyle] = useState<SummaryStyle>("brief");

  if (document.isLoading) return <LoadingBlock />;
  if (document.error || !document.data) {
    return (
      <Page>
        <ErrorNotice error={document.error ?? new Error("Document not found.")} />
      </Page>
    );
  }

  const current = document.data;
  const ready = current.status === "ready";
  const summary = (summaries.data ?? []).find((entry) => entry.style === style);

  return (
    <Page>
      <Link to="/library" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Library
      </Link>

      <PageHeader
        title={current.title}
        description={`${current.source_type.toUpperCase()} · ${formatBytes(current.byte_size)} · added ${
          formatDate(current.created_at)
        }`}
        action={
          <>
            <StatusBadge status={current.status} />
            {current.storage_path && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Download className="h-4 w-4" />}
                onClick={async () => {
                  window.open(await signedUrlFor(current.storage_path!), "_blank", "noopener");
                }}
              >
                Open file
              </Button>
            )}
            {/* Pasted notes have no stored source to re-read, so re-ingesting
                them would only fail the document. */}
            {current.source_type !== "paste" && (
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="h-4 w-4" />}
                loading={reingest.isPending}
                onClick={() => reingest.mutate(current.id)}
              >
                Re-ingest
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={async () => {
                await deleteDocument.mutateAsync(current);
                navigate("/library");
              }}
            >
              Delete
            </Button>
          </>
        }
      />

      {current.status === "failed" && current.error && (
        <ErrorNotice error={new Error(`Ingestion failed: ${current.error}`)} />
      )}
      <ErrorNotice error={reingest.error ?? generateResource.error} />

      {!ready && current.status !== "failed" && (
        <Card>
          <CardBody className="flex items-center gap-3 text-sm text-slate-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" aria-hidden />
            This document is still being processed — generation unlocks as soon as it is ready.
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Summary"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg bg-slate-100 p-1">
                  {STYLES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setStyle(value)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                        style === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  icon={<Sparkles className="h-4 w-4" />}
                  disabled={!ready}
                  loading={generateResource.isPending && generateResource.variables?.kind === "summary"}
                  onClick={() =>
                    generateResource.mutate({
                      kind: "summary",
                      document_ids: [current.id],
                      options: { style },
                    })}
                >
                  {summary ? "Regenerate" : "Generate"}
                </Button>
              </div>
            }
          />
          <CardBody>
            {summaries.isLoading
              ? <LoadingBlock />
              : summary
              ? (
                <div className="prose-study">
                  <Markdown>{summary.content_md}</Markdown>
                </div>
              )
              : (
                <EmptyState
                  title={`No ${style} summary yet`}
                  description="Generate one and it is saved against this document."
                />
              )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Turn into study material" />
          <CardBody className="space-y-3">
            <Button
              className="w-full"
              variant="secondary"
              icon={<Layers className="h-4 w-4" />}
              disabled={!ready}
              loading={generateResource.isPending && generateResource.variables?.kind === "flashcards"}
              onClick={() =>
                generateResource.mutate({
                  kind: "flashcards",
                  document_ids: [current.id],
                  options: { count: 15, deck_name: current.title, subject_id: current.subject_id },
                })}
            >
              Generate flashcards
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              icon={<ListChecks className="h-4 w-4" />}
              disabled={!ready}
              loading={generateResource.isPending && generateResource.variables?.kind === "quiz"}
              onClick={() =>
                generateResource.mutate({
                  kind: "quiz",
                  document_ids: [current.id],
                  options: {
                    count: 8,
                    difficulty: "medium",
                    title: `${current.title} quiz`,
                    subject_id: current.subject_id,
                  },
                })}
            >
              Generate quiz
            </Button>

            {generateResource.isSuccess && (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                Created {generateResource.data.created} {generateResource.data.resource}.{" "}
                {generateResource.data.kind === "flashcards" && <Link className="underline" to="/review">Review now</Link>}
                {generateResource.data.kind === "quiz" && (
                  <Link className="underline" to={`/quizzes/${generateResource.data.resource_id}`}>Take it</Link>
                )}
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Badge>{current.page_count ? `${current.page_count} pages` : "Text source"}</Badge>
              {current.ingested_at && <Badge tone="success">Ingested {formatDate(current.ingested_at)}</Badge>}
            </div>
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
