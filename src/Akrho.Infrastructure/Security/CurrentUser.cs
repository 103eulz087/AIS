using System.Security.Claims;

namespace Akrho.Infrastructure.Security;

/// <summary>
/// Who is asking. This is the ONLY trusted source of caller identity.
/// A chapterId arriving in a request body is a filter, never an authorisation.
/// </summary>
public interface ICurrentUser
{
    int MemberId { get; }
    int ChapterId { get; }

    /// <summary>
    /// The "aid" claim — an internal UserAccount row id, not personal data (see
    /// AccessTokenService's own header comment). Only needed where a procedure's own
    /// parameter is an account id rather than a member id, e.g. usp_PushSubscription_Register/
    /// _Remove — dbo.PushSubscription is keyed off the account that owns the device, not the
    /// member directly.
    /// </summary>
    int AccountId { get; }
    IReadOnlySet<string> Roles { get; }
    bool IsChapterOfficer { get; }
    bool IsCouncilOfficer { get; }
}

public sealed class CurrentUser : ICurrentUser
{
    public CurrentUser(ClaimsPrincipal principal)
    {
        MemberId = int.TryParse(principal.FindFirst("mid")?.Value, out var m) ? m : 0;
        ChapterId = int.TryParse(principal.FindFirst("chp")?.Value, out var c) ? c : 0;
        AccountId = int.TryParse(principal.FindFirst("aid")?.Value, out var a) ? a : 0;
        Roles = principal.FindAll(ClaimTypes.Role).Select(r => r.Value).ToHashSet(StringComparer.Ordinal);
    }

    public int MemberId { get; }
    public int ChapterId { get; }
    public int AccountId { get; }
    public IReadOnlySet<string> Roles { get; }

    public bool IsChapterOfficer =>
        Roles.Overlaps(["ChapterOfficer", "ChapterTreasurer", "ChapterAdmin"]);

    public bool IsCouncilOfficer =>
        Roles.Overlaps(["CouncilSecretary", "CouncilTreasurer", "ProvincialOfficer",
                        "RegionalOfficer", "NationalSecretariat"]);
}
