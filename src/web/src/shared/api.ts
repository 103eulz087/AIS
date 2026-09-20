/**
 * API client.
 *
 * The access token is held in memory only. It is NEVER put in localStorage:
 * a token in localStorage is readable by any script that gets injected, and this
 * system holds member contact details and chapter finances.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void { accessToken = token; }

/**
 * Read-only access to the in-memory token, for code that cannot go through request()
 * itself — today, only SignalR's accessTokenFactory (see shared/chat-connection.ts),
 * which needs to read the CURRENT token on every reconnect attempt, not the token at
 * connection-build time. Never persisted; same in-memory-only rule as the setter above.
 */
export function getAccessToken(): string | null { return accessToken; }

/** Field -> messages, the shape ASP.NET's ValidationProblem sends back. */
export type ValidationErrors = Record<string, string[]>;

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: ValidationErrors) {
    super(message);
  }
}

/**
 * Set once, by the auth provider, so this module can attempt a single silent
 * refresh-and-retry on a 401 without importing auth.tsx — that would be circular,
 * since the auth provider itself calls this module to talk to the API.
 * Returns the new access token, or null if the session could not be restored.
 */
type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;
export function setRefreshHandler(fn: RefreshHandler | null): void { refreshHandler = fn; }

// Auth endpoints handle their own 401s; retrying them through the refresh handler
// would either be meaningless (sign-in) or would recurse (refresh itself).
const NO_RETRY_PATHS = ["/api/auth/sign-in", "/api/auth/refresh", "/api/auth/sign-out"];

async function toApiError(res: Response): Promise<ApiError> {
  let message = "Something went wrong.";
  let errors: ValidationErrors | undefined;
  try {
    const body = await res.json();
    // A rejected proc/endpoint's own message reaches the client in one of three shapes,
    // and all three need checking — TypedResults.BadRequest(string)/Conflict(string) (the
    // most common one across this codebase) serializes the string DIRECTLY as the JSON
    // body, not wrapped in an object, so body.title below would silently miss it (this
    // was a real, live bug: every proc-authored rejection message anywhere in the app
    // rendered as the generic "Something went wrong." instead of its own, specific text).
    if (typeof body === "string" && body.length > 0) {
      message = body;
    } else if (typeof body?.title === "string" && body.title.length > 0) {
      // FluentValidation's automatic ValidationProblem() shape ("One or more validation
      // errors occurred.") — components that care about field-level detail already read
      // body.errors separately below, so this generic title is an acceptable fallback.
      message = body.title;
    } else if (typeof body?.detail === "string" && body.detail.length > 0) {
      // TypedResults.Problem(detail: "...") with no explicit title — this project never
      // registers a ProblemDetails customizer, so Title stays null/absent and the real
      // message sits in Detail instead.
      message = body.detail;
    }
    if (body?.errors) errors = body.errors as ValidationErrors;
  } catch { /* no JSON body, e.g. a bare 401 or 404 */ }
  return new ApiError(res.status, message, errors);
}

async function request<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",           // refresh token rides in an httpOnly cookie
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401 && !isRetry && refreshHandler && !NO_RETRY_PATHS.some(p => path.startsWith(p))) {
    const refreshed = await refreshHandler();
    if (refreshed) return request<T>(path, init, true);
  }

  if (!res.ok) throw await toApiError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/**
 * Multipart upload — used only by POST /api/attachments today. Deliberately NOT built on
 * request(): that function always sets Content-Type: application/json, and a FormData body
 * needs the browser's own auto-generated multipart boundary in that header instead. Setting
 * Content-Type by hand on a FormData request breaks the boundary and the server rejects the
 * body, so this omits the header entirely and lets fetch fill it in.
 */
async function uploadRequest<T>(path: string, form: FormData, isRetry = false): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: form,
  });

  if (res.status === 401 && !isRetry && refreshHandler) {
    const refreshed = await refreshHandler();
    if (refreshed) return uploadRequest<T>(path, form, true);
  }

  if (!res.ok) throw await toApiError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface DownloadedFile { blob: Blob; fileName: string }

/**
 * Fetches an authenticated binary response (a receipt photo/PDF) as a Blob, e.g. from
 * GET /api/attachments/{id} or GET /api/chapters/{id}/expenses/{id}/attachments/{id}.
 * Not built on request(), which always expects a JSON body. The server's own
 * Content-Disposition header only governs a plain browser navigation — since this is
 * fetched via JS, the caller decides how to present the resulting Blob (open it inline
 * in a new tab, or trigger a save).
 */
async function downloadRequest(path: string, isRetry = false): Promise<DownloadedFile> {
  const res = await fetch(path, {
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (res.status === 401 && !isRetry && refreshHandler) {
    const refreshed = await refreshHandler();
    if (refreshed) return downloadRequest(path, true);
  }

  if (!res.ok) throw await toApiError(res);

  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const fileName = match?.[1] ? decodeURIComponent(match[1]) : "download";

  return { blob: await res.blob(), fileName };
}

export const api = {
  get:      <T>(path: string) => request<T>(path),
  post:     <T>(path: string, body?: unknown) =>
              request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put:      <T>(path: string, body?: unknown) =>
              request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch:    <T>(path: string, body?: unknown) =>
              request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del:      <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload:   <T>(path: string, form: FormData) => uploadRequest<T>(path, form),
  download: (path: string) => downloadRequest(path),
};

export interface Paged<T> { items: T[]; total: number; skip: number; take: number; }
