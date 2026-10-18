import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setTrialEndedHandler } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import type { MemberAccess } from "@/shared/types";

export const MEMBER_ACCESS_KEY = ["member-access"] as const;

/** Announcements stay open for everyone, whatever the server says. */
const ALWAYS_OPEN = "Announcements";

/**
 * What the signed-in member may use right now (free trial).
 * GET /api/members/me/access. While it loads, or if it cannot be read, every feature
 * is treated as open: a slow phone must never flash a lock, and the API still refuses
 * a locked call on its own — this is only the front door.
 */
export function useMemberAccess() {
  const { claims } = useAuth();
  const query = useQuery({
    queryKey: MEMBER_ACCESS_KEY,
    queryFn: () => api.get<MemberAccess>("/api/members/me/access"),
    enabled: !!claims,
    staleTime: 30_000,
    retry: false,
  });

  const raw = query.data;
  // Tolerate an unrelated payload (a stub, an old server) rather than throw.
  const access: MemberAccess | undefined =
    raw && typeof raw.isLocked === "boolean" && Array.isArray(raw.features) ? raw : undefined;

  function isFeatureOpen(featureKey: string): boolean {
    if (featureKey === ALWAYS_OPEN) return true;
    if (!access || !access.isLocked) return true;
    return access.features.find(f => f.featureKey === featureKey)?.isOpen ?? false;
  }

  return { access, isLoading: query.isLoading, isFeatureOpen };
}

/** Mount once in the app shell: a "trial ended" refusal from any call refreshes access. */
export function useTrialEndedSync(): void {
  const qc = useQueryClient();
  useEffect(() => {
    setTrialEndedHandler(() => { void qc.invalidateQueries({ queryKey: MEMBER_ACCESS_KEY }); });
    return () => setTrialEndedHandler(null);
  }, [qc]);
}
