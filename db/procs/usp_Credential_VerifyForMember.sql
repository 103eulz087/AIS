/* Digital ID module, slice A (in-app scan). The signed-in counterpart to
   usp_Credential_VerifyPublic — same validity resolution, same anti-enumeration
   shape, same ScanLog write — but reachable only from inside the app, by a member
   who is already authenticated, so it can safely return more than the public page's
   four facts when the two members happen to share a chapter.

   WHY A SEPARATE PROC, NOT VerifyPublic PLUS A PARAMETER. usp_Credential_VerifyPublic's
   own header forbids adding a scope/requester parameter to it: that proc's only
   caller is the fully anonymous public verification page, and bolting a
   @RequestingMemberId onto it would either be ignored there (dead parameter) or
   quietly change what an unauthenticated caller can get back. This proc exists
   instead, with its own @RequestingMemberId that is NEVER optional and NEVER taken
   from anywhere but the caller's own JWT-derived identity (CLAUDE.md invariant #4 —
   scoping is re-checked here, not assumed done by the API layer). It is always an
   in-app scan, so unlike VerifyPublic there is no NULL-scanner case to allow for.

   VALIDITY RESOLUTION — copied exactly from usp_Credential_VerifyPublic: unknown
   token or a soft-deleted owning member -> Invalid; RevokedDate set -> Revoked;
   ExpiryDate <= SYSUTCDATETIME() -> Expired; otherwise Live. No @MeetingId here —
   attendance scanning is a separate module and out of scope for this slice.

   ANTI-ENUMERATION. Exactly like VerifyPublic: Invalid, Revoked and Expired all
   collapse to one identical result shape (every field NULL/0, IsValid = 0) so the
   caller cannot learn which case it was from the shape of the response. The real
   ResultCode still goes to dbo.ScanLog for internal audit only, never back to the
   caller.

   INVARIANT #7 SAME-CHAPTER GATING — DECIDED HERE, NOT BY THE CALLER. On a Live
   result every caller gets back the same four public facts VerifyPublic returns
   (GiftName, ChapterName, StatusName, RenewedThrough — LEFT JOIN Chapter so a
   detached, council-homed member per invariant #14 still resolves). FullName,
   MemberNumber and BloodTypeName are extra, and are gated by a single CASE
   expression in the SELECT on whether the scanning member's own ChapterId equals
   the scanned member's ChapterId (both non-NULL) — never two separate result sets,
   never left for the API/frontend to filter after the fact. A detached,
   council-homed member (ChapterId NULL on either side) can never satisfy this, by
   construction, which is the correct outcome: "same chapter" has no meaning for a
   member with no chapter.

   AUDIT (invariant #10). One dbo.ScanLog row per call, valid or not, written in the
   same transaction as the read, with ScannedByMemberId = @RequestingMemberId always
   populated (this proc is never anonymous). This is both the scan's own audit trail
   (usp_ScanLog_ListForSelf is the other half — "who scanned my card") and the write
   invariant #10 requires; there is no separate AuditLog insert to make here. */
CREATE OR ALTER PROCEDURE dbo.usp_Credential_VerifyForMember
    @TokenSubject       UNIQUEIDENTIFIER,
    @RequestingMemberId INT,
    @WasOffline         BIT           = 0,
    @DeviceHint         NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @CredentialId INT, @MemberId INT, @RevokedDate DATETIME2, @ExpiryDate DATETIME2, @IsDeleted BIT;
    DECLARE @ResultCode NVARCHAR(20);
    DECLARE @ScannerChapterId INT;

    SELECT @ScannerChapterId = ChapterId
    FROM   dbo.Member
    WHERE  MemberId = @RequestingMemberId;

    SELECT  @CredentialId = mc.CredentialId,
            @MemberId     = mc.MemberId,
            @RevokedDate  = mc.RevokedDate,
            @ExpiryDate   = mc.ExpiryDate,
            @IsDeleted    = m.IsDeleted
    FROM    dbo.MemberCredential mc
            JOIN dbo.Member m ON m.MemberId = mc.MemberId
    WHERE   mc.TokenSubject = @TokenSubject;

    IF @CredentialId IS NULL OR @IsDeleted = 1
        SET @ResultCode = 'Invalid';
    ELSE IF @RevokedDate IS NOT NULL
        SET @ResultCode = 'Revoked';
    ELSE IF @ExpiryDate <= SYSUTCDATETIME()
        SET @ResultCode = 'Expired';
    ELSE
        SET @ResultCode = 'Live';

    BEGIN TRAN;
        -- CredentialId is nullable on dbo.ScanLog precisely for the unknown-token case.
        -- ScannedByMemberId is always populated here — this proc is never anonymous.
        INSERT dbo.ScanLog (CredentialId, ScannedByMemberId, ResultCode, WasOffline, MeetingId, DeviceHint)
        VALUES (@CredentialId, @RequestingMemberId, @ResultCode, @WasOffline, NULL, @DeviceHint);
    COMMIT;

    IF @ResultCode <> 'Live'
    BEGIN
        -- Identical shape for Invalid / Revoked / Expired — see header comment.
        SELECT  CAST(NULL AS NVARCHAR(60))  AS GiftName,
                CAST(NULL AS NVARCHAR(150)) AS ChapterName,
                CAST(NULL AS NVARCHAR(30))  AS StatusName,
                CAST(NULL AS DATE)          AS RenewedThrough,
                CAST(0 AS BIT)              AS IsSameChapter,
                CAST(NULL AS NVARCHAR(170)) AS FullName,
                CAST(NULL AS NVARCHAR(30))  AS MemberNumber,
                CAST(NULL AS NVARCHAR(5))   AS BloodTypeName,
                CAST(0 AS BIT)              AS IsValid;
        RETURN;
    END

    SELECT  m.GiftName,
            ch.ChapterName,     -- LEFT JOIN: a detached, council-homed member (invariant #14) has no ChapterId
            ms.StatusName,
            m.RenewedThrough,   -- raw, nullable, untransformed
            CAST(CASE WHEN m.ChapterId IS NOT NULL
                       AND @ScannerChapterId IS NOT NULL
                       AND m.ChapterId = @ScannerChapterId
                      THEN 1 ELSE 0 END AS BIT) AS IsSameChapter,
            CASE WHEN m.ChapterId IS NOT NULL
                  AND @ScannerChapterId IS NOT NULL
                  AND m.ChapterId = @ScannerChapterId
                 THEN m.FirstName + N' ' + m.LastName
                 ELSE NULL END AS FullName,
            CASE WHEN m.ChapterId IS NOT NULL
                  AND @ScannerChapterId IS NOT NULL
                  AND m.ChapterId = @ScannerChapterId
                 THEN m.MemberNumber
                 ELSE NULL END AS MemberNumber,
            CASE WHEN m.ChapterId IS NOT NULL
                  AND @ScannerChapterId IS NOT NULL
                  AND m.ChapterId = @ScannerChapterId
                 THEN bt.BloodTypeName
                 ELSE NULL END AS BloodTypeName,
            CAST(1 AS BIT) AS IsValid
    FROM    dbo.Member m
            LEFT JOIN dbo.Chapter ch    ON ch.ChapterId = m.ChapterId
            JOIN      dbo.MemberStatus ms ON ms.StatusId = m.StatusId
            LEFT JOIN dbo.BloodType bt  ON bt.BloodTypeId = m.BloodTypeId
    WHERE   m.MemberId = @MemberId;
END
GO
