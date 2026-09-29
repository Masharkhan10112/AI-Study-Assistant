import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ingest } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Document, DocumentSource, Summary } from "@/lib/types";

const SELECT =
  "id, subject_id, title, source_type, storage_path, mime_type, byte_size, page_count, status, error, ingested_at, created_at";

/** Keeps a list or row fresh while ingestion is still running, so the badge
 *  advances even where Realtime cannot reach the browser. */
function pollWhileIngesting(documents: Document[] | undefined): number | false {
  const busy = (documents ?? []).some((document) =>
    document.status === "pending" || document.status === "processing"
  );
  return busy ? 4000 : false;
}

export function useDocuments(subjectId?: string | null) {
  return useQuery({
    refetchInterval: (query) => pollWhileIngesting(query.state.data),
    queryKey: ["documents", subjectId ?? "all"],
    queryFn: async (): Promise<Document[]> => {
      let query = supabase.from("documents").select(SELECT).order("created_at", { ascending: false });
      if (subjectId) query = query.eq("subject_id", subjectId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as Document[];
    },
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    enabled: Boolean(id),
    refetchInterval: (query) => pollWhileIngesting(query.state.data ? [query.state.data] : []),
    queryKey: ["document", id],
    queryFn: async (): Promise<Document> => {
      const { data, error } = await supabase.from("documents").select(SELECT).eq("id", id!).single();
      if (error) throw new Error(error.message);
      return data as Document;
    },
  });
}

/**
 * Ingestion runs outside the request, so the row is watched over Realtime and
 * the cache updated in place: the badge flips the moment the function marks
 * the document ready, without waiting for the poll above.
 */
export function useDocumentStatusStream(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("documents-status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "documents", filter: `user_id=eq.${userId}` },
        (payload) => {
          const next = payload.new as Document;
          queryClient.setQueryData<Document>(["document", next.id], (previous) =>
            previous ? { ...previous, ...next } : previous);
          queryClient.invalidateQueries({ queryKey: ["documents"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}

const EXTENSIONS: Record<string, DocumentSource> = {
  pdf: "pdf",
  txt: "txt",
  md: "markdown",
  markdown: "markdown",
};

export function sourceTypeFor(fileName: string): DocumentSource | null {
  return EXTENSIONS[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

export interface UploadInput {
  userId: string;
  subjectId: string | null;
  title: string;
  file?: File;
  text?: string;
}

/**
 * Upload is three steps the UI must not interleave: create the row (which
 * enqueues an ingestion job), put the object at `{user}/{document}/source.ext`
 * so the storage policy accepts it, then ask the API to process it.
 */
export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UploadInput) => {
      const sourceType = input.file ? sourceTypeFor(input.file.name) : "paste";
      if (!sourceType) throw new Error("Only PDF, TXT and Markdown files can be ingested.");

      const documentId = crypto.randomUUID();
      const extension = input.file?.name.split(".").pop()?.toLowerCase();
      const storagePath = input.file ? `${input.userId}/${documentId}/source.${extension}` : null;

      if (input.file && storagePath) {
        const { error: uploadError } = await supabase.storage
          .from("materials")
          .upload(storagePath, input.file, { contentType: input.file.type || undefined, upsert: false });
        if (uploadError) throw new Error(uploadError.message);
      }

      const { error: insertError } = await supabase.from("documents").insert({
        id: documentId,
        user_id: input.userId,
        subject_id: input.subjectId,
        title: input.title,
        source_type: sourceType,
        storage_path: storagePath,
        mime_type: input.file?.type || (sourceType === "paste" ? "text/plain" : null),
        byte_size: input.file?.size ?? input.text?.length ?? null,
      });
      if (insertError) {
        if (input.file && storagePath) await supabase.storage.from("materials").remove([storagePath]);
        throw new Error(insertError.message);
      }

      return ingest({ document_id: documentId, text: input.text });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["usage-today"] });
    },
  });
}

export function useReingestDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => ingest({ document_id: documentId, force: true }),
    onSuccess: (_result, documentId) => {
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (document: Document) => {
      const { error } = await supabase.from("documents").delete().eq("id", document.id);
      if (error) throw new Error(error.message);
      if (document.storage_path) {
        await supabase.storage.from("materials").remove([document.storage_path]);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useSummaries(documentId: string | undefined) {
  return useQuery({
    enabled: Boolean(documentId),
    queryKey: ["summaries", documentId],
    queryFn: async (): Promise<Summary[]> => {
      const { data, error } = await supabase
        .from("summaries")
        .select("id, document_id, style, content_md, model, created_at")
        .eq("document_id", documentId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as Summary[];
    },
  });
}

/** A short-lived signed URL; the `materials` bucket is private. */
export async function signedUrlFor(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("materials").createSignedUrl(storagePath, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
