using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.ChapterRegistrations;

public static class ChapterRegistrationsEndpoints
{
    public static IEndpointRouteBuilder MapChapterRegistrations(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapter-registrations").WithTags("ChapterRegistrations");

        // Public, unauthenticated — no chapter exists until a council approves it (§7A.4).
        // Rate-limited by caller IP (not member id — there is no authenticated caller yet).
        g.MapPost("", Submit).WithName("SubmitChapterRegistration")
            .RequireRateLimiting(RateLimiting.ChapterRegistrationSubmit);

        // Route naming mirrors MembershipApplicationsEndpoints's own /status pair exactly
        // (GET to check, PUT to resubmit against the same identify query) for consistency
        // across the two public petition flows in this codebase.
        g.MapGet("/status", GetStatus).WithName("GetChapterRegistrationStatus")
            .RequireRateLimiting(RateLimiting.ChapterRegistrationStatus);

        g.MapPut("/status", Resubmit).WithName("ResubmitChapterRegistration")
            .RequireRateLimiting(RateLimiting.ChapterRegistrationStatus);

        // Authenticated, chapter-scoped. NO chapterId anywhere in the request — the filer's own
        // chapter is ALWAYS re-derived server-side from his currently-seated ChapterAdmin role
        // (ICurrentUser.MemberId only; CLAUDE.md invariant #4/#11).
        g.MapPost("/turnover", SubmitTurnover).WithName("SubmitChapterTurnover")
            .RequireAuthorization(AuthorizationPolicies.ChapterOfficerRosterFile);

        // Council queue and decisions. NO councilId anywhere in either GET below — scoped
        // entirely from ICurrentUser.CouncilIds / usp_ChapterRegistration_GetQueue's own
        // @RequestingMemberId derivation, never from anything the caller supplies.
        g.MapGet("", GetQueue).WithName("GetChapterRegistrationQueue")
            .RequireAuthorization(AuthorizationPolicies.CouncilChapterRegistrationVerify);

        g.MapGet("/{id:int}", GetOne).WithName("GetChapterRegistration")
            .RequireAuthorization(AuthorizationPolicies.CouncilChapterRegistrationVerify);

        g.MapPost("/{id:int}/officers/{officerId:int}/verify", VerifyOfficer).WithName("VerifyChapterRegistrationOfficer")
            .RequireAuthorization(AuthorizationPolicies.CouncilChapterRegistrationVerify);

        g.MapPost("/{id:int}/return", Return).WithName("ReturnChapterRegistration")
            .RequireAuthorization(AuthorizationPolicies.CouncilChapterRegistrationVerify);

        g.MapPost("/{id:int}/approve", Approve).WithName("ApproveChapterRegistration")
            .RequireAuthorization(AuthorizationPolicies.CouncilChapterRegistrationApprove);

        // There is deliberately NO /reject endpoint anywhere in this feature. §7A.4: "rejection
        // is not an available action — a chapter that has organized and petitioned must always
        // have a route forward." dbo.ChapterRegistrationStatus has exactly three rows
        // (Submitted / ReturnedForCorrection / Approved) and none may ever be added — a
        // registration that cannot yet be approved is returned for correction, never killed.

        return app;
    }

