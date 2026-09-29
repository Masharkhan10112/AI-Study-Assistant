import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generate, type GenerateRequest } from "@/lib/api";

/**
 * Every generation kind funnels through `ai-generate`; the resource it writes
 * decides which caches go stale.
 */
export function useGenerate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: GenerateRequest) => generate(request),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["usage-today"] });
      switch (result.kind) {
        case "summary":
          queryClient.invalidateQueries({ queryKey: ["summaries"] });
          break;
        case "flashcards":
          queryClient.invalidateQueries({ queryKey: ["decks"] });
          queryClient.invalidateQueries({ queryKey: ["due-cards"] });
          break;
        case "quiz":
          queryClient.invalidateQueries({ queryKey: ["quizzes"] });
          break;
        case "plan":
          queryClient.invalidateQueries({ queryKey: ["plans"] });
          queryClient.invalidateQueries({ queryKey: ["today-plan"] });
          break;
      }
    },
  });
}
