using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum MembershipApplicationErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when a MembershipApplication stored procedure rejects a call. Every message on
/// these THROWs was written in the procedure specifically to reach the applicant or the
/// chapter admin reading the screen — surface it plainly at the endpoint, never wrap it in
/// something generic (same convention as MeetingException).
/// </summary>
public sealed class MembershipApplicationException : Exception
{
    public MembershipApplicationErrorCategory Category { get; }

    public MembershipApplicationException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Application not found" — thrown identically for a nonexistent id and, on
            // usp_MembershipApplication_Get, for an application belonging to a chapter the
            // caller does not administer. Deliberate anti-enumeration; do not split this case.
            51218 or 51222 or 51223 or 51230 or 51234
                => MembershipApplicationErrorCategory.NotFound,

            // The resource's state changed under the caller (already decided, not open for
            // resubmission, a chapter config gap that blocks approval) — nothing about the
            // request itself was invalid.
            51219 or 51225 or 51227 or 51228 or 51231 or 51235
                => MembershipApplicationErrorCategory.Conflict,

            // Role/chapter checks the procedure itself enforces, in addition to
            // ChapterMembershipApprove and IScopeGuard (defence in depth, CLAUDE.md #4).
            51221 or 51224 or 51232 or 51236
                => MembershipApplicationErrorCategory.Forbidden,

            // A malformed payload: a bad chapter, an impossible birthdate, an unresolved
            // seconder, or a reason under 10 characters.
            51216 or 51217 or 51220 or 51226 or 51229 or 51233
                => MembershipApplicationErrorCategory.BadRequest,

            _ => MembershipApplicationErrorCategory.BadRequest
        };
    }
}

