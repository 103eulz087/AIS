using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum ChapterRegistrationErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when a ChapterRegistration stored procedure rejects a call. Every message on these
/// THROWs was written in the procedure specifically to reach the applicant, the chapter's own
/// Chapter Admin, or the reviewing council officer — surface it plainly at the endpoint, never
/// wrap it in something generic (same convention as MembershipApplicationException).
/// </summary>
public sealed class ChapterRegistrationException : Exception
{
    public ChapterRegistrationErrorCategory Category { get; }

    public ChapterRegistrationException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Not found" — a nonexistent id/reference, or (Get/Return/VerifyOfficer/Approve)
            // a registration outside the caller's own council-ancestor scope. Deliberate
            // anti-enumeration on Get, mirroring usp_MembershipApplication_Get; the same
            // message covers both cases so neither can be probed apart from the other.
            51530 or 51540 or 51551 or 51560 or 51578
                => ChapterRegistrationErrorCategory.NotFound,

            // The resource's own state blocks the action (already decided, not currently
            // awaiting verification/correction, not every officer verified yet) — nothing
            // about the request itself was invalid.
            51514 or 51541 or 51552 or 51561 or 51563 or 51579
                => ChapterRegistrationErrorCategory.Conflict,

            // Role/council-seat checks the procedure itself enforces, in addition to the
            // ChapterOfficerRosterFile / CouncilChapterRegistrationVerify / *Approve policies
            // and IScopeGuard (defence in depth, CLAUDE.md invariant #4).
            51510 or 51520 or 51542 or 51553 or 51562
                => ChapterRegistrationErrorCategory.Forbidden,

            // A malformed payload: a bad proposed name/geography/accent, a wrong officer
            // count/unrecognized office, a missing mobile or impossible birthdate, an
            // incoming turnover officer who is not an existing approved/active chapter
            // member, a too-short return reason, or (Approve/Turnover) a missing token hash
            // for an incoming officer who needs a brand-new account.
            51500 or 51501 or 51502 or 51503 or 51504 or 51505 or 51506 or 51507
                or 51511 or 51512 or 51513
                or 51550 or 51564
                or 51570 or 51571 or 51572 or 51573 or 51574 or 51575 or 51576 or 51577
                => ChapterRegistrationErrorCategory.BadRequest,

            _ => ChapterRegistrationErrorCategory.BadRequest
        };
    }
}

