namespace Akrho.Api.Features.AppSettings;

public sealed record MemberAccessFeatureDto(string FeatureKey, string DisplayName, bool IsOpen);

/// <summary>GET /api/members/me/access.</summary>
public sealed record MemberAccessDto(
    bool IsTrialEnabled, int TrialDays, DateOnly? TrialStartedOn, DateOnly? TrialEndsOn,
    int TrialDaysLeft, bool IsPaid, bool IsLocked, int MembershipYear,
    IReadOnlyList<MemberAccessFeatureDto> Features);

public sealed record AppSettingsFeatureDto(
    string FeatureKey, string DisplayName, string Description, bool IsAlwaysOpen, bool IsOpenAfterTrial);

public sealed record AppSettingsPreviewDto(
    int TotalMembers, int PaidMembers, int InTrialMembers, int TrialOverMembers);

/// <summary>GET /api/app-settings.</summary>
public sealed record AppSettingsDto(
    bool IsTrialEnabled, int TrialDays, string? UpdatedByGiftName, DateTime? UpdatedDate,
    IReadOnlyList<AppSettingsFeatureDto> Features, AppSettingsPreviewDto Preview);

/// <summary>PUT /api/app-settings. Features not listed are closed after the trial.</summary>
public sealed record UpdateAppSettingsRequest(bool IsTrialEnabled, int TrialDays, string[] OpenFeatureKeys);
