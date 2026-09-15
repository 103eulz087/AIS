using Akrho.Api.Common;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentValidation;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Meetings;

public static class MeetingsEndpoints
{
    public static IEndpointRouteBuilder MapMeetings(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/chapters/{chapterId:int}/meetings")
                   .WithTags("Meetings").RequireAuthorization();

        g.MapGet("", List).WithName("ListMeetings");
        g.MapGet("/{meetingId:int}", Get).WithName("GetMeeting");

        g.MapPost("", Create).WithName("CreateMeeting")
            .RequireAuthorization(AuthorizationPolicies.ChapterMeetingsWrite);

        g.MapPut("/{meetingId:int}", Update).WithName("UpdateMeeting")
            .RequireAuthorization(AuthorizationPolicies.ChapterMeetingsWrite);

        // Save requires ChapterMeetingsWrite; a finalize:true body is additionally checked
        // against ChapterMeetingsFinalize INSIDE the handler, before the repository is even
        // called — see comment there. The procedure enforces both regardless (defence in depth).
        g.MapPut("/{meetingId:int}/attendance", SaveAttendance).WithName("SaveMeetingAttendance")
            .RequireAuthorization(AuthorizationPolicies.ChapterMeetingsWrite);

        g.MapDelete("/{meetingId:int}/attendance/{memberId:int}", ClearAttendance).WithName("ClearMeetingAttendance")
            .RequireAuthorization(AuthorizationPolicies.ChapterMeetingsWrite);

        g.MapPost("/{meetingId:int}/reopen", Reopen).WithName("ReopenMeeting")
            .RequireAuthorization(AuthorizationPolicies.ChapterLedgerCorrect);

        return app;
    }