/// <summary>
/// The complete set of custom THROW numbers used by the ChapterRegistration procs. Anything
/// else — a timeout, a deadlock, a dropped connection — is a real unexpected error and must NOT
/// be re-surfaced as a safe, human-authored message; it is left to propagate to the generic 500
/// handler instead (CLAUDE.md: never leak an exception message to the client).
/// </summary>
internal static class ChapterRegistrationErrors
{
    private static readonly HashSet<int> Known =
    [
        51500, 51501, 51502, 51503, 51504, 51505, 51506, 51507,
        51510, 51511, 51512, 51513, 51514,
        51520,
        51530,
        51540, 51541, 51542,
        51550, 51551, 51552, 51553,
        51560, 51561, 51562, 51563, 51564,
        51570, 51571, 51572, 51573, 51574, 51575, 51576, 51577, 51578, 51579
    ];

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>One Charter officer, exactly as typed in on the public petition form — no MemberId,
/// nobody exists yet. Column order/types must match dbo.ChapterCharterOfficerRow (db/procs/00_types.sql)
/// exactly — verified against that file directly, not guessed.</summary>
public sealed record ChapterCharterOfficerInput(
    int OfficeId, string FirstName, string? MiddleName, string LastName, string GiftName,
    DateOnly BirthDate, string MobileNo, string? Email, DateOnly? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive);

/// <summary>One Turnover officer — a bare (office, existing member) pair, matching
/// dbo.ChapterTurnoverOfficerRow exactly.</summary>
public sealed record ChapterTurnoverOfficerInput(int OfficeId, int MemberId);

/// <summary>The public "check my registration" view (usp_ChapterRegistration_GetByReference).
/// Never carries the officer roster — see that procedure's own header comment.</summary>
public sealed record ChapterRegistrationStatusRow(
    int RegistrationId, string ReferenceNo, string RegistrationType,
    string? ProposedChapterName, int? ChapterId, string? ChapterName,
    int StatusId, string StatusName, DateTime SubmittedDate,
    DateTime? DecidedDate, string? DecisionReason,
    int ActingCouncilId, string ActingCouncilName);

public sealed record ChapterRegistrationResubmitResultRow(int RegistrationId, string ReferenceNo, int StatusId);

/// <summary>One row of a council officer's own registration queue. TotalCount is COUNT(*) OVER()
/// — read it off row zero, or zero if the page came back empty, same shape as MeetingListRow /
/// MembershipApplicationQueueRow. CanAct is a DISPLAY convenience only — VerifyOfficer/Return/
/// Approve each re-check the caller's own council seat independently; never treat this flag
/// itself as a permission boundary (usp_ChapterRegistration_GetQueue's own header comment).</summary>
public sealed record ChapterRegistrationQueueRow(
    int RegistrationId, string ReferenceNo, string RegistrationType, string? ProposedChapterName,
    int? ChapterId, string? ChapterName, int StatusId, string StatusName, DateTime SubmittedDate,
    int ActingCouncilId, string ActingCouncilName, int? IntendedCouncilId, string RoutingReason,
    int? DecidedBy, DateTime? DecidedDate, bool CanAct, int TotalCount);

/// <summary>One of the eight seats on a registration, resolved identity included — COALESCE over
/// the Member row for a Turnover seat, or the typed-in columns for a Charter seat (never both
/// populated, by CK_ChapterRegistrationOfficer_Person).</summary>
public sealed record ChapterRegistrationOfficerRow(
    int RegistrationOfficerId, int OfficeId, string OfficeName, int SortOrder, bool GrantsLogin,
    int? MemberId, string? MemberNumber,
    string FirstName, string? MiddleName, string LastName, string GiftName, DateTime BirthDate,
    string MobileNo, string? Email, DateTime? DateSurvive,
    string? PresidentDuringSurvive, string? MasterInitiatorDuringSurvive,
    int? VerifiedBy, string? VerifiedByGiftName, DateTime? VerifiedDate, string? VerifyNote,
    int? CreatedMemberId);

/// <summary>One status change, oldest first.</summary>
public sealed record ChapterRegistrationUpdateRow(
    int ChapterRegistrationUpdateId, DateTime UpdateDate, int? UpdatedBy, int StatusId, string StatusName, string? Notes);

/// <summary>The dbo.ApprovalRouting row for this registration, if one exists (0 or 1 row).</summary>
public sealed record ChapterRegistrationRoutingRow(
    int RoutingId, int? IntendedCouncilId, int ActingCouncilId, string RoutingReason,
    int? ActorMemberId, DateTime ActedOn, string? Remarks);

/// <summary>The registration header, for a council officer reviewing it — never shown to the
/// wider membership (this is the officer/reviewer view, CorrectiveActionFullDto's reasoning).</summary>
public sealed record ChapterRegistrationRow(
    int RegistrationId, string ReferenceNo, string RegistrationType, int? ChapterId, string? ChapterName,
    string? ProposedChapterName, string? Barangay, int? RegionId, int? ProvinceId, int? MunicipalityId,
    int? MarkAccentId, string? AccentName, string? HexValue,
    int? IntendedCouncilId, string? IntendedCouncilName,
    int ActingCouncilId, string ActingCouncilName, string RoutingReason,
    int? SubmittedByMemberId, string? SubmittedByGiftName,
    DateTime SubmittedDate, int StatusId, string StatusName, bool IsOpen,
    int? DecidedBy, string? DecidedByGiftName, DateTime? DecidedDate, string? DecisionReason,
    int? CreatedChapterId);

public sealed record ChapterRegistrationDetailRows(
    ChapterRegistrationRow Header,
    IReadOnlyList<ChapterRegistrationOfficerRow> Officers,
    IReadOnlyList<ChapterRegistrationUpdateRow> History,
    ChapterRegistrationRoutingRow? Routing);

public sealed record ChapterRegistrationVerifyResultRow(int RegistrationOfficerId, bool Verified);

public sealed record ChapterRegistrationDecisionResultRow(int RegistrationId, int StatusId);

/// <summary>The Charter branch of usp_ChapterRegistration_Approve's result — the brand-new
/// chapter and its President's SHOW-ONCE enrolment link (the raw token itself never reaches this
/// layer; only its hash went IN, and only LinkId/ExpiresOn come back OUT — the endpoint layer is
/// the one place that ever holds the raw value, exactly like MembershipApplicationApproveResultRow).</summary>
public sealed record ChapterRegistrationCharterApproveResultRow(
    int ChapterId, int PresidentMemberId, string MemberNumberPrefix, int PresidentLinkId, DateTime PresidentLinkExpiresOn);

/// <summary>One newly-enrolled incoming Turnover officer's SHOW-ONCE link. An officer who
/// already held an account gets no row here at all — no link is issued to him.</summary>
public sealed record ChapterRegistrationTurnoverEnrolResultRow(int MemberId, int LinkId, DateTime ExpiresOn);

/// <summary>
/// usp_ChapterRegistration_Approve's result branches entirely on RegistrationType — exactly one
/// of <see cref="Charter"/> / <see cref="TurnoverChapterId"/>+<see cref="TurnoverEnrolments"/> is
/// populated, matching the two result shapes described in the procedure's own header.
/// </summary>
public sealed record ChapterRegistrationApproveResult(
    string RegistrationType,
    ChapterRegistrationCharterApproveResultRow? Charter,
    int? TurnoverChapterId,
    IReadOnlyList<ChapterRegistrationTurnoverEnrolResultRow>? TurnoverEnrolments);

public interface IChapterRegistrationRepository
{
    /// <summary>
    /// Public, unauthenticated charter petition. Idempotent on double-submit — a genuine
    /// concurrent resubmission for the same (municipality, proposed name) returns the SAME
    /// reference number, never an error. Throws <see cref="ChapterRegistrationException"/>
    /// (BadRequest) for a bad name/geography/accent, wrong officer coverage, a missing mobile,
    /// or an impossible birthdate.
    /// </summary>
    Task<string> SubmitAsync(
        string proposedChapterName, string? barangay, int regionId, int provinceId, int municipalityId,
        int? markAccentId, IReadOnlyList<ChapterCharterOfficerInput> officers, CancellationToken ct);

