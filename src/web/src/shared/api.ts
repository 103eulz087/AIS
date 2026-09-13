/**
 * API client.
 *
 * The access token is held in memory only. It is NEVER put in localStorage:
 * a token in localStorage is readable by any script that gets injected, and this
 * system holds member contact details and chapter finances.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void { accessToken = token; }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",           // refresh token rides in an httpOnly cookie
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    let message = "Something went wrong.";
    try { message = (await res.json()).title ?? message; } catch { /* keep the default */ }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get:  <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
          request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
};

export interface Paged<T> { items: T[]; total: number; skip: number; take: number; }
