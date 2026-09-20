namespace Akrho.Infrastructure.Security;

/// <summary>
/// DRY-RUN ONLY — explicitly requested and confirmed 2026-09-20, knowing the trade-off.
///
/// A shared, well-known initial password so a newly-created member can sign in immediately
/// instead of waiting on his enrolment link. This IS a genuine weakening of CLAUDE.md
/// invariant #16 ("passwords are never transmitted... the officer sets his own") — anyone
/// who knows this string can sign in as ANY member who has not yet redeemed his own
/// enrolment link and chosen a real password. It does not touch the enrolment link itself:
/// that mechanism is fully intact and remains the sanctioned way a member gets his OWN
/// password (usp_Enrolment_Redeem's existing "account already exists" branch overwrites
/// this default the moment he completes it).
///
/// TO HARDEN: delete this file, then grep the whole repo for "DryRunDefaults" and remove
/// every call site (usp_Enrolment_Issue's @DefaultPasswordHash parameter and its callers in
/// ChapterRegistrationsEndpoints/MembershipApplicationsEndpoints/MembersEndpoints). No other
/// change is needed — the enrolment-link flow was never modified, only supplemented.
/// </summary>
public static class DryRunDefaults
{
    public const string InitialPassword = "Skeptron1973";
}