    /// <summary>
    /// Public, unauthenticated. Both referenceNo and mobileNo must match the SAME row's current
    /// President seat; returns null (an empty result set, not an error) when either is wrong —
    /// the API must not distinguish which. Never returns the officer roster.
    /// </summary>
    Task<ChapterRegistrationStatusRow?> GetByReferenceAsync(string referenceNo, string mobileNo, CancellationToken ct);

    /// <summary>
    /// Public, unauthenticated. Only works from ReturnedForCorrection, keyed by the CURRENT
    /// (pre-correction) President's own mobile number. Throws
    /// <see cref="ChapterRegistrationException"/> (NotFound / BadRequest / Conflict).
    /// </summary>
    Task<ChapterRegistrationResubmitResultRow> ResubmitAsync(
        string referenceNo, string mobileNo, string proposedChapterName, string? barangay,
        int regionId, int provinceId, int municipalityId, int? markAccentId,
        IReadOnlyList<ChapterCharterOfficerInput> officers, CancellationToken ct);

    /// <summary>
    /// ChapterAdmin only — requestingMemberId is ALWAYS the caller's own id (ICurrentUser.MemberId),
    /// never a request parameter; @ChapterId is re-derived server-side from his own currently-
    /// seated ChapterAdmin role. Transparently handles resubmission of a ReturnedForCorrection
    /// turnover in place. Throws <see cref="ChapterRegistrationException"/> (Forbidden / BadRequest / Conflict).
    /// </summary>
    Task<string> SubmitTurnoverAsync(
        int requestingMemberId, IReadOnlyList<ChapterTurnoverOfficerInput> officers, CancellationToken ct);

