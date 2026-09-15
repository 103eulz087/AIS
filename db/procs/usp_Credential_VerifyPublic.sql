/* Digital ID module, slice 1. The public verification page's ONLY data source — the
   proc behind https://verify.<domain>/v/<token> (docs §4.10). Anyone with a phone camera
   reaches this with no app and no login, so this is deliberately the one genuinely public,
   unauthenticated READ in the whole system.

   ===========================================================================
   SCOPING EXCEPTION — DELIBERATE. DO NOT "FIX" BY ADDING A SCOPE PARAMETER.
   Every other read procedure in this system takes @RequestingMemberId and filters by the
   caller's permitted chapter/council subtree (CLAUDE.md invariant #4, enforced again here
   at the database, never assumed checked upstream). This proc has no such parameter, on
   purpose: @TokenSubject IS the scope. A valid, live, non-revoked credential token is
   itself the caller's entire authorization to see the four facts below — there is no
   signed-in caller to scope, and adding a @ChapterId/@RequestingMemberId parameter here
   would either break the public page (it has neither) or accomplish nothing (a token
   already resolves to exactly one member; nothing about the caller narrows that further).
   ===========================================================================

   NEVER A SECOND PATH INTO VERIFICATION (invariant #9). This proc is reachable ONLY via a
   MemberCredential.TokenSubject. There is no member-number parameter, no ChapterId
   parameter, nothing a commemorative-card module could point at instead — a commemorative
   card has no QR and no verification endpoint, and must never gain one by reusing this
   proc's shape with a different lookup key bolted on.

   ANTI-ENUMERATION. An unknown token, a revoked credential, an expired credential, and a
   credential whose owning member has since been deleted/soft-deleted all collapse to the
   IDENTICAL result shape below (four NULLs, IsValid = 0) — same posture as
   usp_Attachment_GetForDownload's identical "not found" for a bad id vs. a wrong-chapter
   caller. Nothing in the shape returned to the CALLER tells them which case it was. The
   distinct ResultCode is recorded in dbo.ScanLog for internal audit only — never surfaced
   here.

   RETURNED DATA (invariant #7, extended per product decision for the photo endpoint
   alongside this one): GiftName, ChapterName, MemberStatus.StatusName, RenewedThrough
   (raw, nullable, untransformed — wording is the API/frontend's job). Nothing else: no
   legal name, no member number, no blood type, no council chain, no address, no contact
   info.

   AUDIT (invariant #10). Every call — valid or not — writes one dbo.ScanLog row in the
   same transaction as the read, recording which of Live/Invalid/Revoked/Expired actually
   happened. This is the scan's own audit trail (a member can see who verified his card and
   when — docs §4.10) as well as the write this invariant requires. */
CREATE OR ALTER PROCEDURE dbo.usp_Credential_VerifyPublic
    @TokenSubject       UNIQUEIDENTIFIER,
    @ScannedByMemberId  INT           = NULL,  -- NULL for the anonymous public page; set for an in-app scan by a signed-in member
    @MeetingId          INT           = NULL,  -- attendance-scan context, when applicable
    @WasOffline         BIT           = 0,
    @DeviceHint         NVARCHAR(120) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @CredentialId INT, @MemberId INT, @RevokedDate DATETIME2, @ExpiryDate DATETIME2, @IsDeleted BIT;
    DECLARE @ResultCode NVARCHAR(20);

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
        -- CredentialId is nullable on dbo.ScanLog precisely for this case: an unknown
        -- token still gets logged, with no credential to point at.
        INSERT dbo.ScanLog (CredentialId, ScannedByMemberId, ResultCode, WasOffline, MeetingId, DeviceHint)
        VALUES (@CredentialId, @ScannedByMemberId, @ResultCode, @WasOffline, @MeetingId, @DeviceHint);
    COMMIT;

    IF @ResultCode <> 'Live'
    BEGIN
        -- Identical shape for Invalid / Revoked / Expired — see header comment.
        SELECT  CAST(NULL AS NVARCHAR(60))  AS GiftName,
                CAST(NULL AS NVARCHAR(150)) AS ChapterName,
                CAST(NULL AS NVARCHAR(30))  AS StatusName,
                CAST(NULL AS DATE)          AS RenewedThrough,
                CAST(0 AS BIT)              AS IsValid;
        RETURN;
    END

    SELECT  m.GiftName,
            ch.ChapterName,        -- LEFT JOIN: a detached, council-homed member (invariant #14) has no ChapterId
            ms.StatusName,
            m.RenewedThrough,      -- raw, nullable, untransformed
            CAST(1 AS BIT) AS IsValid
    FROM    dbo.Member m
            LEFT JOIN dbo.Chapter ch  ON ch.ChapterId = m.ChapterId
            JOIN      dbo.MemberStatus ms ON ms.StatusId = m.StatusId
    WHERE   m.MemberId = @MemberId;
END
GO
