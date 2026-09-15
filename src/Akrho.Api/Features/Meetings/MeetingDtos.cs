namespace Akrho.Api.Features.Meetings;

/// <summary>
/// One row of the chapter's meeting list. CollectionTotal is the ONLY permitted FundAmount
/// aggregate here — the total for THIS meeting alone, never across meetings, never per member
/// (CLAUDE.md invariant #5).
/// </summary>
public sealed record MeetingListItemDto(
    int MeetingId, string Subject, DateOnly MeetingDate, string? Location,
    bool IsFinalized, DateTime? FinalizedDateUtc,
    decimal CollectionTotal, int PresentCount, int LateCount);

/// <summary>
/// One member's attendance for one meeting. AttendanceStatusId, FundAmount and CheckedInAtUtc
/// are all nullable together and independently meaningful: null means "nobody has recorded him
/// yet" for this meeting — a real, distinct state from "recorded as absent" or "recorded as
/// ₱0". Never default FundAmount to 0 here; that would erase the distinction.
/// </summary>
public sealed record AttendanceRowDto(
    int MemberId, string GiftName, string MemberNumber, string StatusName,
    int? AttendanceStatusId, decimal? FundAmount, DateTime? CheckedInAtUtc);

/// <summary>One occurrence of a finalized meeting being reopened. Visible to the whole chapter.</summary>
public sealed record MeetingReopenDto(
    int MeetingReopenId, int ReopenedBy, DateTime ReopenedDateUtc, string Reason,
    int? ReversedLedgerEntryId);

/// <summary>The full meeting: header, attendance sheet, and its reopen/correction trail.</summary>
public sealed record MeetingDetailDto(
    int MeetingId, int ChapterId, string Subject, DateOnly MeetingDate, string? Body, string? Location,
    bool IsFinalized, int? FinalizedBy, DateTime? FinalizedDateUtc, int CreatedBy, DateTime CreatedDateUtc,
    int? LedgerEntryId, bool LedgerEntryIsReversed,
    IReadOnlyList<AttendanceRowDto> Attendance, IReadOnlyList<MeetingReopenDto> ReopenHistory);

public sealed record MeetingCreatedDto(int MeetingId);

public sealed record CreateMeetingRequest(string Subject, DateOnly MeetingDate, string? Location, string? Body);

public sealed record UpdateMeetingRequest(string Subject, DateOnly MeetingDate, string? Location, string? Body);

/// <summary>
/// One attendance-sheet row on the way in. FundAmount has exactly one rule: it may not be
/// negative. There is no upper bound and no comparison to any "expected" or "suggested"
/// amount — contributions are voluntary (CLAUDE.md invariant #5).
/// </summary>
public sealed record SaveAttendanceRowRequest(int MemberId, int AttendanceStatusId, decimal FundAmount, string? CheckedInVia);

public sealed record SaveAttendanceRequest(IReadOnlyList<SaveAttendanceRowRequest> Rows, bool Finalize);

public sealed record SaveAttendanceResponseDto(int MeetingId, int RowsSaved, bool Finalized, int? LedgerEntryId);

public sealed record ReopenMeetingRequest(string Reason);

/// <summary>ReversedLedgerEntryId is null when the meeting's collection total was zero — nothing had been posted.</summary>
public sealed record ReopenMeetingResponseDto(int MeetingId, int? ReversedLedgerEntryId);

public sealed record MeetingListRequest(int Skip = 0, int Take = 50);