    /// <summary>
    /// Scoped server-side to councils the caller currently holds a seat on (plus their
    /// subtrees, read-only). Throws <see cref="ChapterRegistrationException"/> (Forbidden) if he
    /// holds no council seat at all.
    /// </summary>
    Task<IReadOnlyList<ChapterRegistrationQueueRow>> GetQueueAsync(
        int requestingMemberId, int? statusId, int skip, int take, CancellationToken ct);

    /// <summary>
    /// Scoped to the registration's ActingCouncilId or any of its ancestors. Throws
    /// <see cref="ChapterRegistrationException"/> (NotFound) — same message for a nonexistent id
    /// and one outside the caller's scope (anti-enumeration).
    /// </summary>
    Task<ChapterRegistrationDetailRows> GetAsync(int registrationId, int requestingMemberId, CancellationToken ct);

    /// <summary>
    /// CouncilSecretary or CouncilAdmin, seated on the registration's own ActingCouncilId.
    /// Cannot touch any roster field — only VerifiedBy/VerifiedDate/VerifyNote. Throws
    /// <see cref="ChapterRegistrationException"/> (NotFound / Conflict / Forbidden).
    /// </summary>
    Task<ChapterRegistrationVerifyResultRow> VerifyOfficerAsync(
        int registrationOfficerId, int requestingMemberId, bool verified, string? note, CancellationToken ct);

    /// <summary>
    /// CouncilSecretary or CouncilAdmin. Clears every officer's verification tick. Throws
    /// <see cref="ChapterRegistrationException"/> (NotFound / Conflict / Forbidden / BadRequest).
    /// </summary>
    Task<ChapterRegistrationDecisionResultRow> ReturnAsync(
        int registrationId, int requestingMemberId, string reason, CancellationToken ct);

    /// <summary>
    /// CouncilAdmin only. THROWs with a live "(N of 8 verified)" count if not every officer is
    /// verified yet. Pass an empty <paramref name="turnoverTokenHashes"/> for a Charter
    /// registration (only <paramref name="tokenHash"/> is used there); for a Turnover, one
    /// (MemberId, TokenHash) pair per incoming officer who needs a brand-new account. Only the
    /// token HASHES are passed in — the raw values never reach this layer's callers except as
    /// what the endpoint itself generated a moment earlier. Throws
    /// <see cref="ChapterRegistrationException"/> (NotFound / Conflict / Forbidden / BadRequest).
    /// </summary>
    Task<ChapterRegistrationApproveResult> ApproveAsync(
        int registrationId, string registrationType, int requestingMemberId,
        byte[]? tokenHash, DateTime? expiresOn,
        IReadOnlyDictionary<int, byte[]> turnoverTokenHashes, CancellationToken ct);
}

public sealed class ChapterRegistrationRepository(ISqlConnectionFactory factory) : IChapterRegistrationRepository
{
    private static DataTable CharterOfficerTable(IReadOnlyList<ChapterCharterOfficerInput> officers)
    {
        var table = new DataTable();
        table.Columns.Add("OfficeId", typeof(int));
        table.Columns.Add("FirstName", typeof(string));
        table.Columns.Add("MiddleName", typeof(string));
        table.Columns.Add("LastName", typeof(string));
        table.Columns.Add("GiftName", typeof(string));
        table.Columns.Add("BirthDate", typeof(DateTime));
        table.Columns.Add("MobileNo", typeof(string));
        table.Columns.Add("Email", typeof(string));
        table.Columns.Add("DateSurvive", typeof(DateTime));
        table.Columns.Add("PresidentDuringSurvive", typeof(string));
        table.Columns.Add("MasterInitiatorDuringSurvive", typeof(string));

        foreach (var o in officers)
            table.Rows.Add(
                o.OfficeId, o.FirstName, (object?)o.MiddleName ?? DBNull.Value, o.LastName, o.GiftName,
                o.BirthDate.ToDateTime(TimeOnly.MinValue), o.MobileNo, (object?)o.Email ?? DBNull.Value,
                (object?)o.DateSurvive?.ToDateTime(TimeOnly.MinValue) ?? DBNull.Value,
                (object?)o.PresidentDuringSurvive ?? DBNull.Value,
                (object?)o.MasterInitiatorDuringSurvive ?? DBNull.Value);

        return table;
    }

