import { defaultDeps } from "../_shared/deps.ts";
import { createGenerateHandler } from "./handler.ts";

Deno.serve(createGenerateHandler(defaultDeps()));
