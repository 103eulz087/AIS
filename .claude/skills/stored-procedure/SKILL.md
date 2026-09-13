---
name: stored-procedure
description: Write a SQL Server stored procedure for this project — naming, idempotency, scoping, append-only enforcement and the matching Dapper call. Use whenever the API needs data it cannot already get, or when adding/altering any query.
---

# Writing a stored procedure

All application data access in this repo goes through procedures. There is no inline SQL in C#.

## 1. Name and locate it

`db/procs/usp_<Entity>_<Action>.sql` — one procedure per file.
Actions: `Get`, `GetById`, `Search`, `Insert`, `Update`, `Approve`, `Reverse`, `Void`.

## 2. Template

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Member_Search
    @RequestingMemberId INT,
    @ChapterId          INT          = NULL,
    @Search             NVARCHAR(100)= NULL,
    @BloodTypeId        INT          = NULL,
    @SkillId            INT          = NULL,
    @IncludeInactive    BIT          = 0,
    @Skip               INT          = 0,
    @Take               INT          = 50
AS
BEGIN
    SET NOCOUNT ON;                      -- always. Dapper row counts lie without it.

    -- Scope: resolve what this caller may see. Never trust @ChapterId alone.
    DECLARE @CallerChapterId INT, @IsSameChapter BIT = 0;
    SELECT @CallerChapterId = ChapterId FROM dbo.Member WHERE MemberId = @RequestingMemberId;
    IF @ChapterId IS NULL SET @ChapterId = @CallerChapterId;
    IF @ChapterId = @CallerChapterId SET @IsSameChapter = 1;

    SELECT  m.MemberId, m.GiftName, m.MemberNumber, m.ChapterId, ch.ChapterName,
            ms.StatusName,
            -- Cross-chapter: name, chapter and status only. Nothing else.
            CASE WHEN @IsSameChapter = 1 THEN m.FirstName    END AS FirstName,
            CASE WHEN @IsSameChapter = 1 THEN m.LastName     END AS LastName,
            CASE WHEN @IsSameChapter = 1 THEN m.MobileNo     END AS MobileNo,
            CASE WHEN @IsSameChapter = 1 THEN bt.BloodTypeName END AS BloodType,
            CASE WHEN @IsSameChapter = 1 THEN m.Profession   END AS Profession
    FROM    dbo.Member m
            JOIN dbo.Chapter ch      ON ch.ChapterId = m.ChapterId
            JOIN dbo.MemberStatus ms ON ms.StatusId  = m.StatusId
            LEFT JOIN dbo.BloodType bt ON bt.BloodTypeId = m.BloodTypeId
    WHERE   m.ChapterId = @ChapterId
      AND   m.IsDeleted = 0
      AND   (@IncludeInactive = 1 OR ms.StatusName IN ('Approved','Active'))
      AND   (@Search IS NULL OR m.GiftName LIKE '%' + @Search + '%'
                             OR m.LastName LIKE '%' + @Search + '%')
      AND   (@BloodTypeId IS NULL OR m.BloodTypeId = @BloodTypeId)
      AND   (@SkillId IS NULL OR EXISTS (SELECT 1 FROM dbo.MemberSkill sk
                                         WHERE sk.MemberId = m.MemberId AND sk.SkillId = @SkillId))
    ORDER BY m.GiftName
    OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;
END
GO
```

## 3. Rules

- `CREATE OR ALTER` — deployment is re-runnable.
- `SET NOCOUNT ON;` first.
- Every read takes `@RequestingMemberId` and filters by it. **Do not assume scope was checked upstream.**
- Money `DECIMAL(18,2)`. Dates that mean a day are `DATE`. Timestamps `DATETIME2`, UTC.
- Parameterise. No concatenated user input, ever.
- Multi-step writes wrap in `BEGIN TRAN` / `COMMIT` with `TRY/CATCH` and `THROW`.

## 4. Council subtree

When a procedure must span a council's chapters:

```sql
WITH CouncilTree AS (
    SELECT CouncilId, ParentCouncilId FROM dbo.Council WHERE CouncilId = @RootCouncilId
    UNION ALL
    SELECT c.CouncilId, c.ParentCouncilId
    FROM dbo.Council c JOIN CouncilTree ct ON c.ParentCouncilId = ct.CouncilId
)
SELECT ch.ChapterId FROM dbo.Chapter ch JOIN CouncilTree ct ON ch.ParentCouncilId = ct.CouncilId
```

## 5. Append-only tables

`LedgerEntry`, `CorrectiveAction`, `AckReceipt`. **Never write an update or delete procedure for these.**
Corrections are new rows:

```sql
CREATE OR ALTER PROCEDURE dbo.usp_Ledger_Reverse
    @LedgerEntryId INT, @Reason NVARCHAR(400), @PerformedBy INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.LedgerEntry (ChapterId, EntryDate, EntryType, Amount, Description,
                            SourceType, SourceId, IsReversal, ReversesEntryId, CreatedBy, CreatedDate)
    SELECT ChapterId, CAST(SYSUTCDATETIME() AS DATE),
           CASE WHEN EntryType = 'In' THEN 'Out' ELSE 'In' END,
           Amount, CONCAT('Reversal: ', @Reason), SourceType, SourceId,
           1, @LedgerEntryId, @PerformedBy, SYSUTCDATETIME()
    FROM dbo.LedgerEntry WHERE LedgerEntryId = @LedgerEntryId;
END
GO
```

## 6. Hand back to the backend agent

Always finish with the exact Dapper call:

```csharp
var rows = await conn.QueryAsync<MemberListRow>(
    "dbo.usp_Member_Search",
    new { RequestingMemberId = caller.MemberId, ChapterId = req.ChapterId, req.Search,
          req.BloodTypeId, req.SkillId, req.Skip, req.Take },
    commandType: CommandType.StoredProcedure);
```