/// <summary>
/// The complete set of custom THROW numbers used by the MembershipApplication procs.
/// Anything else — a timeout, a deadlock, a dropped connection — is a real unexpected error
/// and must NOT be re-surfaced as a safe, human-authored message; it is left to propagate to
/// the generic 500 handler instead (CLAUDE.md: never leak an exception message to the client).
/// </summary>
internal static class MembershipApplicationErrors
{
    private static readonly HashSet<int> Known =
    [
        51216, 51217, 51218, 51219, 51220, 51221, 51222, 51223, 51224, 51225,
        51226, 51227, 51228, 51229, 51230, 51231, 51232, 51233, 51234, 51235, 51236
    ];

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// The applicant-facing view of one application (usp_MembershipApplication_GetByReference /
/// _Resubmit's identification pair). Dates come back as raw DateTime from SQL DATE columns —
/// the API layer converts to DateOnly, same convention MeetingRepository uses for MeetingDate.
/// </summary>
public sealed record MembershipApplicationStatusRow(
    int ApplicationId, string ReferenceNo, int ChapterId, string ChapterName,
    string FirstName, string? MiddleName, string LastName, string GiftName, DateTime BirthDate,
    string MobileNo, string? Email, DateTime? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    string SeconderNameGiven, string? SeconderMemberNumberGiven,
    int StatusId, string StatusName, DateTime SubmittedDate, string? DecisionReason);

public sealed record MembershipApplicationResubmitResultRow(int ApplicationId, string ReferenceNo, int StatusId);

/// <summary>One row of a chapter admin's own review queue. TotalCount is COUNT(*) OVER() — the
/// same "read it off row zero, or zero if the page came back empty" shape as MeetingListRow.</summary>
public sealed record MembershipApplicationQueueRow(
    int ApplicationId, string ReferenceNo, string FirstName, string? MiddleName, string LastName,
    string GiftName, string MobileNo, string? Email, int StatusId, string StatusName,
    DateTime SubmittedDate, int? DecidedBy, DateTime? DecidedDate, int TotalCount);

/// <summary>
/// The full application, for the chapter admin reviewing it. SeconderResolvedGiftName /
/// SeconderResolvedMemberNumber are populated only once SeconderMemberId has been set — never
/// coalesced away, that distinction ("nobody has confirmed the seconder yet") is meaningful.
/// </summary>
public sealed record MembershipApplicationRow(
    int ApplicationId, string ReferenceNo, int ChapterId,
    string FirstName, string? MiddleName, string LastName, string GiftName, DateTime BirthDate,
    string MobileNo, string? Email, DateTime? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    string SeconderNameGiven, string? SeconderMemberNumberGiven, int? SeconderMemberId,
    string? SeconderResolvedGiftName, string? SeconderResolvedMemberNumber,
    int StatusId, string StatusName, DateTime SubmittedDate,
    int? DecidedBy, DateTime? DecidedDate, string? DecisionReason, int? CreatedMemberId);

/// <summary>One status change, oldest first — the submitted → returned → resubmitted → approved timeline.</summary>
public sealed record MembershipApplicationUpdateRow(
    int MembershipApplicationUpdateId, DateTime UpdateDate, int? UpdatedBy, int StatusId, string StatusName, string? Notes);

/// <summary>A prior CLOSED application from the same mobile number — the applicant's own history,
/// not another member's data, so it is not restricted by CLAUDE.md invariant #7 (see the proc's own comment).</summary>
public sealed record MembershipApplicationPriorRow(
    int ApplicationId, string ReferenceNo, int ChapterId, string ChapterName,
    int StatusId, string StatusName, DateTime SubmittedDate, DateTime? DecidedDate, string? DecisionReason);

public sealed record MembershipApplicationDetailRows(
    MembershipApplicationRow Application,
    IReadOnlyList<MembershipApplicationUpdateRow> History,
    IReadOnlyList<MembershipApplicationPriorRow> PriorApplications);

/// <summary>
/// ExpiresOn is the enrolment link's expiry — the raw token itself never crosses this
/// boundary; only its hash went IN as a parameter, and nothing token-shaped comes back OUT.
/// </summary>
public sealed record MembershipApplicationApproveResultRow(int MemberId, string MemberNumber, int LinkId, DateTime ExpiresOn);

public sealed record MembershipApplicationDecisionResultRow(int ApplicationId, int StatusId);

public interface IMembershipApplicationRepository
{
    /// <summary>
    /// Public, unauthenticated. Idempotent on double-submit: a second submission with the
    /// same chapter + mobile while one is already open returns the SAME reference number,
    /// never an error — the caller treats this exactly like a fresh success.
    /// Throws <see cref="MembershipApplicationException"/> (BadRequest) for a bad chapter or
    /// an impossible birthdate.
    /// </summary>
    Task<string> SubmitAsync(
        int chapterId, string firstName, string? middleName, string lastName, string giftName,
        DateOnly birthDate, string mobileNo, string? email, DateOnly? dateSurvive,
        string? presidentDuringSurvive, string? masterInitiatorDuringSurvive,
        string seconderNameGiven, string? seconderMemberNumberGiven, CancellationToken ct);

    /// <summary>
    /// Public, unauthenticated. Both referenceNo and mobileNo must match the SAME row; returns
    /// null (an empty result set, not an error) when either is wrong — the API must not
    /// distinguish which.
    /// </summary>
    Task<MembershipApplicationStatusRow?> GetByReferenceAsync(string referenceNo, string mobileNo, CancellationToken ct);

    /// <summary>
    /// Public, unauthenticated. Only works from ReturnedForCorrection. Throws
    /// <see cref="MembershipApplicationException"/> (NotFound / BadRequest / Conflict).
    /// </summary>
    Task<MembershipApplicationResubmitResultRow> ResubmitAsync(
        string referenceNo, string mobileNo, string firstName, string? middleName, string lastName,
        string giftName, DateOnly birthDate, string? email, DateOnly? dateSurvive,
        string? presidentDuringSurvive, string? masterInitiatorDuringSurvive,
        string seconderNameGiven, string? seconderMemberNumberGiven, CancellationToken ct);

    /// <summary>
    /// ChapterAdmin only — chapterId is ALWAYS the caller's own (ICurrentUser.ChapterId), never
    /// a request parameter. Throws <see cref="MembershipApplicationException"/> (Forbidden) if
    /// the caller does not hold that role there — defence in depth alongside the endpoint policy.
    /// </summary>
    Task<IReadOnlyList<MembershipApplicationQueueRow>> GetQueueAsync(
        int chapterId, int requestingMemberId, int? statusId, int skip, int take, CancellationToken ct);

