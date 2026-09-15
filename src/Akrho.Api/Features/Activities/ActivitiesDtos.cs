namespace Akrho.Api.Features.Activities;

/// <summary>
/// FundedTotal/SpentTotal are the ONLY totals this DTO ever carries — both are whole-activity
/// rollups (docs §4.6: "the Clean-Up Drive received ₱15,000 and spent ₱12,400"). Never per
/// donor, never per member (CLAUDE.md invariant #5's texture).
/// </summary>
public sealed record ActivityListItemDto(
    int ActivityId, string ActivityName, DateOnly? ActivityDate, string? Description,
    bool IsClosed, decimal FundedTotal, decimal SpentTotal);

public sealed record CreateActivityRequest(string Name, string? Description, DateOnly? ActivityDate);

public sealed record ActivityCreatedDto(int ActivityId);

public sealed record ActivityListRequest(int Skip = 0, int Take = 50);
