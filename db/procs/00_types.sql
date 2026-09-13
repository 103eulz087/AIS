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
