/* Resolves every chapter beneath a council. The scoping primitive for the whole system. */
CREATE OR ALTER PROCEDURE dbo.usp_Council_GetSubtree
    @RootCouncilId INT
AS
BEGIN
    SET NOCOUNT ON;
    WITH CouncilTree AS (
        SELECT CouncilId, ParentCouncilId, CouncilName, 0 AS Depth
        FROM   dbo.Council WHERE CouncilId = @RootCouncilId
        UNION ALL
        SELECT c.CouncilId, c.ParentCouncilId, c.CouncilName, ct.Depth + 1
        FROM   dbo.Council c JOIN CouncilTree ct ON c.ParentCouncilId = ct.CouncilId
    )
    SELECT ch.ChapterId, ch.ChapterName, ct.CouncilId, ct.CouncilName, ct.Depth
    FROM   dbo.Chapter ch JOIN CouncilTree ct ON ch.ParentCouncilId = ct.CouncilId
    WHERE  ch.IsActive = 1
    OPTION (MAXRECURSION 20);
END
GO
