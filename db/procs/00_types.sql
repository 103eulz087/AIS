/* Table-valued parameters. Deployed before any procedure that uses them. */
IF TYPE_ID('dbo.AttendanceRow') IS NULL
CREATE TYPE dbo.AttendanceRow AS TABLE (
    MemberId           INT NOT NULL,
    AttendanceStatusId INT NOT NULL,
    FundAmount         DECIMAL(18,2) NOT NULL DEFAULT 0,
    CheckedInVia       NVARCHAR(10) NULL
);
GO
IF TYPE_ID('dbo.RenewalRow') IS NULL
CREATE TYPE dbo.RenewalRow AS TABLE (
    MemberId      INT NOT NULL,
    RenewalStatus NVARCHAR(10) NOT NULL      -- Renewed | Lapsed | Exempt
);
GO
/* A simple id list. First consumer: usp_Expense_Create's @AttachmentStagingIds — the
   set of dbo.AttachmentStaging rows an expense claims atomically. Kept generic (a bare
   Value column, no per-feature name) since an id list has no shape of its own to add to;
   a second caller with a different set of ids reuses this same type rather than a
   near-identical one being declared per feature. */
IF TYPE_ID('dbo.IntList') IS NULL
CREATE TYPE dbo.IntList AS TABLE (
    Value INT NOT NULL PRIMARY KEY
);
GO
