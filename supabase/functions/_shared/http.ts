import { ApiError, toApiError } from "./errors.ts";

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json", ...headers },
  });
}

export function errorResponse(cause: unknown): Response {
  const error = toApiError(cause);
  return jsonResponse(error.toBody(), error.status);
}

const MAX_BODY_BYTES = 1_000_000;

export async function readJsonBody(req: Request): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError("invalid_request", "Request body must be application/json.");
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new ApiError("invalid_request", "Request body is too large.");
  }
  if (raw.trim() === "") {
    throw new ApiError("invalid_request", "Request body is required.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError("invalid_request", "Request body is not valid JSON.");
  }
}

// Every endpoint is POST-only and behind this wrapper, so CORS, method checks,
// body parsing and error shaping are identical across functions.
export function withHttp(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (req.method !== "POST") {
      return errorResponse(new ApiError("method_not_allowed", `${req.method} is not allowed.`));
    }
    try {
      return await handler(req);
    } catch (cause) {
      return errorResponse(cause);
    }
  };
}
