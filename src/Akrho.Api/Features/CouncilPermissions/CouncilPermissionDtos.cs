namespace Akrho.Api.Features.CouncilPermissions;

/// <summary>Header of the grid — CanEdit is whether the CALLER himself holds a currently-
/// seated PRESIDING office on this EXACT council (never a parent's President, never a
/// lower seat).</summary>
public sealed record CouncilPermissionHeaderDto(int CouncilId, string CouncilName, bool IsNational, bool CanEdit);

/// <summary>One council office — a row of the grid.</summary>
public sealed record CouncilPermissionOfficeDto(int Id, string Name, bool IsPresiding, bool IsReadOnly);

/// <summary>One grantable, active permission key — a column of the grid. RequiresKey, when
/// present, names another key that must also be granted on the same office (enforced by
/// usp_CouncilPermission_Set's own 51936).</summary>
public sealed record CouncilPermissionKeyDto(
    string PermissionKey, string DisplayName, string? Description, bool IsWrite, bool IsNationalOnly,
    string? RequiresKey, int SortOrder);

/// <summary>One (office, key) cell. IsLocked/LockReason, when set, mean this cell cannot be
/// changed at all (e.g. the presiding office's own fixed grant) — the frontend should
/// disable the control rather than let the user submit a no-op change.</summary>
public sealed record CouncilPermissionCellDto(
    int CouncilOfficeId, string PermissionKey, bool IsGranted, bool IsDefault, bool IsLocked, string? LockReason);

/// <summary>One of the last 50 changes made to this council's grid, newest first.</summary>
public sealed record CouncilPermissionHistoryDto(
    long HistoryId, int CouncilOfficeId, string OfficeName, string PermissionKey,
    bool WasGranted, bool IsGranted, int ChangedBy, string ChangedByGiftName, DateTime ChangedDateUtc, string? Reason);

/// <summary>GET /api/councils/{councilId}/permissions. Visibility matches
/// usp_Council_GetRoster/usp_Council_GetRegistry — anyone inside the caller's own council
/// scope may VIEW this grid, even if <see cref="CouncilPermissionHeaderDto.CanEdit"/> is false.</summary>
public sealed record CouncilPermissionGridDto(
    CouncilPermissionHeaderDto Header,
    IReadOnlyList<CouncilPermissionOfficeDto> Offices,
    IReadOnlyList<CouncilPermissionKeyDto> Permissions,
    IReadOnlyList<CouncilPermissionCellDto> Cells,
    IReadOnlyList<CouncilPermissionHistoryDto> History);

/// <summary>One requested cell change. The server computes the actual diff against the
/// current effective grant and silently skips any change that would be a no-op — submitting
/// the whole visible grid state back is safe, not just a minimal diff.</summary>
public sealed record CouncilPermissionChangeDto(int CouncilOfficeId, string PermissionKey, bool IsGranted);

/// <summary>PUT /api/councils/{councilId}/permissions. Only the council's OWN currently-
/// seated President may call this — CLAUDE.md invariant #4: councilId is a target the
/// procedure re-derives standing for, never trusted on its own.</summary>
public sealed record UpdateCouncilPermissionsRequest(IReadOnlyList<CouncilPermissionChangeDto> Changes, string? Reason);

public sealed record UpdateCouncilPermissionsResponseDto(int ChangedCount);
