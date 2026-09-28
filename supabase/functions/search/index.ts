import { defaultDeps } from "../_shared/deps.ts";
import { createSearchHandler } from "./handler.ts";

Deno.serve(createSearchHandler(defaultDeps()));
