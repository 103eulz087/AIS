/* A chapter's own officer roster — current seats and ended terms, for the seat/unseat
   panel. Mirrors usp_Council_GetRoster's shape (no SeatOverride result set here — a
   chapter officer is always a member of that same chapter, so there is no
   outside-jurisdiction case to record). Scoped to members of the chapter itself
   (canViewOwnChapter-style access, checked by the caller's own membership) or a council
   officer with standing over it — either way, the endpoint layer passes @ChapterId
   straight from the caller's own JWT/claims for a member, never a raw request value
   (CLAUDE.md invariant #4). */
CREATE OR ALTER PROCEDURE dbo.usp_Chapter_GetRoster
    @ChapterId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.Chapter WHERE ChapterId = @ChapterId)
        THROW 51720, 'Chapter not found.', 1;

    DECLARE @Today DATE = CAST(SYSUTCDATETIME() AS DATE);

    SELECT  mr.MemberRoleId, co.OfficeId, co.OfficeName, co.SortOrder, co.GrantsLogin, r.RoleName,
            m.MemberId, m.GiftName, m.MemberNumber,
            m.FirstName + N' ' + m.LastName AS FullName,
            mr.TermStart, mr.TermEnd,
            -- "Current" here means the same thing usp_Chapter_SeatOfficer's own
            -- "office already held" check means: TermEnd IS NULL, full stop — never
            -- TermEnd >= @Today. That inclusive-of-today form (used elsewhere in this
            -- codebase for read-only historical reporting, where "he served through
            -- today" is the right answer) is wrong HERE: this roster's IsCurrent also
            -- decides whether this screen offers "Seat someone" or "Unseat" for an
            -- office, so a same-day unseat must be reflected immediately, not at
            -- midnight — otherwise a President who unseats an officer to replace him
            -- has no way to seat the replacement until the next day. Found live
            -- 2026-09-22: an unseat audited successfully every time, but the screen
            -- kept showing the outgoing officer as still seated for the rest of the day.
            CAST(CASE WHEN mr.TermStart <= @Today AND mr.TermEnd IS NULL
                      THEN 1 ELSE 0 END AS BIT) AS IsCurrent,
            m.RenewedThrough,
            CAST(CASE WHEN ua.AccountId IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS HasAccount
    FROM    dbo.MemberRole mr
            JOIN dbo.Member m ON m.MemberId = mr.MemberId
            JOIN dbo.Role r ON r.RoleId = mr.RoleId
            JOIN dbo.ChapterOffice co ON co.OfficeId = mr.OfficeId
            LEFT JOIN dbo.UserAccount ua ON ua.MemberId = m.MemberId
    WHERE   mr.ScopeType = 'Chapter' AND mr.ScopeId = @ChapterId AND mr.OfficeId IS NOT NULL
    ORDER BY co.SortOrder, mr.TermStart DESC, mr.MemberRoleId DESC;
END
GO
