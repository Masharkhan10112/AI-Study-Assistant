import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Profile, UsageToday } from "@/lib/types";

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, timezone, theme, daily_review_target, daily_study_minutes_target, ai_daily_token_cap")
        .single();
      if (error) throw new Error(error.message);
      return data as Profile;
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Profile>) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", patch.id ?? "");
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });
}

/** Today's AI spend, read from the `ai_usage_today` view under RLS. */
export function useUsageToday() {
  return useQuery({
    queryKey: ["usage-today"],
    queryFn: async (): Promise<UsageToday> => {
      const { data, error } = await supabase
        .from("ai_usage_today")
        .select("requests, prompt_tokens, completion_tokens, total_tokens")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as UsageToday | null) ?? {
        requests: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
    },
  });
}
