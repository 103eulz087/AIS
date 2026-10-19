import { useAuth } from "@/shared/auth";
import { useMemberAccess } from "@/shared/memberAccess";
import type { GuideContext } from "./types";

/** The GuideContext for the signed-in person (claims, roles, council seats, free-trial gate). */
export function useGuideContext(): GuideContext {
  const { claims } = useAuth();
  const { isFeatureOpen } = useMemberAccess();
  return {
    claims,
    roles: claims?.roles ?? [],
    seats: claims?.councilSeats ?? [],
    isFeatureOpen,
  };
}