    private static async Task<Results<Ok<SubmitChapterRegistrationResponseDto>, ValidationProblem, BadRequest<string>, ProblemHttpResult>> Submit(
        SubmitChapterRegistrationRequest req, IChapterRegistrationRepository repo,
        IValidator<SubmitChapterRegistrationRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var referenceNo = await repo.SubmitAsync(
                req.ProposedChapterName, req.Barangay, req.RegionId, req.ProvinceId, req.MunicipalityId,
                req.MarkAccentId, MapOfficers(req.Officers), ct);

            // A genuine concurrent double-submit for the same (municipality, proposed name) is
            // NOT an error here — usp_ChapterRegistration_Submit resolves it internally and
            // hands back the SAME existing reference number, same idiom as
            // MembershipApplicationsEndpoints.Submit.
            return TypedResults.Ok(new SubmitChapterRegistrationResponseDto(referenceNo));
        }
        catch (ChapterRegistrationException ex)
        {
            // Submit only ever rejects with BadRequest (bad name/geography/accent, wrong
            // officer coverage, missing mobile, impossible birthdate) — the procedure's own
            // message, written to be shown to the petitioner, surfaced plainly.
            return ex.Category == ChapterRegistrationErrorCategory.BadRequest
                ? TypedResults.BadRequest(ex.Message)
                : TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static async Task<Results<Ok<ChapterRegistrationStatusDto>, ValidationProblem, NotFound>> GetStatus(
        [AsParameters] ChapterRegistrationIdentifyQuery query, IChapterRegistrationRepository repo,
        IValidator<ChapterRegistrationIdentifyQuery> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(query, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        var row = await repo.GetByReferenceAsync(query.ReferenceNo, query.MobileNo, ct);

        // Empty result set — a wrong reference and a wrong mobile look IDENTICAL here, on
        // purpose (usp_ChapterRegistration_GetByReference's own header comment). Never the
        // officer roster either way.
        if (row is null) return TypedResults.NotFound();

        return TypedResults.Ok(new ChapterRegistrationStatusDto(
            row.ReferenceNo, row.RegistrationType, row.ProposedChapterName, row.ChapterId, row.ChapterName,
            row.StatusName, row.SubmittedDate, row.DecidedDate, row.DecisionReason,
            row.ActingCouncilId, row.ActingCouncilName));
    }

    private static async Task<Results<Ok<ResubmitChapterRegistrationResponseDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> Resubmit(
        [AsParameters] ChapterRegistrationIdentifyQuery query, ResubmitChapterRegistrationRequest req,
        IChapterRegistrationRepository repo,
        IValidator<ChapterRegistrationIdentifyQuery> queryValidator,
        IValidator<ResubmitChapterRegistrationRequest> validator, CancellationToken ct)
    {
        var queryValidation = await queryValidator.ValidateAsync(query, ct);
        if (!queryValidation.IsValid) return TypedResults.ValidationProblem(queryValidation.ToDictionary());

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.ResubmitAsync(
                query.ReferenceNo, query.MobileNo, req.ProposedChapterName, req.Barangay,
                req.RegionId, req.ProvinceId, req.MunicipalityId, req.MarkAccentId,
                MapOfficers(req.Officers), ct);

            return TypedResults.Ok(new ResubmitChapterRegistrationResponseDto(result.RegistrationId, result.ReferenceNo, "Submitted"));
        }
        catch (ChapterRegistrationException ex)
        {
            return ex.Category switch
            {
                // Same "not found" for a wrong reference+mobile pair as the GET above.
                ChapterRegistrationErrorCategory.NotFound => TypedResults.NotFound(),
                // Not currently ReturnedForCorrection — the resource's state changed under the
                // caller, nothing about the request itself was invalid.
                ChapterRegistrationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                ChapterRegistrationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status500InternalServerError)
            };
        }
    }

