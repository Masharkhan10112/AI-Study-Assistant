import { defaultDeps } from "../_shared/deps.ts";
import { createIngestHandler } from "./handler.ts";

Deno.serve(createIngestHandler(defaultDeps()));
