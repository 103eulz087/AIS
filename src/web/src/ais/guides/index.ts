import type { GuideDefinition } from "@/shared/tour/guides";
import { meetingsGuide } from "./meetings";
// ── ADD A GUIDE ────────────────────────────────────────────────────────────────────────────
// 1. Create ais/guides/<name>.tsx exporting one GuideDefinition (copy meetings.tsx).
// 2. Uncomment its import line below and its entry in AIS_GUIDES. Nothing else needs touching:
//    the Help page, the Start button, the "Done" tick and the step count all come from the definition.
// Keys are fixed by the server catalogue — use exactly these.
//
import { membersGuide } from "./members";                         // guide-members
import { fundsGuide } from "./funds";                             // guide-funds
import { announcementsGuide } from "./announcements";             // guide-announcements
import { digitalIdGuide } from "./digitalId";                     // guide-digital-id
import { profileGuide } from "./profile";                         // guide-profile
import { moneyGuide } from "./money";                             // guide-money            (officers)
import { postAnnouncementGuide } from "./postAnnouncement";       // guide-post-announcement (officers)
import { approvalsGuide } from "./approvals";                     // guide-approvals        (officers)

/**
 * Every how-to guide in the member app, in the order the Help page lists them within a group
 * (groups appear in order of first use: put "For every member" guides first).
 */
export const AIS_GUIDES: readonly GuideDefinition[] = [
  // For every member
  membersGuide,
  fundsGuide,
  announcementsGuide,
  digitalIdGuide,
  profileGuide,
  // For chapter officers
  meetingsGuide,
  moneyGuide,
  postAnnouncementGuide,
  approvalsGuide,
];
