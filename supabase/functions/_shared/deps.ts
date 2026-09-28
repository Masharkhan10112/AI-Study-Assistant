import { type AuthContext, authenticate } from "./auth.ts";
import { type AiProvider, openAiCompatibleProvider, providerConfigFromEnv } from "./provider.ts";

/**
 * Everything a handler touches that is not pure: auth, the AI provider and the
 * clock. Handlers take this as an argument, so tests substitute fakes instead
 * of standing up Supabase and a model provider.
 */
export interface Deps {
  authenticate(req: Request): Promise<AuthContext>;
  provider(): AiProvider;
  now(): Date;
}

export function defaultDeps(): Deps {
  return {
    authenticate,
    provider: () => openAiCompatibleProvider(providerConfigFromEnv()),
    now: () => new Date(),
  };
}
