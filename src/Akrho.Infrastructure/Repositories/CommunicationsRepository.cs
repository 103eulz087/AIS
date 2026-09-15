using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum CommsErrorCategory { NotFound, Conflict, Forbidden, BadRequest }

/// <summary>
/// Thrown when an Announcement, Memo, or Document (read-receipt) stored procedure rejects a
/// call. Every message on these THROWs was written in the procedure specifically to reach the
/// officer or member reading the screen — surface it plainly at the endpoint, never wrap it in
/// something generic. Mirrors <c>MeetingException</c>/<c>LedgerException</c> — same shape, kept
/// separate because this feature set has its own THROW number range (51168–51184).
/// </summary>
public sealed class CommsException : Exception
{
    public CommsErrorCategory Category { get; }

    public CommsException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // "Not found", including the deliberately-merged not-found/wrong-chapter cases —
            // 51181 (usp_Document_MarkRead) and 51182 (usp_Document_GetReadReceipts) each
            // reuse ONE THROW number for both "doesn't exist" and "belongs to another
            // chapter" (and 51182 ALSO doubles for "unrecognised document type" on that one
            // procedure specifically) — same anti-enumeration reasoning as usp_Meeting_Get's
            // own merged NotFound. There is no way to tell the causes apart from the SQL
            // error number alone, so all of them surface as 404 here.
            51169 or 51172 or 51181 or 51182 => CommsErrorCategory.NotFound,

            // The resource's state changed under the caller (already withdrawn) — nothing
            // about the request itself was invalid.
            51170 or 51174 => CommsErrorCategory.Conflict,

            // Role/chapter checks the procedures enforce, in addition to IScopeGuard and the
            // endpoint's authorization policy (defence in depth).
            51168 or 51171 or 51175 or 51176 or 51177 or 51179 or 51183 => CommsErrorCategory.Forbidden,

            // A malformed payload: a withdraw reason under 10 characters (51173), a
            // SupersedesMemoId that doesn't belong to the same chapter (51178), or an
            // unrecognised document type on MarkRead (51180 — MarkRead's OWN bad-type THROW,
            // unlike GetReadReceipts's merged 51182 above).
            51173 or 51178 or 51180 => CommsErrorCategory.BadRequest,

            _ => CommsErrorCategory.BadRequest
        };
    }
}

/// <summary>
/// The complete set of custom THROW numbers used by the Announcement/Memo/Document procs
/// this repository calls. 51184 (<c>TR_Memo_NoUpdateDelete</c>) is deliberately excluded —
/// no method here ever issues an UPDATE or DELETE against <c>dbo.Memo</c>, so that trigger
/// can never actually fire through this code path. Anything else — a timeout, a deadlock, a
/// dropped connection — is a real unexpected error and must NOT be re-surfaced as a safe,
/// human-authored message; it is left to propagate to the generic 500 handler instead
/// (CLAUDE.md: never leak an exception message to the client).
/// </summary>
internal static class CommsErrors
{
    private static readonly HashSet<int> Known =
    [
        51168, 51169, 51170, 51171, 51172, 51173, 51174, 51175, 51176,
        51177, 51178, 51179, 51180, 51181, 51182, 51183
    ];

    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>
/// One announcement row as usp_Announcement_Create/_Edit/_Withdraw/_GetForMember leave it.
/// HasRead reflects the CALLER's own read receipt only (see the procedure's own comment on
/// why a list endpoint must never leak another member's read state).
/// </summary>
public sealed record AnnouncementRow(
    int AnnouncementId, string Title, string Body, bool IsUrgent,
    int? UrgentTypeId, string? UrgentTypeName, int? BloodTypeId, string? BloodTypeName,
    DateTime PublishDate, DateTime? ExpiryDate, int CreatedBy,
    int? EditedBy, DateTime? EditedDate,
    bool IsWithdrawn, int? WithdrawnBy, DateTime? WithdrawnDate, string? WithdrawnReason,
    bool HasRead, int TotalCount);

/// <summary>
/// One memo row. IsSuperseded/SupersededByMemoId/SupersededByMemoNumber are computed by the
/// procedure's own join onto a later memo pointing back via SupersedesMemoId — never a
/// write-back column on this row (dbo.Memo is immutable once published).
/// </summary>
public sealed record MemoRow(
    int MemoId, string MemoNumber, string Title, string Body, DateTime PublishDate, int CreatedBy,
    int? SupersedesMemoId, bool IsSuperseded, int? SupersededByMemoId, string? SupersededByMemoNumber,
    bool HasRead, int TotalCount);

public sealed record MemoPublishResultRow(int MemoId, string MemoNumber);

public sealed record ReadReceiptRow(int MemberId, string GiftName, string? FirstName, string? LastName, DateTime ReadDate);

public interface IAnnouncementRepository
{
    /// <summary>Throws <see cref="CommsException"/> (Forbidden) if the caller is not a chapter officer/admin.</summary>
    Task<int> CreateAsync(
        int chapterId, int requestingMemberId, string title, string body, bool isUrgent,
        int? urgentTypeId, int? bloodTypeId, DateOnly? expiryDate, CancellationToken ct);

