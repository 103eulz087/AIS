import type { GuideDefinition } from "@/shared/tour/guides";
import { registrationsGuide } from "./registrations";
// ── ADD A GUIDE ────────────────────────────────────────────────────────────────────────────
// 1. Create portal/guides/<name>.tsx exporting one GuideDefinition (copy registrations.tsx).
// 2. Uncomment its import line below and its entry in PORTAL_GUIDES. Nothing else needs touching.
// Keys are fixed by the server catalogue — use exactly these. `group` is the Help page heading:
// use "Chapters", "Members", "Councils" or "Settings" so the page reads by area.
//
import { seatingGuide } from "./seating";                 // guide-portal-seating      (Councils)
import { permissionsGuide } from "./permissions";         // guide-portal-permissions  (Councils)
import { paymentsGuide } from "./payments";               // guide-portal-payments     (Members)
import { membersGuide } from "./members";                 // guide-portal-members      (Members)
import { settingsGuide } from "./settings";               // guide-portal-settings     (Settings)

/** Every how-to guide in the Council Portal, in Help-page order (groups appear in order of first use). */
export const PORTAL_GUIDES: readonly GuideDefinition[] = [
  // Chapters
  registrationsGuide,
  // Members
  paymentsGuide,
  membersGuide,
  // Councils
  seatingGuide,
  permissionsGuide,
  // Settings
  settingsGuide,
];
