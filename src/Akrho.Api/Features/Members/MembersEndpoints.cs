using Akrho.Api.Common;
using Akrho.Domain;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using Akrho.Infrastructure.Storage;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Akrho.Api.Features.Members;

public static class MembersEndpoints
{
    // A profile photo is a single portrait shot, not a scanned document — tighter than
    // AttachmentsEndpoints' 8 MB/PDF-inclusive allow-list (see MapMembers below for why this
    // is a wholly separate, open-to-every-member endpoint rather than a relaxation of
    // AttachmentsEndpoints' Treasurer-only policy).
    private const long MaxPhotoSizeBytes = 4L * 1024 * 1024;

    private static readonly HashSet<string> AllowedPhotoContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/heic"
    };

    public static IEndpointRouteBuilder MapMembers(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/members").WithTags("Members").RequireAuthorization();

        g.MapGet("", Search).WithName("SearchMembers");

        // Self-service profile. No memberId anywhere in these three routes — the caller's own
        // identity comes from ICurrentUser (the JWT) alone, never from the request
        // (CLAUDE.md invariant #4 / #11). There is nothing here for a caller to substitute.
        g.MapGet("/me", GetOwnProfile).WithName("GetOwnMemberProfile");
        g.MapPatch("/me", UpdateOwnProfile).WithName("UpdateOwnMemberProfile");
        g.MapPost("/me/photo", ClaimOwnPhoto).WithName("ClaimOwnMemberPhoto");

        // Staging is gated at plain authentication only — deliberately NOT
        // AuthorizationPolicies.ChapterMoneyWrite, which stays exactly as
        // AttachmentsEndpoints.cs already gates it, untouched. A member staging his own
        // profile photo is a different, unrelated action from staging a receipt: this staged
        // row can only ever be CLAIMED by usp_Member_SetPhoto, whose own ownership check
        // (UploadedBy = @RequestingMemberId) means it can only ever become the CALLER's own
        // Member.PhotoPath — there is no shared resource here for one member to feed into
        // another member's or another chapter's records, the way an arbitrary attachment could
        // for someone else's expense. Opening this endpoint to every member costs nothing a
        // Treasurer-only gate would have protected.
        g.MapPost("/me/photo/stage", StageOwnPhoto).WithName("StageOwnMemberPhoto")
            .RequireRateLimiting(RateLimiting.ProfilePhotoUpload)
            .DisableAntiforgery();

        // Any authenticated caller may ask for ANY member's photo by id — usp_Member_GetPhoto
        // enforces the actual visibility rule (self, or same chapter) and throws the identical
        // "not found" for a wrong-chapter caller, a nonexistent member, and a member with no
        // photo set. There is no separate scope check here to duplicate or get out of sync
        // with the procedure's own.
        g.MapGet("/{memberId:int}/photo", GetPhoto).WithName("GetMemberPhoto");

        // Chapter Admin only — "I forgot my password" recovery. Never a password reset: a
        // fresh one-time enrolment link, same as first-time access (CLAUDE.md invariant #16).
        // memberId comes from the route, but the chapter it is checked against comes from the
        // member's own row inside usp_Enrolment_Issue, never from this caller's JWT or request
        // — a Chapter Admin cannot use this to reach into another chapter's roster.
        g.MapPost("/{memberId:int}/enrolment-link", ReissueEnrolmentLink)
            .WithName("ReissueMemberEnrolmentLink")
            .RequireAuthorization(AuthorizationPolicies.ChapterMembersEnrolmentReissue);

        // National Council only (client decision 2026-09-21) — see
        // AuthorizationPolicies.NationalMemberAccountManage's own doc comment for why the
        // ROLE bar here (any CouncilAdmin) is coarser than the actual authority, which
        // usp_Member_Block/_Unblock/_ResetPassword/_ListBlocked enforce themselves by
        // walking the caller's own council seat back to the root.
        g.MapGet("/blocked", ListBlockedMembers).WithName("ListBlockedMembers")
            .RequireAuthorization(AuthorizationPolicies.NationalMemberAccountManage);
        g.MapPost("/{memberId:int}/block", BlockMember).WithName("BlockMember")
            .RequireAuthorization(AuthorizationPolicies.NationalMemberAccountManage);
        g.MapPost("/{memberId:int}/unblock", UnblockMember).WithName("UnblockMember")
            .RequireAuthorization(AuthorizationPolicies.NationalMemberAccountManage);
        g.MapPost("/{memberId:int}/reset-password", ResetMemberPassword).WithName("ResetMemberPassword")
            .RequireAuthorization(AuthorizationPolicies.NationalMemberAccountManage);

        // Chapter Admin only, same chapter — correcting a same-chapter brother's own
        // typo'd name or mobile number (usp_Member_UpdateOwnProfile's own guardrail
        // deliberately keeps these off self-service; this is that "future module").
        // The route carries memberId, but the procedure never trusts it as
        // authorization — it re-derives the requester's own ChapterAdmin seat and
        // compares chapters itself (CLAUDE.md invariant #4).
        g.MapPut("/{memberId:int}/identity", UpdateIdentity).WithName("UpdateMemberIdentity")
            .RequireAuthorization(AuthorizationPolicies.ChapterMemberIdentityEdit);

        return app;
    }

    private static async Task<Results<Ok<PagedResult<object>>, ValidationProblem>> Search(
        [AsParameters] MemberSearchRequest req,
        IMemberRepository repo,
        ICurrentUser caller,
        IValidator<MemberSearchRequest> validator,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        var rows = await repo.SearchAsync(
            caller.MemberId, req.ChapterId, req.Search, req.BloodTypeId,
            req.SkillId, req.IncludeInactive, req.StatusId, req.Skip, req.Take, ct);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Two shapes. Choosing the wrong one is a privacy incident, not a bug.
        var items = rows.Select(object (r) => r.IsSameChapter
            ? new MemberDto(
                r.MemberId, r.GiftName, r.MemberNumber, r.ChapterId, r.ChapterName, r.StatusName,
                FullName: string.Join(' ', new[] { r.FirstName, r.MiddleName, r.LastName }
                                              .Where(s => !string.IsNullOrWhiteSpace(s))),
                r.MobileNo, r.Profession, r.BloodType,
                // GET /api/files/{path} has never existed — every photo in the directory was a
                // broken image link. Route through the scoped photo-read endpoint instead, and
                // only emit a URL at all when a photo is actually set.
                PhotoUrl: r.PhotoPath is null ? null : $"/api/members/{r.MemberId}/photo",
                RenewedThrough: r.RenewedThrough is { } d ? DateOnly.FromDateTime(d) : null,
                IsCurrent: MembershipYear.IsCurrent(
                    r.RenewedThrough is { } dd ? DateOnly.FromDateTime(dd) : null, today),
                OfficeName: r.OfficeName, IsBlocked: r.IsBlocked ?? false, RowVersion: r.RowVersion ?? [],
                FirstName: r.FirstName, MiddleName: r.MiddleName, LastName: r.LastName)
            : new MemberCrossChapterDto(
                r.MemberId, r.GiftName, r.ChapterId, r.ChapterName, r.StatusName))
            .ToList();

        var total = rows.Count > 0 ? rows[0].TotalCount : 0;
        return TypedResults.Ok(new PagedResult<object>(items, total, req.Skip, req.Take));
    }

    private static async Task<Results<Ok<MemberProfileDto>, NotFound>> GetOwnProfile(
        IMemberProfileRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var result = await repo.GetOwnProfileAsync(caller.MemberId, ct);
            return TypedResults.Ok(ToProfileDto(result));
        }
        catch (MemberProfileException)
        {
            // usp_Member_GetOwnProfile only ever rejects a caller whose own member row is
            // gone — unreachable in the normal case (an authenticated caller IS an existing
            // member), but the procedure's own check stays defence in depth.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<MemberProfileUpdatedDto>, ValidationProblem, NotFound, Conflict<string>, BadRequest<string>, UnauthorizedHttpResult>> UpdateOwnProfile(
        UpdateMemberProfileRequest req,
        IMemberProfileRepository profileRepo, IAuthRepository authRepo, IPasswordHasherService hasher,
        ICurrentUser caller, IValidator<UpdateMemberProfileRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            // The mobile-number step-up gate. A fresh read of the caller's OWN row decides
            // whether this call is really changing MobileNo (never trust the client's own
            // idea of "did I change this" for a security-relevant decision) — this same read
            // also gives us the MemberNumber needed to reuse the exact sign-in password
            // lookup (usp_Auth_GetAccountForSignIn), since there is no "get account by member
            // id" procedure and building one is out of scope for a lookup this cheap.
            // If the number is unchanged, no password is asked for at all — re-saving an
            // untouched mobile number alongside an unrelated edit (say, just Address) must
            // not suddenly demand a password the member has no reason to expect.
            var current = await profileRepo.GetOwnProfileAsync(caller.MemberId, ct);
            var mobileIsChanging = !string.Equals(
                current.Profile.MobileNo?.Trim(), req.MobileNo.Trim(), StringComparison.Ordinal);

            if (mobileIsChanging)
            {
                if (string.IsNullOrWhiteSpace(req.CurrentPassword))
                    return TypedResults.BadRequest(
                        "Enter your current password to change your mobile number.");

                var account = await authRepo.GetAccountForSignInAsync(current.Profile.MemberNumber, ct);

                // No such account (should not happen — the caller just read his own profile),
                // or a wrong password: both are "reject before touching the database at all",
                // same generic 401 posture AuthEndpoints.SignIn uses for a bad credential.
                if (account is null || !hasher.Verify(account.PasswordHash, req.CurrentPassword))
                    return TypedResults.Unauthorized();
            }

            var newRowVersion = await profileRepo.UpdateOwnProfileAsync(
                caller.MemberId, req.GiftName, req.BirthDate, req.DateSurvive,
                req.PresidentDuringSurvive, req.MasterInitiatorDuringSurvive,
                req.MobileNo, req.Email, req.Address,
                req.BloodTypeId, req.BloodTypeConfirmed, req.Profession,
                req.SkillIds, req.RowVersion, ct);

            return TypedResults.Ok(new MemberProfileUpdatedDto(newRowVersion));
        }
        catch (MemberProfileException ex)
        {
            return ex.Category switch
            {
                MemberProfileErrorCategory.NotFound => TypedResults.NotFound(),
                // The row changed since the client loaded it — the resource's own state
                // moved, nothing about the request itself was invalid. 409, not 400.
                MemberProfileErrorCategory.Conflict => TypedResults.Conflict(ex.Message),
                // A blank mobile number, an unrecognised blood type, or a stale/inactive
                // skill id — the procedure's own message, written for the member editing his
                // own profile.
                // MemberProfileErrorCategory has no other member; this arm exists only for
                // switch-expression exhaustiveness against an enum's open underlying type.
                _ => TypedResults.BadRequest(ex.Message)
            };
        }
    }

    private static async Task<Results<Ok<MemberPhotoClaimedDto>, ValidationProblem, NotFound, BadRequest<string>>> ClaimOwnPhoto(
        ClaimMemberPhotoRequest req, IMemberProfileRepository repo, ICurrentUser caller,
        IValidator<ClaimMemberPhotoRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.SetPhotoAsync(caller.MemberId, req.AttachmentStagingId, ct);
            return TypedResults.Ok(new MemberPhotoClaimedDto($"/api/members/{caller.MemberId}/photo"));
        }
        catch (MemberProfileException ex)
        {
            return ex.Category switch
            {
                MemberProfileErrorCategory.NotFound => TypedResults.NotFound(),
                // 51246 (BadRequest) — the staged upload was not found, not owned by this
                // member, or already consumed. Deliberately generic: don't try to distinguish
                // the three. Conflict is unreachable from this call; the discard arm exists
                // only for switch-expression exhaustiveness.
                _ => TypedResults.BadRequest(ex.Message)
            };
        }
    }

    private static async Task<Results<Ok<MemberPhotoStagedDto>, BadRequest<string>>> StageOwnPhoto(
        IFormFile? file, IFileStorage storage, IAttachmentRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return TypedResults.BadRequest("Choose a photo to upload.");

        if (file.Length > MaxPhotoSizeBytes)
            return TypedResults.BadRequest("That photo is too large. Photos up to 4 MB are accepted.");

        if (!AllowedPhotoContentTypes.Contains(file.ContentType))
            return TypedResults.BadRequest("Only JPEG, PNG or HEIC photos are accepted.");

        await using var stream = file.OpenReadStream();
        var stored = await storage.SaveAsync(stream, file.FileName, file.ContentType, ct);

        // ChapterId and UploadedBy come from the caller's own token, never the request
        // (CLAUDE.md invariant #11). This is the SAME generic AttachmentStaging row
        // AttachmentsEndpoints.Upload writes — only the caller (member vs. Treasurer),
        // policy, size cap and allow-list differ; usp_Member_SetPhoto is what actually
        // restricts this staged row to becoming ONLY the caller's own photo.
        var displayName = Path.GetFileName(file.FileName);
        var attachmentStagingId = await repo.StageAsync(
            caller.ChapterId, caller.MemberId, stored.RelativePath, displayName,
            stored.FileSize, file.ContentType, ct);

        return TypedResults.Ok(new MemberPhotoStagedDto(attachmentStagingId));
    }

    private static async Task<Results<FileStreamHttpResult, NotFound>> GetPhoto(
        int memberId, IMemberProfileRepository repo, IFileStorage storage, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var row = await repo.GetPhotoAsync(memberId, caller.MemberId, ct);
            var stream = await storage.OpenReadAsync(row.PhotoPath, ct);

            // Forces Content-Disposition: attachment — the mitigation against a spoofed
            // content-type stored-XSS vector, same pattern AttachmentsEndpoints.Download and
            // ExpensesEndpoints.DownloadAttachment already use. PhotoPath is itself an opaque,
            // server-generated name (never derived from anything personal), so it is safe to
            // reuse as the download filename here.
            return TypedResults.Stream(stream, row.ContentType ?? "application/octet-stream", row.PhotoPath);
        }
        catch (MemberProfileException)
        {
            // Same "not found" for a nonexistent member, a wrong-chapter caller, and a member
            // who has never uploaded a photo — anti-enumeration, usp_Member_GetPhoto's own
            // header comment.
            return TypedResults.NotFound();
        }
    }

    private static async Task<Results<Ok<ReissueMemberEnrolmentLinkResponseDto>, NotFound, ProblemHttpResult>> ReissueEnrolmentLink(
        int memberId, IEnrolmentRepository enrolment, IConfiguration config,
        IPasswordHasherService hasher, ICurrentUser caller, CancellationToken ct)
    {
        // Generated here, never persisted or logged — same "SHOW-ONCE" discipline as
        // MembershipApplicationsEndpoints.Approve. Only the SHA-256 hash reaches the database.
        var rawToken = OpaqueToken.GenerateRaw();
        var tokenHash = OpaqueToken.Hash(rawToken);

        // DRY-RUN ONLY — see Akrho.Infrastructure.Security.DryRunDefaults. Also makes the
        // member sign-in-capable immediately, on this well-known password; the link above
        // is untouched and still lets him set his own the moment he uses it.
        var defaultPasswordHash = hasher.Hash(DryRunDefaults.InitialPassword);

        try
        {
            var result = await enrolment.IssueAsync(memberId, caller.MemberId, tokenHash, defaultPasswordHash, ct);

            var webOrigin = (config["Web:Origin"] ?? "").TrimEnd('/');
            var enrolmentUrl = $"{webOrigin}/enrol/{rawToken}";

            return TypedResults.Ok(new ReissueMemberEnrolmentLinkResponseDto(memberId, enrolmentUrl, result.ExpiresOn));
        }
        catch (EnrolmentIssueException ex)
        {
            return ex.Reason switch
            {
                // 51100/51101 — no such member, or one with no active role at all. Same
                // "not found" whether the id is wrong or just belongs to another chapter;
                // anti-enumeration, matching MembershipApplicationsEndpoints.GetOne.
                EnrolmentIssueFailureReason.MemberNotFound => TypedResults.NotFound(),
                EnrolmentIssueFailureReason.NoActiveRole => TypedResults.NotFound(),
                // 51290 — a real member this caller has no standing over: a ChapterAdmin of
                // another chapter, or a council officer outside this chapter's jurisdiction, or
                // (the council branch specifically) a member who already has an account or has
                // ever redeemed a link before. ChapterMembersEnrolmentReissue only proves ONE of
                // ChapterAdmin/CouncilSecretary/CouncilAdmin somewhere — it does not scope which
                // chapter, so usp_Enrolment_Issue's own check is what actually enforces CLAUDE.md
                // invariant #4 here. Surfaced as 403, not 404, since the member id itself is real
                // and this doesn't leak which chapter he belongs to.
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden)
            };
        }
    }

    private static async Task<Results<Ok<IReadOnlyList<BlockedMemberDto>>, ProblemHttpResult>> ListBlockedMembers(
        IMemberAccountActionRepository repo, ICurrentUser caller, CancellationToken ct)
    {
        try
        {
            var rows = await repo.ListBlockedAsync(caller.MemberId, ct);
            IReadOnlyList<BlockedMemberDto> items = rows
                .Select(r => new BlockedMemberDto(
                    r.MemberId, r.GiftName, r.MemberNumber, r.ChapterName,
                    r.Reason, r.PerformedDate, r.BlockedByGiftName))
                .ToList();
            return TypedResults.Ok(items);
        }
        catch (MemberAccountActionException ex)
        {
            // Forbidden is the only reachable category here — usp_Member_ListBlocked
            // has no NotFound/BadRequest arm of its own.
            return TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden);
        }
    }

    private static async Task<Results<Ok<MemberAccountActionResultDto>, ValidationProblem, NotFound, ProblemHttpResult>> BlockMember(
        int memberId, MemberAccountActionRequest req,
        IMemberAccountActionRepository repo, ICurrentUser caller,
        IValidator<MemberAccountActionRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.BlockAsync(caller.MemberId, memberId, req.Reason, ct);
            return TypedResults.Ok(new MemberAccountActionResultDto(memberId, "Blocked"));
        }
        catch (MemberAccountActionException ex)
        {
            return ex.Category switch
            {
                MemberAccountActionErrorCategory.NotFound => TypedResults.NotFound(),
                MemberAccountActionErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static async Task<Results<Ok<MemberAccountActionResultDto>, ValidationProblem, NotFound, ProblemHttpResult>> UnblockMember(
        int memberId, MemberAccountActionRequest req,
        IMemberAccountActionRepository repo, ICurrentUser caller,
        IValidator<MemberAccountActionRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            await repo.UnblockAsync(caller.MemberId, memberId, req.Reason, ct);
            return TypedResults.Ok(new MemberAccountActionResultDto(memberId, "Unblocked"));
        }
        catch (MemberAccountActionException ex)
        {
            return ex.Category switch
            {
                MemberAccountActionErrorCategory.NotFound => TypedResults.NotFound(),
                MemberAccountActionErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static async Task<Results<Ok<MemberPasswordResetDto>, ValidationProblem, NotFound, ProblemHttpResult>> ResetMemberPassword(
        int memberId, MemberAccountActionRequest req,
        IMemberAccountActionRepository repo, IConfiguration config, ICurrentUser caller,
        IValidator<MemberAccountActionRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        // Generated here, never persisted or logged — same SHOW-ONCE discipline as
        // ReissueEnrolmentLink. Deliberately NO dry-run default password hash: a
        // National-triggered reset is a real security action, not a batch-onboarding
        // convenience, so the member sets his own new password via this link, exactly
        // as invariant #16 requires.
        var rawToken = OpaqueToken.GenerateRaw();
        var tokenHash = OpaqueToken.Hash(rawToken);

        try
        {
            var (_, expiresOn) = await repo.ResetPasswordAsync(caller.MemberId, memberId, req.Reason, tokenHash, ct);

            var webOrigin = (config["Web:Origin"] ?? "").TrimEnd('/');
            var enrolmentUrl = $"{webOrigin}/enrol/{rawToken}";

            return TypedResults.Ok(new MemberPasswordResetDto(memberId, enrolmentUrl, expiresOn));
        }
        catch (MemberAccountActionException ex)
        {
            return ex.Category switch
            {
                MemberAccountActionErrorCategory.NotFound => TypedResults.NotFound(),
                MemberAccountActionErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static async Task<Results<Ok<MemberIdentityUpdatedDto>, ValidationProblem, NotFound, ProblemHttpResult>> UpdateIdentity(
        int memberId, UpdateMemberIdentityRequest req,
        IMemberRepository repo, ICurrentUser caller,
        IValidator<UpdateMemberIdentityRequest> validator, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(req, ct);
        if (!validation.IsValid) return TypedResults.ValidationProblem(validation.ToDictionary());

        try
        {
            var result = await repo.UpdateIdentityByOfficerAsync(
                caller.MemberId, memberId, req.FirstName, req.MiddleName, req.LastName, req.MobileNo, req.RowVersion, ct);
            return TypedResults.Ok(new MemberIdentityUpdatedDto(result.RowVersion));
        }
        catch (MemberIdentityException ex)
        {
            return ex.Category switch
            {
                MemberIdentityErrorCategory.NotFound => TypedResults.NotFound(),
                MemberIdentityErrorCategory.Forbidden =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status403Forbidden),
                MemberIdentityErrorCategory.Conflict =>
                    TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status409Conflict),
                _ => TypedResults.Problem(detail: ex.Message, statusCode: StatusCodes.Status400BadRequest)
            };
        }
    }

    private static MemberProfileDto ToProfileDto(MemberOwnProfileResult result)
    {
        var p = result.Profile;
        return new MemberProfileDto(
            p.MemberId, p.MemberNumber,
            p.FirstName, p.MiddleName, p.LastName, p.GiftName,
            p.Birthdate is { } bd ? DateOnly.FromDateTime(bd) : null,
            p.DateSurvive is { } ds ? DateOnly.FromDateTime(ds) : null,
            p.PresidentDuringSurvive, p.MasterInitiatorDuringSurvive,
            p.ChapterId, p.ChapterName,
            p.HomeCouncilId, p.CouncilName,
            p.ChapterOfRecord,
            p.StatusName,
            p.RenewedThrough is { } rt ? DateOnly.FromDateTime(rt) : null,
            p.SeconderMemberId, p.ApprovedBy, p.ApprovedDate,
            p.Address, p.MobileNo, p.Email,
            p.BloodTypeId, p.BloodTypeName, p.BloodTypeConfirmedDate,
            p.Profession,
            // Same broken-link fix as the directory search above — only ever emitted when a
            // photo is actually set.
            p.PhotoPath is null ? null : $"/api/members/{p.MemberId}/photo",
            result.SkillIds,
            p.RowVersion);
    }
}
