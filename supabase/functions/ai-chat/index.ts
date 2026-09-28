import { defaultDeps } from "../_shared/deps.ts";
import { createChatHandler } from "./handler.ts";

Deno.serve(createChatHandler(defaultDeps()));
