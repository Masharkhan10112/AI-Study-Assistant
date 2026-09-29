import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Subject } from "@/lib/types";

const SELECT = "id, name, description, color, archived_at, created_at";

export function useSubjects() {
  return useQuery({
    queryKey: ["subjects"],
    queryFn: async (): Promise<Subject[]> => {
      const { data, error } = await supabase
        .from("subjects")
        .select(SELECT)
        .is("archived_at", null)
        .order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Subject[];
    },
  });
}

export function useCreateSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; color: string; userId: string }) => {
      const { data, error } = await supabase
        .from("subjects")
        .insert({
          user_id: input.userId,
          name: input.name,
          description: input.description || null,
          color: input.color,
        })
        .select(SELECT)
        .single();
      if (error) {
        // `subjects_user_id_name_key`: names are unique per student.
        throw new Error(error.code === "23505" ? "You already have a subject with that name." : error.message);
      }
      return data as Subject;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subjects"] }),
  });
}

export function useArchiveSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("subjects")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}
