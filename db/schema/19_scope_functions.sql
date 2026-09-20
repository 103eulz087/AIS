/* 19 — Scope primitives: two INLINE table-valued functions that resolve "everything
   beneath a council" and "everything a member may see", reusable inside a JOIN.

   =====================================================================================
   WHY THESE LIVE HERE AND NOT IN db/procs/ — DO NOT "HELPFULLY" MOVE THEM LATER.

   scripts/db-deploy.sh globs db/procs/usp_*.sql alphabetically for stored procedures,
   and that deploy step runs AFTER every numbered file in db/schema/ has already run. A
   file named fn_*.sql dropped into db/procs/ would be silently skipped by that glob (it
   only matches usp_*), and any proc that references a missing function fails at CREATE
   time — SQL Server does not give functions deferred name resolution the way it does
   tables (a CREATE PROCEDURE referencing a not-yet-existing TABLE compiles fine and only
   fails at execution; the same proc referencing a not-yet-existing FUNCTION fails to
   CREATE at all). Putting these two functions in a numbered db/schema/ file guarantees
   they exist before any proc that uses them, deploy after deploy, forever.
   =====================================================================================

   Both functions below are INLINE table-valued functions — the body is a single
   `RETURN (SELECT ...)`, not a multi-statement function with a BEGIN/END block and a
   declared @ReturnTable. An inline TVF's query is expanded by the optimizer at the call
   site, so it composes into a JOIN or CROSS APPLY like a parameterised view. Contrast
   dbo.usp_Council_GetSubtree (db/procs/), which can only be EXEC'd into a table
   variable — that limitation is exactly why usp_ChapterRegistration_GetQueue.sql has to
   open a cursor, looping once per seated council, just to reuse it. These two functions
   exist so nothing written from here on ever needs that workaround again.
   (usp_ChapterRegistration_GetQueue.sql itself is left untouched — it is in production
   use and refactoring it onto this new primitive is out of scope for this module.)

   Every recursive tree-walk in this codebase bounds MAXRECURSION explicitly so a cycle
   in the data — which should never exist, since Council has no DB-level cycle guard —
   errors instead of hanging. 20 matches every other tree-walk here (usp_Council_GetSubtree,
   usp_Chapter_ListPublic, usp_ChapterRegistration_Get, usp_Council_Seating,
   usp_Credential_GetOrIssueForSelf, usp_Enrolment_Issue): five real levels (National ->
   Regional -> Provincial -> City/Municipal -> Chapter) plus generous headroom. */

CREATE OR ALTER FUNCTION dbo.fn_CouncilSubtree (@RootCouncilId INT)
RETURNS TABLE
AS
RETURN
(
    WITH CouncilTree AS (
        SELECT  c.CouncilId, c.ParentCouncilId, 0 AS Depth
        FROM    dbo.Council c
        WHERE   c.CouncilId = @RootCouncilId
        UNION ALL
        SELECT  c.CouncilId, c.ParentCouncilId, ct.Depth + 1
        FROM    dbo.Council c
                JOIN CouncilTree ct ON c.ParentCouncilId = ct.CouncilId
        WHERE   ct.Depth < 20
    )
    SELECT CouncilId, ParentCouncilId, Depth
    FROM   CouncilTree
    -- OPTION (MAXRECURSION ...) is illegal inside an inline TVF body (SQL Server rejects
    -- it at CREATE time — confirmed live, not a style choice). The WHERE ct.Depth < 20
    -- guard above the recursive term is the equivalent bound: five real levels (National
    -- -> Regional -> Provincial -> City/Municipal -> Chapter's own parent) plus headroom,
    -- same 20 every other tree-walk in this codebase uses.
);
GO

/* The reusable "what may this caller see" primitive. Every currently-termed Council-scoped
   MemberRole a member holds contributes its own subtree; the result is the UNION (via
   CROSS APPLY + DISTINCT, not a cursor) of all of them. A member seated at exactly one
   council (the common case) gets back that council's own subtree. A member seated at two
   (rare, but the schema does not forbid it — see 17_chapter_registration.sql's own note on
   usp_Auth_GetClaims never assuming at-most-one-role-per-member) gets back the union of
   both — correct, since he may legitimately see either.

   "Currently-termed" mirrors dbo.fn_CouncilHasSeatedOfficers's own TermStart/TermEnd test
   (db/procs/usp_Approval_Routing.sql) and usp_ChapterRegistration_GetQueue.sql's identical
   inline check — reuse that exact condition here rather than inventing a fourth spelling
   of "is this seat currently held" in the codebase. */
CREATE OR ALTER FUNCTION dbo.fn_MemberCouncilScope (@MemberId INT)
RETURNS TABLE
AS
RETURN
(
    SELECT DISTINCT st.CouncilId
    FROM   dbo.MemberRole mr
           CROSS APPLY dbo.fn_CouncilSubtree(mr.ScopeId) st
    WHERE  mr.MemberId  = @MemberId
      AND  mr.ScopeType = 'Council'
      AND  mr.TermStart <= CAST(SYSUTCDATETIME() AS DATE)
      AND  (mr.TermEnd IS NULL OR mr.TermEnd >= CAST(SYSUTCDATETIME() AS DATE))
);
GO
