using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum CouncilPermissionErrorCategory { NotFound, Forbidden, BadRequest }

/// <summary>
/// Thrown when usp_CouncilPermission_GetGrid or usp_CouncilPermission_Set rejects a call.
/// Every message was written in the procedure for a council officer reading the screen;
/// surfaced plainly, same convention as every other feature exception in this codebase
/// (CLAUDE.md: never leak a raw exception message, but a procedure's own THROW text is not
/// that — it was authored to be shown).
/// </summary>
public sealed class CouncilPermissionException : Exception
{
    public CouncilPermissionErrorCategory Category { get; }

    public CouncilPermissionException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // GetGrid: the council is outside what the caller may even view — same
            // anti-enumeration posture as usp_Council_GetRegistry/_GetRoster (51690-51692),
            // surfaced as 404 so a council id outside scope cannot be distinguished from
            // one that doesn't exist.
            51930 => CouncilPermissionErrorCategory.NotFound,
            // Set: caller does not hold a live PRESIDING seat on @CouncilId itself.
            51931 => CouncilPermissionErrorCategory.Forbidden,
            // Set: 51932-51936 are all batch validation failures (unrecognised/inactive key,
            // presiding office targeted, write key on a read-only office, national-only key
            // off National, or a RequiresKey dependency left unsatisfied).
            _ => CouncilPermissionErrorCategory.BadRequest
        };
    }
}

internal static class CouncilPermissionErrors
{
    private static readonly HashSet<int> Known = [51930, 51931, 51932, 51933, 51934, 51935, 51936];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>Result set 1 of usp_CouncilPermission_GetGrid. CanEdit is whether the CALLER
/// himself holds a currently-seated PRESIDING office on this EXACT council — never a
/// parent's President, never a lower seat.</summary>
public sealed record CouncilPermissionHeaderRow(int CouncilId, string CouncilName, bool IsNational, bool CanEdit);

/// <summary>Result set 2 — one row per council office, the grid's rows.</summary>
public sealed record CouncilPermissionOfficeRow(int Id, string Name, bool IsPresiding, bool IsReadOnly);

/// <summary>Result set 3 — one row per grantable, active catalog key, the grid's columns.
/// National-only keys are only present when the council itself IS National.</summary>
public sealed record CouncilPermissionKeyRow(
    string PermissionKey, string DisplayName, string? Description, bool IsWrite, bool IsNationalOnly,
    string? RequiresKey, int SortOrder);

/// <summary>Result set 4 — one row per (office, key) cell, from fn_CouncilEffectivePermissions.</summary>
public sealed record CouncilPermissionCellRow(
    int CouncilOfficeId, string PermissionKey, bool IsGranted, bool IsDefault, bool IsLocked, string? LockReason);

/// <summary>Result set 5 — the last 50 changes made to this council's grid, newest first.</summary>
public sealed record CouncilPermissionHistoryRow(
    long HistoryId, int CouncilOfficeId, string OfficeName, string PermissionKey,
    bool WasGranted, bool IsGranted, int ChangedBy, string ChangedByGiftName, DateTime ChangedDate, string? Reason);

/// <summary>The five result sets of usp_CouncilPermission_GetGrid, read in order.</summary>
public sealed record CouncilPermissionGridRows(
    CouncilPermissionHeaderRow Header,
    IReadOnlyList<CouncilPermissionOfficeRow> Offices,
    IReadOnlyList<CouncilPermissionKeyRow> Permissions,
    IReadOnlyList<CouncilPermissionCellRow> Cells,
    IReadOnlyList<CouncilPermissionHistoryRow> History);

/// <summary>One cell change requested by the caller — (office, key, desired grant state).
/// Cells whose effective value would not actually change are silently skipped server-side.</summary>
public sealed record CouncilPermissionChangeInput(int CouncilOfficeId, string PermissionKey, bool IsGranted);

public sealed record CouncilPermissionSetResultRow(int ChangedCount);

/// <summary>Result set 1 of usp_CouncilPermission_GetMine — one row per council the caller
/// currently holds a LIVE seat on. CanManagePermissions mirrors the grid's own CanEdit:
/// does this seat's own office preside (i.e. is it this council's President).</summary>
public sealed record CouncilPermissionSeatRow(int CouncilId, string CouncilName, string OfficeName, bool CanManagePermissions);

/// <summary>Result set 2 of usp_CouncilPermission_GetMine — one row per (council, key) the
/// caller currently holds, from fn_MemberSeatPermissions.</summary>
public sealed record CouncilPermissionMineRow(int CouncilId, string PermissionKey);

public sealed record CouncilPermissionMineRows(
    IReadOnlyList<CouncilPermissionSeatRow> Seats,
    IReadOnlyList<CouncilPermissionMineRow> Permissions);

public interface ICouncilPermissionRepository
{
    /// <summary>
    /// Visible to anyone inside the caller's own dbo.fn_MemberCouncilScope (same visibility
    /// as usp_Council_GetRoster/usp_Council_GetRegistry) — never anyone else. Throws
    /// <see cref="CouncilPermissionException"/> (NotFound) if the council is outside what the
    /// caller may view at all (CLAUDE.md invariant #4 — councilId is never trusted on its own).
    /// </summary>
    Task<CouncilPermissionGridRows> GetGridAsync(int requestingMemberId, int councilId, CancellationToken ct);

