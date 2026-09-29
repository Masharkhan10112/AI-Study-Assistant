import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, FileText, Plus, Upload } from "lucide-react";
import { Page, PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { UploadDialog } from "@/components/library/UploadDialog";
import { SubjectDialog } from "@/components/library/SubjectDialog";
import { useDocuments } from "@/hooks/useDocuments";
import { useSubjects } from "@/hooks/useSubjects";
import { useAuth } from "@/providers/AuthProvider";
import type { DocumentStatus } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/utils";

export function LibraryPage() {
  const { user } = useAuth();
  const subjects = useSubjects();
  const [subjectFilter, setSubjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | "">("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const documents = useDocuments(subjectFilter || null);

  const visible = useMemo(
    () => (documents.data ?? []).filter((document) => !statusFilter || document.status === statusFilter),
    [documents.data, statusFilter],
  );

  return (
    <Page>
      <PageHeader
        title="Library"
        description="Your private material. Everything here is scoped to your account."
        action={
          <>
            <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setSubjectOpen(true)}>
              Subject
            </Button>
            <Button icon={<Upload className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>
              Add material
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <Select
          label="Subject"
          value={subjectFilter}
          onChange={(event) => setSubjectFilter(event.target.value)}
        >
          <option value="">All subjects</option>
          {(subjects.data ?? []).map((subject) => (
            <option key={subject.id} value={subject.id}>{subject.name}</option>
          ))}
        </Select>
        <Select
          label="Status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as DocumentStatus | "")}
        >
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="ready">Ready</option>
          <option value="failed">Failed</option>
        </Select>
      </div>

      {documents.error && <ErrorNotice error={documents.error} />}

      <Card>
        {documents.isLoading
          ? <LoadingBlock />
          : visible.length === 0
          ? (
            <EmptyState
              icon={<BookOpen className="h-8 w-8" />}
              title={documents.data?.length ? "Nothing matches those filters" : "Your library is empty"}
              description={documents.data?.length
                ? "Clear a filter to see the rest of your material."
                : "Upload lecture notes, a past paper or paste text to start."}
              action={
                documents.data?.length
                  ? undefined
                  : <Button size="sm" onClick={() => setUploadOpen(true)}>Add material</Button>
              }
            />
          )
          : (
            <ul className="divide-y divide-slate-100">
              {visible.map((document) => (
                <li key={document.id}>
                  <Link
                    to={`/library/${document.id}`}
                    className="flex flex-col gap-2 p-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                  >
                    <FileText className="hidden h-5 w-5 shrink-0 text-slate-400 sm:block" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{document.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {document.source_type.toUpperCase()} · {formatBytes(document.byte_size)} ·{" "}
                        {formatRelative(document.created_at)}
                        {document.error ? ` · ${document.error}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={document.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </Card>

      {user && (
        <>
          <UploadDialog
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            userId={user.id}
            subjects={subjects.data ?? []}
            defaultSubjectId={subjectFilter || null}
          />
          <SubjectDialog open={subjectOpen} onClose={() => setSubjectOpen(false)} userId={user.id} />
        </>
      )}
    </Page>
  );
}
