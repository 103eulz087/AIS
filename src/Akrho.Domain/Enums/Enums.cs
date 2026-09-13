namespace Akrho.Domain.Enums;

public enum EntryType { In, Out }

/// <summary>Annual renewal state. <c>Lapsed</c> is NOT a disciplinary state:
/// the brother keeps his record, his number and his history, and may renew in any later year.</summary>
public enum RenewalStatus { Renewed, Lapsed, Exempt }

public enum RenewalApplicationStatus { Draft, Submitted, Returned, Approved }

public enum AttendanceStatus { Present, Late, Excused, Absent }

/// <summary>How confident the system is that a scanned card is currently valid.
/// <c>Offline</c> must never be presented to the user as <c>Live</c>.</summary>
public enum VerificationResult { Live, Offline, Invalid, Revoked, Expired }

public enum CorrectiveActionStatus { Pending, UnderReview, Reconciled, Dismissed }

public enum ScopeType { Chapter, Council, Global }