    private static async Task<Results<Ok<SubmitChapterTurnoverResponseDto>, ValidationProblem, Conflict<string>, BadRequest<string>, ProblemHttpResult>> SubmitTurnover(
        SubmitChapterTurnoverRequest req, IChapterRegistrationRepository repo, ICurrentUser caller,
        IValidator<SubmitChapterTurnoverRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var referenceNo = await repo.SubmitTurnoverAsync(
                caller.MemberId,
                req.Officers.Select(o => new ChapterTurnoverOfficerInput(o.OfficeId, o.MemberId)).ToList(),
                ct);

            return TypedResults.Ok(new SubmitChapterTurnoverResponseDto(referenceNo));
        }
        catch (ChapterRegistrationException ex)
        {
            return ex.Category switch
            {
                // "This chapter already has a turnover form awaiting a decision" — the
                // resource's own state, not the request.
                ChapterRegistrationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                ChapterRegistrationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // 51510 — caller is not this chapter's own sitting ChapterAdmin. Unreachable
                // via the normal path (the policy already requires ChapterAdmin, and the
                // procedure derives the chapter from that SAME role), but the procedure's own
                // check stays defence in depth (CLAUDE.md invariant #4).
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<PagedResult<ChapterRegistrationQueueItemDto>>, ValidationProblem, ProblemHttpResult>> GetQueue(
        [AsParameters] ChapterRegistrationQueueRequest req,
        IChapterRegistrationRepository repo, ICurrentUser caller,
        IValidator<ChapterRegistrationQueueRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var rows = await repo.GetQueueAsync(
                caller.MemberId, req.StatusId, req.Skip, req.Take == 0 ? 50 : req.Take, ct);

            var items = rows.Select(r => new ChapterRegistrationQueueItemDto(
                r.RegistrationId, r.ReferenceNo, r.RegistrationType, r.ProposedChapterName,
                r.ChapterId, r.ChapterName, r.StatusName, r.SubmittedDate,
                r.ActingCouncilId, r.ActingCouncilName, r.IntendedCouncilId, r.RoutingReason,
                r.DecidedBy, r.DecidedDate, r.CanAct)).ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<ChapterRegistrationQueueItemDto>(items, total, req.Skip, req.Take));
        }
        catch (ChapterRegistrationException ex)
        {
            // usp_ChapterRegistration_GetQueue only ever rejects a caller who currently holds
            // no council seat at all — unreachable in the normal case, since the
            // CouncilChapterRegistrationVerify policy already requires CouncilSecretary/
            // CouncilAdmin, but the procedure's own re-check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<ChapterRegistrationDetailDto>, NotFound>> GetOne(
        int id, IChapterRegistrationRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var detail = await repo.GetAsync(id, caller.MemberId, ct);
            return TypedResults.Ok(MapDetail(detail));
        }
        catch (ChapterRegistrationException)
        {
            // usp_ChapterRegistration_Get throws the SAME "Registration not found" message for
            // a nonexistent id and for one acting at a council this caller has no standing over
            // — deliberate anti-enumeration, mirroring usp_MembershipApplication_Get.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<VerifyChapterRegistrationOfficerResponseDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> VerifyOfficer(
        int id, int officerId, VerifyChapterRegistrationOfficerRequest req,
        IChapterRegistrationRepository repo, ICurrentUser caller,
        IValidator<VerifyChapterRegistrationOfficerRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            // usp_ChapterRegistration_VerifyOfficer resolves the registration from the officer
            // row itself and re-checks the caller's own council seat against it — `id` (the
            // route's registrationId) is not even a procedure parameter; kept on the route
            // purely so the URL nests under the registration it belongs to.
            var result = await repo.VerifyOfficerAsync(officerId, caller.MemberId, req.Verified, req.Note, ct);
            return TypedResults.Ok(new VerifyChapterRegistrationOfficerResponseDto(result.RegistrationOfficerId, result.Verified));
        }
        catch (ChapterRegistrationException ex)
        {
            return ex.Category switch
            {
                ChapterRegistrationErrorCategory.NotFound => TypedResults.NotFound(),
                // Not currently awaiting verification (already decided).
                ChapterRegistrationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                ChapterRegistrationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // 51542 — caller is not this council's Secretary or President. Unreachable via
                // the normal path (the policy already requires one of those roles), but the
                // procedure's own council-seat check stays defence in depth.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<ReturnChapterRegistrationResponseDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> Return(
        int id, ReturnChapterRegistrationRequest req, IChapterRegistrationRepository repo, ICurrentUser caller,
        IValidator<ReturnChapterRegistrationRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.ReturnAsync(id, caller.MemberId, req.Reason, ct);
            return TypedResults.Ok(new ReturnChapterRegistrationResponseDto(result.RegistrationId, "ReturnedForCorrection"));
        }
        catch (ChapterRegistrationException ex)
        {
            return ex.Category switch
            {
                ChapterRegistrationErrorCategory.NotFound => TypedResults.NotFound(),
                ChapterRegistrationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                ChapterRegistrationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    /// <summary>
    /// Generates the enrolment token(s) here, exactly like MembershipApplicationsEndpoints.Approve
    /// — only the SHA-256 hash(es) ever cross into the database. Every `rawToken` below is a
    /// local only: it is placed into ONE response object and nowhere else — never a log
    /// statement, never a field on any persisted row, never a variable captured by a closure
    /// that outlives this method. There is no GET to re-fetch this response later.
    /// </summary>
    private static async Task<Results<Ok<ApproveChapterRegistrationResponseDto>, NotFound, Conflict<string>, BadRequest<string>, ProblemHttpResult>> Approve(
        int id, IConfiguration config, IChapterRegistrationRepository repo,
        IPasswordHasherService hasher, ICurrentUser caller, CancellationToken ct)
    {
        ChapterRegistrationDetailRows detail;
        try
        {
            // RegistrationType is not knowable from the route alone, and
            // usp_ChapterRegistration_Approve's own result shape branches on it — read it via
            // the same Get a council officer would already have used to review this
            // registration before approving it (also re-confirms the caller's own standing,
            // same anti-enumeration guarantee as GetOne above).
            detail = await repo.GetAsync(id, caller.MemberId, ct);
        }
        catch (ChapterRegistrationException)
        {
            return TypedResults.NotFound();
        }

        var webOrigin = (config["Web:Origin"] ?? "").TrimEnd('/');

        byte[]? charterTokenHash = null;
        var turnoverTokenHashes = new Dictionary<int, byte[]>();
        var turnoverRawTokens = new Dictionary<int, string>();
        string? charterRawToken = null;

        if (detail.Header.RegistrationType == "Charter")
        {
            charterRawToken = OpaqueToken.GenerateRaw();
            charterTokenHash = OpaqueToken.Hash(charterRawToken);
        }
        else
        {
            // One brand-new token per incoming officer who needs a fresh account — an officer
            // who already holds one needs no row here at all (usp_ChapterRegistration_Approve's
            // own header). Generated for EVERY GrantsLogin seat up front; the procedure itself
            // is what actually decides which of these are used (an officer who already has a
            // dbo.UserAccount row makes his own row here simply unused, never inserted).
            foreach (var officer in detail.Officers.Where(o => o.GrantsLogin && o.MemberId is not null))
            {
                var raw = OpaqueToken.GenerateRaw();
                turnoverRawTokens[officer.MemberId!.Value] = raw;
                turnoverTokenHashes[officer.MemberId!.Value] = OpaqueToken.Hash(raw);
            }
        }

        // DRY-RUN ONLY — see Akrho.Infrastructure.Security.DryRunDefaults. Makes every
        // newly-enrolled officer sign-in-capable immediately, on this well-known password;
        // the enrolment link(s) below are untouched and still let each of them set his own.
        var defaultPasswordHash = hasher.Hash(DryRunDefaults.InitialPassword);

        try
        {
            var result = await repo.ApproveAsync(
                id, detail.Header.RegistrationType, caller.MemberId,
                charterTokenHash, null, turnoverTokenHashes, defaultPasswordHash, ct);

            if (result.RegistrationType == "Charter")
            {
                var charter = result.Charter!;
                var enrolmentUrl = $"{webOrigin}/enrol/{charterRawToken}";

                return TypedResults.Ok(new ApproveChapterRegistrationResponseDto(
                    charter.ChapterId, "Charter",
                    new ChapterCharterApprovalResultDto(
                        charter.PresidentMemberId, charter.MemberNumberPrefix, enrolmentUrl, charter.PresidentLinkExpiresOn),
                    null));
            }

            var enrolments = (result.TurnoverEnrolments ?? [])
                .Select(e => new ChapterTurnoverOfficerEnrolmentDto(
                    e.MemberId, $"{webOrigin}/enrol/{turnoverRawTokens[e.MemberId]}", e.ExpiresOn))
                .ToList();

            return TypedResults.Ok(new ApproveChapterRegistrationResponseDto(
                result.TurnoverChapterId!.Value, "Turnover", null, enrolments));
        }
        catch (ChapterRegistrationException ex)
        {
            return ex.Category switch
            {
                ChapterRegistrationErrorCategory.NotFound => TypedResults.NotFound(),
                // Already decided, or not every officer verified yet (the procedure's own
                // "(N of 8 verified)" message) — the resource's own state blocks this, not the
                // request.
                ChapterRegistrationErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                // A GrantsLogin turnover officer needing a brand-new account had no token hash
                // supplied — should not happen given the loop above, but the procedure's own
                // check is authoritative.
                ChapterRegistrationErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                // 51562 — caller is not this council's own President. Unreachable via the
                // normal path (the policy already requires CouncilAdmin), but the procedure's
                // own check stays defence in depth.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static IReadOnlyList<ChapterCharterOfficerInput> MapOfficers(IReadOnlyList<ChapterCharterOfficerInputDto> officers) =>
        officers.Select(o => new ChapterCharterOfficerInput(
            o.OfficeId, o.FirstName, o.MiddleName, o.LastName, o.GiftName, o.BirthDate, o.MobileNo,
            o.Email, o.DateSurvive, o.PresidentDuringSurvive, o.MasterInitiatorDuringSurvive)).ToList();

    private static ChapterRegistrationDetailDto MapDetail(ChapterRegistrationDetailRows detail)
    {
        var h = detail.Header;

        var officers = detail.Officers.Select(o => new ChapterRegistrationOfficerDto(
            o.RegistrationOfficerId, o.OfficeId, o.OfficeName, o.SortOrder, o.GrantsLogin,
            o.MemberId, o.MemberNumber,
            o.FirstName, o.MiddleName, o.LastName, o.GiftName, DateOnly.FromDateTime(o.BirthDate),
            o.MobileNo, o.Email, o.DateSurvive is { } ds ? DateOnly.FromDateTime(ds) : null,
            o.PresidentDuringSurvive, o.MasterInitiatorDuringSurvive,
            o.VerifiedBy, o.VerifiedByGiftName, o.VerifiedDate, o.VerifyNote,
            o.CreatedMemberId, o.HasAccount)).ToList();

        var history = detail.History.Select(u => new ChapterRegistrationUpdateDto(
            u.ChapterRegistrationUpdateId, u.UpdateDate, u.UpdatedBy, u.StatusName, u.Notes)).ToList();

        var routing = detail.Routing is { } r
            ? new ChapterRegistrationRoutingDto(r.RoutingId, r.IntendedCouncilId, r.ActingCouncilId, r.RoutingReason, r.ActorMemberId, r.ActedOn, r.Remarks)
            : null;

        return new ChapterRegistrationDetailDto(
            h.RegistrationId, h.ReferenceNo, h.RegistrationType, h.ChapterId, h.ChapterName,
            h.ProposedChapterName, h.Barangay, h.RegionId, h.ProvinceId, h.MunicipalityId,
            h.MarkAccentId, h.AccentName, h.HexValue,
            h.IntendedCouncilId, h.IntendedCouncilName,
            h.ActingCouncilId, h.ActingCouncilName, h.RoutingReason,
            h.SubmittedByMemberId, h.SubmittedByGiftName,
            h.SubmittedDate, h.StatusName, h.IsOpen,
            h.DecidedBy, h.DecidedByGiftName, h.DecidedDate, h.DecisionReason,
            h.CreatedChapterId,
            officers, history, routing);
    }
}