    /// <summary>
    /// ChapterAdmin only, scoped to the application's own chapter internally by the procedure.
    /// Throws <see cref="MembershipApplicationException"/> (NotFound) — same message for a bad
    /// id or an application belonging to a chapter the caller does not administer.
    /// </summary>
    Task<MembershipApplicationDetailRows> GetAsync(int applicationId, int requestingMemberId, CancellationToken ct);

    /// <summary>
    /// ChapterAdmin only. The ONLY INSERT path into dbo.Member in this codebase. Only the
    /// TOKEN HASH is passed in — the raw token never reaches this layer's callers except as
    /// the value the endpoint itself generated a moment earlier and must not log or persist.
    /// Throws <see cref="MembershipApplicationException"/> (NotFound / Conflict / Forbidden / BadRequest).
    /// </summary>
    Task<MembershipApplicationApproveResultRow> ApproveAsync(
        int applicationId, int requestingMemberId, int? seconderMemberId,
        byte[] tokenHash, DateTime? expiresOn, CancellationToken ct);

    /// <summary>ChapterAdmin only. Throws <see cref="MembershipApplicationException"/> (NotFound / Conflict / Forbidden / BadRequest).</summary>
    Task<MembershipApplicationDecisionResultRow> ReturnAsync(int applicationId, int requestingMemberId, string reason, CancellationToken ct);

    /// <summary>ChapterAdmin only. Throws <see cref="MembershipApplicationException"/> (NotFound / Conflict / Forbidden / BadRequest).</summary>
    Task<MembershipApplicationDecisionResultRow> RejectAsync(int applicationId, int requestingMemberId, string reason, CancellationToken ct);
}

public sealed class MembershipApplicationRepository(ISqlConnectionFactory factory) : IMembershipApplicationRepository
{
    public async Task<string> SubmitAsync(
        int chapterId, string firstName, string? middleName, string lastName, string giftName,
        DateOnly birthDate, string mobileNo, string? email, DateOnly? dateSurvive,
        string? presidentDuringSurvive, string? masterInitiatorDuringSurvive,
        string seconderNameGiven, string? seconderMemberNumberGiven, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var referenceNo = await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
                "dbo.usp_MembershipApplication_Submit",
                new
                {
                    ChapterId = chapterId,
                    FirstName = firstName,
                    MiddleName = middleName,
                    LastName = lastName,
                    GiftName = giftName,
                    BirthDate = birthDate.ToDateTime(TimeOnly.MinValue),
                    MobileNo = mobileNo,
                    Email = email,
                    DateSurvive = dateSurvive?.ToDateTime(TimeOnly.MinValue),
                    PresidentDuringSurvive = presidentDuringSurvive,
                    MasterInitiatorDuringSurvive = masterInitiatorDuringSurvive,
                    SeconderNameGiven = seconderNameGiven,
                    SeconderMemberNumberGiven = seconderMemberNumberGiven
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            // usp_MembershipApplication_Submit always SELECTs a ReferenceNo — either the one
            // it just inserted, or the existing one on a double-submit. Null here would mean
            // the procedure's own contract broke, not a normal outcome to swallow.
            return referenceNo ?? throw new InvalidOperationException(
                "usp_MembershipApplication_Submit returned no ReferenceNo.");
        }
        catch (SqlException ex) when (MembershipApplicationErrors.IsKnown(ex.Number))
        {
            throw new MembershipApplicationException(ex.Number, ex.Message);
        }
    }