    private static DataTable TurnoverOfficerTable(IReadOnlyList<ChapterTurnoverOfficerInput> officers)
    {
        var table = new DataTable();
        table.Columns.Add("OfficeId", typeof(int));
        table.Columns.Add("MemberId", typeof(int));

        foreach (var o in officers)
            table.Rows.Add(o.OfficeId, o.MemberId);

        return table;
    }

    private static DataTable MemberTokenHashTable(IReadOnlyDictionary<int, byte[]> tokenHashes)
    {
        var table = new DataTable();
        table.Columns.Add("MemberId", typeof(int));
        table.Columns.Add("TokenHash", typeof(byte[]));

        foreach (var (memberId, hash) in tokenHashes)
            table.Rows.Add(memberId, hash);

        return table;
    }

    public async Task<string> SubmitAsync(
        string proposedChapterName, string? barangay, int regionId, int provinceId, int municipalityId,
        int? markAccentId, IReadOnlyList<ChapterCharterOfficerInput> officers, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var referenceNo = await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
                "dbo.usp_ChapterRegistration_Submit",
                new
                {
                    ProposedChapterName = proposedChapterName,
                    Barangay = barangay,
                    RegionId = regionId,
                    ProvinceId = provinceId,
                    MunicipalityId = municipalityId,
                    MarkAccentId = markAccentId,
                    Officers = CharterOfficerTable(officers).AsTableValuedParameter("dbo.ChapterCharterOfficerRow")
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            return referenceNo ?? throw new InvalidOperationException(
                "usp_ChapterRegistration_Submit returned no ReferenceNo.");
        }
        catch (SqlException ex) when (ChapterRegistrationErrors.IsKnown(ex.Number))
        {
            throw new ChapterRegistrationException(ex.Number, ex.Message);
        }
    }

    public async Task<ChapterRegistrationStatusRow?> GetByReferenceAsync(string referenceNo, string mobileNo, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<ChapterRegistrationStatusRow>(new CommandDefinition(
            "dbo.usp_ChapterRegistration_GetByReference",
            new { ReferenceNo = referenceNo, MobileNo = mobileNo },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));
    }

