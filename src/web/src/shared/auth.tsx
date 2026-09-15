/**
 * Auth session context.
 *
 * The access token and decoded claims live in memory only, in this module's React
 * state — never localStorage/sessionStorage. On load we attempt one silent
 * POST /api/auth/refresh (the httpOnly refresh cookie may already be valid from a
 * previous visit); a 401 there just means "not signed in yet", which is not an
 * error state, it is the default one.
 *
 * Do not name a top-level binding `status` — see CLAUDE.md §8. The session state
 * below is called `session`, never `status`.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, setAccessToken, setRefreshHandler } from "@/shared/api";
import { ScreenSkeleton } from "@/shared/states";

export interface Claims {
  memberId: number;
  chapterId: number;
  /** Absent while the backend gap noted in AuthEndpoints.Me stands — never render the word "null". */
  chapterName: string | null;
  giftName: string;
  roles: string[];
}

interface MeResponse {
  memberId: number;
  chapterId: number;
  chapterName: string | null;
  giftName: string;
  roles: string[];
}

interface SignInResponse {
  accessToken: string;
  expiresAtUtc: string;
}

export type Session = "loading" | "signed-in" | "signed-out";

interface AuthContextValue {
  session: Session;
  claims: Claims | null;
  signIn: (memberNumber: string, password: string) => Promise<void>;
  completeEnrolment: (token: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Raw fetch, deliberately bypassing api.ts's request() — this function IS its retry logic. */
async function refreshOnce(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (!res.ok) return null;
    const body = (await res.json()) as SignInResponse;
    return body.accessToken;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>("loading");
  const [claims, setClaims] = useState<Claims | null>(null);

  const settleSignedOut = useCallback(() => {
    setAccessToken(null);
    setClaims(null);
    setSession("signed-out");
  }, []);

  const loadClaims = useCallback(async () => {
    const me = await api.get<MeResponse>("/api/auth/me");
    setClaims(me);
  }, []);

  // Used both to restore a session on load and as the 401 retry handler api.ts calls —
  // one code path, so the two can never drift.
  const attemptRefresh = useCallback(async (): Promise<string | null> => {
    const token = await refreshOnce();
    if (!token) {
      settleSignedOut();
      return null;
    }
    setAccessToken(token);
    return token;
  }, [settleSignedOut]);

  useEffect(() => {
    setRefreshHandler(attemptRefresh);
    return () => setRefreshHandler(null);
  }, [attemptRefresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await attemptRefresh();
      if (cancelled || !token) return;
      try {
        await loadClaims();
        if (!cancelled) setSession("signed-in");
      } catch {
        if (!cancelled) settleSignedOut();
      }
    })();
    return () => { cancelled = true; };
  }, [attemptRefresh, loadClaims, settleSignedOut]);

  const signIn = useCallback(async (memberNumber: string, password: string) => {
    const res = await api.post<SignInResponse>("/api/auth/sign-in", { memberNumber, password });
    setAccessToken(res.accessToken);
    await loadClaims();
    setSession("signed-in");
  }, [loadClaims]);

  const completeEnrolment = useCallback(async (token: string, password: string) => {
    const res = await api.post<SignInResponse>(`/api/enrolment/${token}/complete`, { password });
    setAccessToken(res.accessToken);
    await loadClaims();
    setSession("signed-in");
  }, [loadClaims]);

  const signOut = useCallback(async () => {
    try {
      await api.post("/api/auth/sign-out");
    } catch {
      // Revocation is best-effort from the client's point of view — the session is
      // cleared locally regardless, so the user is never stuck "signed in" on a hiccup.
    }
    settleSignedOut();
  }, [settleSignedOut]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, claims, signIn, completeEnrolment, signOut }),
    [session, claims, signIn, completeEnrolment, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** Wraps a protected route. Redirects to /sign-in only once the silent-refresh check settles. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();

  if (session === "loading") return <ScreenSkeleton />;
  if (session === "signed-out") return <Navigate to="/sign-in" replace state={{ from: location }} />;
  return <>{children}</>;
}
