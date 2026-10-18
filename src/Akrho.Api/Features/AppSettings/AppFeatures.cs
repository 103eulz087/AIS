namespace Akrho.Api.Features.AppSettings;

/// <summary>
/// The keys of dbo.AppFeature (db/schema/30_app_settings_free_trial.sql), used at every
/// <c>RequireFeature</c> call site. Add the row to that table before using a new key here.
///
/// Route to feature mapping (one place to read it all):
///   Dashboard         GET /api/chapters/{id}/dashboard
///   Members           GET /api/members, PUT /api/members/{id}/identity
///   Meetings          /api/chapters/{id}/meetings
///   Funds             /api/chapters/{id}/ledger, /activities, /expenses, /donations; /api/attachments
///   Memos             /api/chapters/{id}/memos
///   CorrectiveActions /api/chapters/{id}/corrective-actions
///   ChapterChat       /api/chapters/{id}/chat; the SignalR hub's chapter groups (ChatHub)
///   PrivateMessages   /api/conversations; the SignalR hub's per-member group (ChatHub)
///   DigitalId         /api/members/me/credential, /me/scans, POST /api/scans
///   ChapterAdmin      /api/membership-applications (authenticated), /api/chapters/me/invite-link,
///                     /api/members/{id}/enrolment-link, POST/DELETE /api/chapters/{id}/officers
///   Announcements     always open — never gated.
/// Never gated: auth, own profile/photo/logo, /me/access, notifications, reference data,
/// documents (read receipts), verification, enrolment, and every Portal-only route.
/// </summary>
public static class AppFeatures
{
    public const string Announcements = "Announcements";
    public const string Dashboard = "Dashboard";
    public const string Members = "Members";
    public const string Meetings = "Meetings";
    public const string Funds = "Funds";
    public const string Memos = "Memos";
    public const string CorrectiveActions = "CorrectiveActions";
    public const string ChapterChat = "ChapterChat";
    public const string PrivateMessages = "PrivateMessages";
    public const string DigitalId = "DigitalId";
    public const string ChapterAdmin = "ChapterAdmin";
}
