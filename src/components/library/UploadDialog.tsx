import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Feedback";
import { sourceTypeFor, useUploadDocument } from "@/hooks/useDocuments";
import type { Subject } from "@/lib/types";

interface Props {
  open: boolean;
  onClose(): void;
  userId: string;
  subjects: Subject[];
  defaultSubjectId?: string | null;
}

type Mode = "file" | "paste";

export function UploadDialog({ open, onClose, userId, subjects, defaultSubjectId }: Props) {
  const upload = useUploadDocument();
  const [mode, setMode] = useState<Mode>("file");
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState(defaultSubjectId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");

  function reset() {
    setTitle("");
    setFile(null);
    setText("");
    upload.reset();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await upload.mutateAsync({
      userId,
      subjectId: subjectId || null,
      title: title.trim() || file?.name || "Untitled note",
      file: mode === "file" ? file ?? undefined : undefined,
      text: mode === "paste" ? text : undefined,
    });
    reset();
    onClose();
  }

  const fileTypeUnsupported = Boolean(file && !sourceTypeFor(file.name));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add material"
      description="Uploads stay private to your account and are chunked and embedded for retrieval."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="upload-form"
            loading={upload.isPending}
            disabled={fileTypeUnsupported || (mode === "file" ? !file : text.trim().length < 20)}
          >
            Upload and ingest
          </Button>
        </>
      }
    >
      <form id="upload-form" onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {(["file", "paste"] as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {value === "file" ? "Upload a file" : "Paste text"}
            </button>
          ))}
        </div>

        {mode === "file"
          ? (
            <Input
              label="File"
              type="file"
              accept=".pdf,.txt,.md,.markdown"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, ""));
              }}
              error={fileTypeUnsupported ? "Only PDF, TXT and Markdown can be ingested today." : null}
              hint="PDF, TXT or Markdown, up to 50 MB."
              className="file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
            />
          )
          : (
            <Textarea
              label="Text"
              rows={8}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste lecture notes, a transcript or a past paper…"
              hint="At least a couple of sentences so retrieval has something to work with."
            />
          )}

        <Input
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Week 4 — Dynamic programming"
          required
        />

        <Select label="Subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
          <option value="">No subject</option>
          {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </Select>

        <ErrorNotice error={upload.error} />
      </form>
    </Modal>
  );
}