    /// <summary>
    /// Only the council's own currently-seated President may call this — a parent council's
    /// President cannot reach down and edit a child's grid. Returns the number of cells
    /// actually changed (0 when every requested change was already the current state).
    /// Throws <see cref="CouncilPermissionException"/> (Forbidden / BadRequest) per
    /// usp_CouncilPermission_Set's own 51931-51936.
    /// </summary>
    Task<int> SetAsync(
        int requestingMemberId, int councilId, IReadOnlyList<CouncilPermissionChangeInput> changes,
        string? reason, CancellationToken ct);

    /// <summary>
    /// "What can I do, and where" — the caller's own council seats and the effective
    /// permissions each one currently carries. No scoping check needed: this is always and
    /// only the caller's own data (CLAUDE.md invariant #4 is trivially satisfied).
    /// </summary>
    Task<CouncilPermissionMineRows> GetMineAsync(int memberId, CancellationToken ct);
}

public sealed class CouncilPermissionRepository(ISqlConnectionFactory factory) : ICouncilPermissionRepository
{
    public async Task<CouncilPermissionGridRows> GetGridAsync(int requestingMemberId, int councilId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
                "dbo.usp_CouncilPermission_GetGrid",
                new { RequestingMemberId = requestingMemberId, CouncilId = councilId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            var header = await multi.ReadSingleAsync<CouncilPermissionHeaderRow>();
            var offices = (await multi.ReadAsync<CouncilPermissionOfficeRow>()).ToList();
            var permissions = (await multi.ReadAsync<CouncilPermissionKeyRow>()).ToList();
            var cells = (await multi.ReadAsync<CouncilPermissionCellRow>()).ToList();
            var history = (await multi.ReadAsync<CouncilPermissionHistoryRow>()).ToList();

            return new CouncilPermissionGridRows(header, offices, permissions, cells, history);
        }
        catch (SqlException ex) when (CouncilPermissionErrors.IsKnown(ex.Number))
        {
            throw new CouncilPermissionException(ex.Number, ex.Message);
        }
    }

    public async Task<int> SetAsync(
        int requestingMemberId, int councilId, IReadOnlyList<CouncilPermissionChangeInput> changes,
        string? reason, CancellationToken ct)
    {
        var table = new DataTable();
        table.Columns.Add("CouncilOfficeId", typeof(int));
        table.Columns.Add("PermissionKey", typeof(string));
        table.Columns.Add("IsGranted", typeof(bool));
        foreach (var c in changes)
            table.Rows.Add(c.CouncilOfficeId, c.PermissionKey, c.IsGranted);

        using var conn = await factory.OpenAsync(ct);
        try
        {
            var result = await conn.QuerySingleAsync<CouncilPermissionSetResultRow>(new CommandDefinition(
                "dbo.usp_CouncilPermission_Set",
                new
                {
                    RequestingMemberId = requestingMemberId,
                    CouncilId = councilId,
                    Changes = table.AsTableValuedParameter("dbo.CouncilPermissionChangeRow"),
                    Reason = reason
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));

            return result.ChangedCount;
        }
        catch (SqlException ex) when (CouncilPermissionErrors.IsKnown(ex.Number))
        {
            throw new CouncilPermissionException(ex.Number, ex.Message);
        }
    }

    public async Task<CouncilPermissionMineRows> GetMineAsync(int memberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        // No THROW numbers to translate here — usp_CouncilPermission_GetMine never rejects a
        // call (it is always and only the caller's own data; CLAUDE.md invariant #4 is
        // trivially satisfied), so no try/catch mapping is needed.
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
            "dbo.usp_CouncilPermission_GetMine",
            new { MemberId = memberId },
            commandType: CommandType.StoredProcedure, cancellationToken: ct));

        var seats = (await multi.ReadAsync<CouncilPermissionSeatRow>()).ToList();
        var permissions = (await multi.ReadAsync<CouncilPermissionMineRow>()).ToList();

        return new CouncilPermissionMineRows(seats, permissions);
    }
}