    /// <summary>Throws <see cref="CommsException"/> (NotFound / Conflict / Forbidden).</summary>
    Task EditAsync(
        int announcementId, int requestingMemberId, string title, string body, bool isUrgent,
        int? urgentTypeId, int? bloodTypeId, DateOnly? expiryDate, CancellationToken ct);

    /// <summary>Throws <see cref="CommsException"/> (NotFound / Conflict / Forbidden / BadRequest).</summary>
    Task WithdrawAsync(int announcementId, string reason, int requestingMemberId, CancellationToken ct);

    /// <summary>Throws <see cref="CommsException"/> (Forbidden) if the caller isn't an active member of the chapter.</summary>
    Task<IReadOnlyList<AnnouncementRow>> GetForMemberAsync(
        int chapterId, int requestingMemberId, int skip, int take, bool includeWithdrawn, CancellationToken ct);
}

/// <summary>
/// There is deliberately no Edit, Withdraw, or Delete method on this interface — dbo.Memo is
/// immutable once published (TR_Memo_NoUpdateDelete, error 51184). A correction is a NEW memo
/// referencing this one via SupersedesMemoId, never a write to the row.
/// </summary>
public interface IMemoRepository
{
    /// <summary>Throws <see cref="CommsException"/> (Forbidden / BadRequest).</summary>
    Task<MemoPublishResultRow> PublishAsync(
        int chapterId, int requestingMemberId, string subject, string body,
        int? supersedesMemoId, CancellationToken ct);

    /// <summary>Throws <see cref="CommsException"/> (Forbidden) if the caller isn't an active member of the chapter.</summary>
    Task<IReadOnlyList<MemoRow>> GetForMemberAsync(
        int chapterId, int requestingMemberId, int skip, int take, CancellationToken ct);
}

/// <summary>
/// Read receipts for BOTH document kinds (Announcement and Memo) — one small table, one
/// procedure pair, not worth two repositories.
/// </summary>
public interface IDocumentRepository
{
    /// <summary>
    /// Idempotent — safe to call every time a member opens a document. Throws
    /// <see cref="CommsException"/> (BadRequest for an unrecognised documentType; NotFound
    /// for a nonexistent document OR one outside the caller's own chapter — same code for
    /// both, deliberately, so a caller can't probe whether an id exists in another chapter).
    /// </summary>
    Task MarkReadAsync(string documentType, int documentId, int requestingMemberId, CancellationToken ct);

