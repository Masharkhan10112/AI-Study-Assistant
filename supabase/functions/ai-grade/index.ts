import { defaultDeps } from "../_shared/deps.ts";
import { createGradeHandler } from "./handler.ts";

Deno.serve(createGradeHandler(defaultDeps()));