    private static async Task<Results<Ok<PagedResult<MeetingListItemDto>>, ValidationProblem, ProblemHttpResult>> List(
        int chapterId, [AsParameters] MeetingListRequest req,
        IMeetingRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var rows = await repo.GetByChapterAsync(
                chapterId, caller.MemberId, req.Skip, req.Take == 0 ? 50 : req.Take, ct);

            var items = rows.Select(r => new MeetingListItemDto(
                r.MeetingId, r.Subject, DateOnly.FromDateTime(r.MeetingDate), r.Location,
                r.IsFinalized, r.FinalizedDate, r.CollectionTotal, r.PresentCount, r.LateCount)).ToList();

            var total = rows.Count > 0 ? rows[0].TotalCount : 0;
            return TypedResults.Ok(new PagedResult<MeetingListItemDto>(items, total, req.Skip, req.Take));
        }
        catch (MeetingException ex)
        {
            // usp_Meeting_GetByChapter only ever rejects a caller who is not an active
            // member of the chapter — unreachable in the normal case, since IScopeGuard
            // already confirmed the caller's own chapter matches the route, but the
            // procedure's own check stays defence in depth.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<MeetingDetailDto>, NotFound>> Get(
        int chapterId, int meetingId,
        IMeetingRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            var detail = await repo.GetAsync(meetingId, caller.MemberId, ct);

            var attendance = detail.Attendance.Select(a => new AttendanceRowDto(
                a.MemberId, a.GiftName, a.MemberNumber, a.StatusName,
                a.AttendanceStatusId, a.FundAmount, a.CheckedInAt)).ToList();

            var reopenHistory = detail.ReopenHistory.Select(r => new MeetingReopenDto(
                r.MeetingReopenId, r.ReopenedBy, r.ReopenedDate, r.Reason, r.ReversedLedgerEntryId)).ToList();

            var header = detail.Header;
            var dto = new MeetingDetailDto(
                header.MeetingId, header.ChapterId, header.Subject, DateOnly.FromDateTime(header.MeetingDate),
                header.Body, header.Location, header.IsFinalized, header.FinalizedBy, header.FinalizedDate,
                header.CreatedBy, header.CreatedDate, header.LedgerEntryId, header.LedgerEntryIsReversed,
                attendance, reopenHistory);

            return TypedResults.Ok(dto);
        }
        catch (MeetingException)
        {
            // usp_Meeting_Get throws the SAME "Meeting not found" message for a nonexistent
            // id and for a wrong-chapter caller — deliberate anti-enumeration. Do not add a
            // different response for either case.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<MeetingCreatedDto>, ValidationProblem, ProblemHttpResult>> Create(
        int chapterId, CreateMeetingRequest req,
        IMeetingRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<CreateMeetingRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var meetingId = await repo.CreateAsync(
                chapterId, caller.MemberId, req.Subject, req.MeetingDate, req.Location, req.Body, ct);
            return TypedResults.Ok(new MeetingCreatedDto(meetingId));
        }
        catch (MeetingException ex)
        {
            // Only ever a role check (51154) — the policy already blocked this for anyone
            // but a ChapterOfficer/ChapterAdmin, so this is the procedure's own layer.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok, ValidationProblem, NotFound, Conflict<string>, ProblemHttpResult>> Update(
        int chapterId, int meetingId, UpdateMeetingRequest req,
        IMeetingRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<UpdateMeetingRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.UpdateAsync(meetingId, caller.MemberId, req.Subject, req.MeetingDate, req.Location, req.Body, ct);
            return TypedResults.Ok();
        }
        catch (MeetingException ex)
        {
            return ex.Category switch
            {
                MeetingErrorCategory.NotFound => TypedResults.NotFound(),
                // A finalized meeting is read-only; the resource's state changed under the
                // caller, nothing about the request itself was invalid — 409, not 400.
                MeetingErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<SaveAttendanceResponseDto>, ValidationProblem, NotFound, Conflict<string>, ProblemHttpResult, BadRequest<string>>> SaveAttendance(
        int chapterId, int meetingId, SaveAttendanceRequest req, HttpContext http,
        IMeetingRepository repo, ICurrentUser caller, IScopeGuard scope, IAuthorizationService authz,
        IValidator<SaveAttendanceRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        // A ChapterOfficer already cleared ChapterMeetingsWrite to reach this handler at
        // all; finalize:true additionally requires ChapterMeetingsFinalize (ChapterAdmin
        // only), checked here BEFORE the repository call so the caller gets a clean 403
        // rather than relying solely on the procedure's own rejection.
        if (req.Finalize)
        {
            var finalizeAuth = await authz.AuthorizeAsync(http.User, AuthorizationPolicies.ChapterMeetingsFinalize);
            if (!finalizeAuth.Succeeded)
                return TypedResults.Problem(
                    detail: "Only the chapter admin may finalize a meeting.",
                    statusCode: StatusCodes.Status403Forbidden);
        }

        try
        {
            var rows = req.Rows
                .Select(r => new AttendanceRowInput(r.MemberId, r.AttendanceStatusId, r.FundAmount, r.CheckedInVia))
                .ToList();

            var result = await repo.SaveAttendanceAsync(meetingId, caller.MemberId, rows, req.Finalize, ct);

            return TypedResults.Ok(new SaveAttendanceResponseDto(
                result.MeetingId, result.RowsSaved, result.Finalized, result.LedgerEntryId));
        }
        catch (MeetingException ex)
        {
            return ex.Category switch
            {
                MeetingErrorCategory.NotFound => TypedResults.NotFound(),
                MeetingErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                MeetingErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok, NotFound, Conflict<string>, ProblemHttpResult>> ClearAttendance(
        int chapterId, int meetingId, int memberId,
        IMeetingRepository repo, ICurrentUser caller, IScopeGuard scope, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        try
        {
            await repo.ClearAttendanceAsync(meetingId, memberId, caller.MemberId, ct);
            return TypedResults.Ok();
        }
        catch (MeetingException ex)
        {
            return ex.Category switch
            {
                MeetingErrorCategory.NotFound => TypedResults.NotFound(),
                MeetingErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<ReopenMeetingResponseDto>, ValidationProblem, NotFound, Conflict<string>, ProblemHttpResult, BadRequest<string>>> Reopen(
        int chapterId, int meetingId, ReopenMeetingRequest req,
        IMeetingRepository repo, ICurrentUser caller, IScopeGuard scope,
        IValidator<ReopenMeetingRequest> validator, CancellationToken ct)
    {
        scope.EnsureChapter(caller, chapterId);

        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.ReopenAsync(meetingId, req.Reason, caller.MemberId, ct);
            return TypedResults.Ok(new ReopenMeetingResponseDto(result.MeetingId, result.ReversedLedgerEntryId));
        }
        catch (MeetingException ex)
        {
            return ex.Category switch
            {
                MeetingErrorCategory.NotFound => TypedResults.NotFound(),
                MeetingErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                // The proc's own "at least 10 characters" message — written to be shown
                // to the officer, surfaced plainly rather than a generic validation error.
                MeetingErrorCategory.BadRequest => TypedResults.BadRequest(ex.Message),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }
}