    /// <summary>Throws <see cref="CommsException"/> (NotFound / Forbidden).</summary>
    Task<IReadOnlyList<ReadReceiptRow>> GetReadReceiptsAsync(
        string documentType, int documentId, int requestingMemberId, CancellationToken ct);
}

public sealed class AnnouncementRepository(ISqlConnectionFactory factory) : IAnnouncementRepository
{
    public async Task<int> CreateAsync(
        int chapterId, int requestingMemberId, string title, string body, bool isUrgent,
        int? urgentTypeId, int? bloodTypeId, DateOnly? expiryDate, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "dbo.usp_Announcement_Create",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Title = title,
                    Body = body,
                    IsUrgent = isUrgent,
                    UrgentTypeId = urgentTypeId,
                    BloodTypeId = bloodTypeId,
                    ExpiryDate = expiryDate?.ToDateTime(TimeOnly.MinValue)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CommsErrors.IsKnown(ex.Number))
        {
            throw new CommsException(ex.Number, ex.Message);
        }
    }

    public async Task EditAsync(
        int announcementId, int requestingMemberId, string title, string body, bool isUrgent,
        int? urgentTypeId, int? bloodTypeId, DateOnly? expiryDate, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Announcement_Edit",
                new
                {
                    AnnouncementId = announcementId,
                    RequestingMemberId = requestingMemberId,
                    Title = title,
                    Body = body,
                    IsUrgent = isUrgent,
                    UrgentTypeId = urgentTypeId,
                    BloodTypeId = bloodTypeId,
                    ExpiryDate = expiryDate?.ToDateTime(TimeOnly.MinValue)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CommsErrors.IsKnown(ex.Number))
        {
            throw new CommsException(ex.Number, ex.Message);
        }
    }

    public async Task WithdrawAsync(int announcementId, string reason, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Announcement_Withdraw",
                new { AnnouncementId = announcementId, Reason = reason, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CommsErrors.IsKnown(ex.Number))
        {
            throw new CommsException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<AnnouncementRow>> GetForMemberAsync(
        int chapterId, int requestingMemberId, int skip, int take, bool includeWithdrawn, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<AnnouncementRow>(new CommandDefinition(
                "dbo.usp_Announcement_GetForMember",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 500),
                    IncludeWithdrawn = includeWithdrawn
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (CommsErrors.IsKnown(ex.Number))
        {
            throw new CommsException(ex.Number, ex.Message);
        }
    }
}

public sealed class MemoRepository(ISqlConnectionFactory factory) : IMemoRepository
{
    public async Task<MemoPublishResultRow> PublishAsync(
        int chapterId, int requestingMemberId, string subject, string body,
        int? supersedesMemoId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<MemoPublishResultRow>(new CommandDefinition(
                "dbo.usp_Memo_Publish",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Subject = subject,
                    Body = body,
                    SupersedesMemoId = supersedesMemoId
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CommsErrors.IsKnown(ex.Number))
        {
            throw new CommsException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<MemoRow>> GetForMemberAsync(
        int chapterId, int requestingMemberId, int skip, int take, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<MemoRow>(new CommandDefinition(
                "dbo.usp_Memo_GetForMember",
                new
                {
                    ChapterId = chapterId,
                    RequestingMemberId = requestingMemberId,
                    Skip = skip,
                    Take = Math.Clamp(take, 1, 500)
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (CommsErrors.IsKnown(ex.Number))
        {
            throw new CommsException(ex.Number, ex.Message);
        }
    }
}

public sealed class DocumentRepository(ISqlConnectionFactory factory) : IDocumentRepository
{
    public async Task MarkReadAsync(string documentType, int documentId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "dbo.usp_Document_MarkRead",
                new { DocumentType = documentType, DocumentId = documentId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (CommsErrors.IsKnown(ex.Number))
        {
            throw new CommsException(ex.Number, ex.Message);
        }
    }

    public async Task<IReadOnlyList<ReadReceiptRow>> GetReadReceiptsAsync(
        string documentType, int documentId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            var rows = await conn.QueryAsync<ReadReceiptRow>(new CommandDefinition(
                "dbo.usp_Document_GetReadReceipts",
                new { DocumentType = documentType, DocumentId = documentId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
            return rows.ToList();
        }
        catch (SqlException ex) when (CommsErrors.IsKnown(ex.Number))
        {
            throw new CommsException(ex.Number, ex.Message);
        }
    }
}
