// Stable, documented error codes. Clients branch on `code`, never on the message.
export const ERROR_STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  document_not_ready: 409,
  quota_exceeded: 429,
  rate_limited: 429,
  internal_error: 500,
  provider_unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

// Anything that escapes a handler becomes a 500 without leaking internals: the
// original message goes to the log, never to the client.
export function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error("unhandled error:", message, cause instanceof Error ? cause.stack : undefined);
  return new ApiError("internal_error", "Something went wrong. Please try again.");
}