    public async Task<MembershipApplicationStatusRow?> GetByReferenceAsync(string referenceNo, string mobileNo, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<MembershipApplicationStatusRow>(new CommandDefinition(
            "dbo.usp_MembershipApplication_GetByReference",
            new { ReferenceNo = referenceNo, MobileNo = mobileNo },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }

    public async Task<MembershipApplicationResubmitResultRow> ResubmitAsync(
        string referenceNo, string mobileNo, string firstName, string? middleName, string lastName,
        string giftName, DateOnly birthDate, string? email, DateOnly? dateSurvive,
        string? presidentDuringSurvive, string? masterInitiatorDuringSurvive,
        string seconderNameGiven, string? seconderMemberNumberGiven, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<MembershipApplicationResubmitResultRow>(new CommandDefinition(
                "dbo.usp_MembershipApplication_Resubmit",
                new
                {
                    ReferenceNo = referenceNo,
                    MobileNo = mobileNo,
                    FirstName = firstName,
                    MiddleName = middleName,
                    LastName = lastName,
                    GiftName = giftName,
                    BirthDate = birthDate.ToDateTime(TimeOnly.MinValue),
                    Email = email,
                    DateSurvive = dateSurvive?.ToDateTime(TimeOnly.MinValue),
                    PresidentDuringSurvive = presidentDuringSurvive,
                    MasterInitiatorDuringSurvive = masterInitiatorDuringSurvive,
                    SeconderNameGiven = seconderNameGiven,
                    SeconderMemberNumberGiven = seconderMemberNumberGiven
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MembershipApplicationErrors.IsKnown(ex.Number))
        {
            throw new MembershipApplicationException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<MembershipApplicationQueueRow>> GetQueueAsync(
        int chapterId, int requestingMemberId, int? statusId, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<MembershipApplicationQueueRow>(new CommandDefinition(
                "dbo.usp_MembershipApplication_GetQueue",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    StatusId = statusId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 500)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (MembershipApplicationErrors.IsKnown(ex.Number))
        {
            throw new MembershipApplicationException(ex.Number, ex.Message);
        }
    }

    public async Task<MembershipApplicationDetailRows> GetAsync(int applicationId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_MembershipApplication_Get",
                new { ApplicationId = applicationId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var application = await multi.ReadSingleAsync<MembershipApplicationRow>();
            var history = (await multi.ReadAsync<MembershipApplicationUpdateRow>()).ToList();
            var prior = (await multi.ReadAsync<MembershipApplicationPriorRow>()).ToList();

            return new MembershipApplicationDetailRows(application, history, prior);
        }
        catch (SqlException ex) when (MembershipApplicationErrors.IsKnown(ex.Number))
        {
            throw new MembershipApplicationException(ex.Number, ex.Message);
        }
    }

    public async Task<MembershipApplicationApproveResultRow> ApproveAsync(
        int applicationId, int requestingMemberId, int? seconderMemberId,
        byte[] tokenHash, DateTime? expiresOn, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<MembershipApplicationApproveResultRow>(new CommandDefinition(
                "dbo.usp_MembershipApplication_Approve",
                new
                {
                    ApplicationId = applicationId,
                    RequestingMemberId = requestingMemberId,
                    SeconderMemberId = seconderMemberId,
                    TokenHash = tokenHash,
                    ExpiresOn = expiresOn
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MembershipApplicationErrors.IsKnown(ex.Number))
        {
            throw new MembershipApplicationException(ex.Number, ex.Message);
        }
    }

    public async Task<MembershipApplicationDecisionResultRow> ReturnAsync(
        int applicationId, int requestingMemberId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<MembershipApplicationDecisionResultRow>(new CommandDefinition(
                "dbo.usp_MembershipApplication_Return",
                new { ApplicationId = applicationId, RequestingMemberId = requestingMemberId, Reason = reason },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MembershipApplicationErrors.IsKnown(ex.Number))
        {
            throw new MembershipApplicationException(ex.Number, ex.Message);
        }
    }

    public async Task<MembershipApplicationDecisionResultRow> RejectAsync(
        int applicationId, int requestingMemberId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<MembershipApplicationDecisionResultRow>(new CommandDefinition(
                "dbo.usp_MembershipApplication_Reject",
                new { ApplicationId = applicationId, RequestingMemberId = requestingMemberId, Reason = reason },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (MembershipApplicationErrors.IsKnown(ex.Number))
        {
            throw new MembershipApplicationException(ex.Number, ex.Message);
        }
    }
}