    public async Task<ChapterRegistrationResubmitResultRow> ResubmitAsync(
        string referenceNo, string mobileNo, string proposedChapterName, string? barangay,
        int regionId, int provinceId, int municipalityId, int? markAccentId,
        IReadOnlyList<ChapterCharterOfficerInput> officers, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChapterRegistrationResubmitResultRow>(new CommandDefinition(
                "dbo.usp_ChapterRegistration_Resubmit",
                new
                {
                    ReferenceNo = referenceNo,
                    MobileNo = mobileNo,
                    ProposedChapterName = proposedChapterName,
                    Barangay = barangay,
                    RegionId = regionId,
                    ProvinceId = provinceId,
                    MunicipalityId = municipalityId,
                    MarkAccentId = markAccentId,
                    Officers = CharterOfficerTable(officers).AsTableValuedParameter("dbo.ChapterCharterOfficerRow")
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChapterRegistrationErrors.IsKnown(ex.Number))
        {
            throw new ChapterRegistrationException(ex.Number, ex.Message);
        }
    }

    public async Task<string> SubmitTurnoverAsync(
        int requestingMemberId, IReadOnlyList<ChapterTurnoverOfficerInput> officers, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var referenceNo = await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
                "dbo.usp_ChapterRegistration_SubmitTurnover",
                new
                {
                    RequestingMemberId = requestingMemberId,
                    Officers = TurnoverOfficerTable(officers).AsTableValuedParameter("dbo.ChapterTurnoverOfficerRow")
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            return referenceNo ?? throw new InvalidOperationException(
                "usp_ChapterRegistration_SubmitTurnover returned no ReferenceNo.");
        }
        catch (SqlException ex) when (ChapterRegistrationErrors.IsKnown(ex.Number))
        {
            throw new ChapterRegistrationException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<ChapterRegistrationQueueRow>> GetQueueAsync(
        int requestingMemberId, int? statusId, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<ChapterRegistrationQueueRow>(new CommandDefinition(
                "dbo.usp_ChapterRegistration_GetQueue",
                new
                {
                    RequestingMemberId = requestingMemberId,
                    StatusId = statusId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 500)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (ChapterRegistrationErrors.IsKnown(ex.Number))
        {
            throw new ChapterRegistrationException(ex.Number, ex.Message);
        }
    }

    public async Task<ChapterRegistrationDetailRows> GetAsync(int registrationId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_ChapterRegistration_Get",
                new { RegistrationId = registrationId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var header = await multi.ReadSingleAsync<ChapterRegistrationRow>();
            var officers = (await multi.ReadAsync<ChapterRegistrationOfficerRow>()).ToList();
            var history = (await multi.ReadAsync<ChapterRegistrationUpdateRow>()).ToList();
            var routing = await multi.ReadSingleOrDefaultAsync<ChapterRegistrationRoutingRow>();

            return new ChapterRegistrationDetailRows(header, officers, history, routing);
        }
        catch (SqlException ex) when (ChapterRegistrationErrors.IsKnown(ex.Number))
        {
            throw new ChapterRegistrationException(ex.Number, ex.Message);
        }
    }

    public async Task<ChapterRegistrationVerifyResultRow> VerifyOfficerAsync(
        int registrationOfficerId, int requestingMemberId, bool verified, string? note, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChapterRegistrationVerifyResultRow>(new CommandDefinition(
                "dbo.usp_ChapterRegistration_VerifyOfficer",
                new
                {
                    RegistrationOfficerId = registrationOfficerId,
                    RequestingMemberId = requestingMemberId,
                    Verified = verified,
                    Note = note
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChapterRegistrationErrors.IsKnown(ex.Number))
        {
            throw new ChapterRegistrationException(ex.Number, ex.Message);
        }
    }

    public async Task<ChapterRegistrationDecisionResultRow> ReturnAsync(
        int registrationId, int requestingMemberId, string reason, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<ChapterRegistrationDecisionResultRow>(new CommandDefinition(
                "dbo.usp_ChapterRegistration_Return",
                new { RegistrationId = registrationId, RequestingMemberId = requestingMemberId, Reason = reason },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (ChapterRegistrationErrors.IsKnown(ex.Number))
        {
            throw new ChapterRegistrationException(ex.Number, ex.Message);
        }
    }

    public async Task<ChapterRegistrationApproveResult> ApproveAsync(
        int registrationId, string registrationType, int requestingMemberId,
        byte[]? tokenHash, DateTime? expiresOn,
        IReadOnlyDictionary<int, byte[]> turnoverTokenHashes, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_ChapterRegistration_Approve",
                new
                {
                    RegistrationId = registrationId,
                    RequestingMemberId = requestingMemberId,
                    TokenHash = tokenHash,
                    ExpiresOn = expiresOn,
                    TurnoverTokenHashes = MemberTokenHashTable(turnoverTokenHashes).AsTableValuedParameter("dbo.MemberTokenHashRow")
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            if (registrationType == "Charter")
            {
                var charter = await multi.ReadSingleAsync<ChapterRegistrationCharterApproveResultRow>();
                return new ChapterRegistrationApproveResult("Charter", charter, null, null);
            }

            // Turnover: two result sets — (1) ChapterId, (2) 0..N newly-enrolled officer links.
            var chapterId = await multi.ReadSingleAsync<int>();
            var enrolments = (await multi.ReadAsync<ChapterRegistrationTurnoverEnrolResultRow>()).ToList();
            return new ChapterRegistrationApproveResult("Turnover", null, chapterId, enrolments);
        }
        catch (SqlException ex) when (ChapterRegistrationErrors.IsKnown(ex.Number))
        {
            throw new ChapterRegistrationException(ex.Number, ex.Message);
        }
    }
}
