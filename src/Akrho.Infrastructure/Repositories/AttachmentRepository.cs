using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Akrho.Infrastructure.Repositories;

/// <summary>How the endpoint layer decides which HTTP status a rejected call becomes.</summary>
public enum AttachmentErrorCategory { NotFound, Forbidden, BadRequest }

/// <summary>
/// Thrown when an Attachment stored procedure rejects a call. Same pattern as
/// <see cref="MeetingException"/> — every message was written in the procedure to reach
/// the caller directly.
/// </summary>
public sealed class AttachmentException : Exception
{
    public AttachmentErrorCategory Category { get; }

    public AttachmentException(int sqlErrorNumber, string message) : base(message)
    {
        Category = sqlErrorNumber switch
        {
            // Same "not found" for a nonexistent id and a wrong-chapter caller —
            // anti-enumeration, same pattern as usp_Expense_Get.
            51214 => AttachmentErrorCategory.NotFound,

            // The caller is not a member of the chapter it is staging into.
            51212 => AttachmentErrorCategory.Forbidden,

            // Defence-in-depth only; the upload endpoint already rejects an empty file.
            51213 => AttachmentErrorCategory.BadRequest,

            _ => AttachmentErrorCategory.BadRequest
        };
    }
}

internal static class AttachmentErrors
{
    private static readonly HashSet<int> Known = [51212, 51213, 51214];
    public static bool IsKnown(int sqlErrorNumber) => Known.Contains(sqlErrorNumber);
}

/// <summary>FilePath here is IFileStorage's storage-relative identifier, never an absolute path.</summary>
public sealed record AttachmentDownloadRow(string FilePath, string FileName, string? ContentType);

public interface IAttachmentRepository
{
    /// <summary>Throws <see cref="AttachmentException"/> (Forbidden / BadRequest).</summary>
    Task<int> StageAsync(
        int chapterId, int uploadedBy, string filePath, string fileName,
        long fileSize, string? contentType, CancellationToken ct);

    /// <summary>Throws <see cref="AttachmentException"/> (NotFound) — same message for a bad
    /// id and for a wrong-chapter caller.</summary>
    Task<AttachmentDownloadRow> GetForDownloadAsync(int attachmentStagingId, int requestingMemberId, CancellationToken ct);
}

public sealed class AttachmentRepository(ISqlConnectionFactory factory) : IAttachmentRepository
{
    public async Task<int> StageAsync(
        int chapterId, int uploadedBy, string filePath, string fileName,
        long fileSize, string? contentType, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "dbo.usp_Attachment_Stage",
                new
                {
                    ChapterId = chapterId,
                    UploadedBy = uploadedBy,
                    FilePath = filePath,
                    FileName = fileName,
                    FileSize = checked((int)fileSize),
                    ContentType = contentType
                },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (AttachmentErrors.IsKnown(ex.Number))
        {
            throw new AttachmentException(ex.Number, ex.Message);
        }
    }

    public async Task<AttachmentDownloadRow> GetForDownloadAsync(int attachmentStagingId, int requestingMemberId, CancellationToken ct)
    {
        using var conn = await factory.OpenAsync(ct);
        try
        {
            return await conn.QuerySingleAsync<AttachmentDownloadRow>(new CommandDefinition(
                "dbo.usp_Attachment_GetForDownload",
                new { AttachmentStagingId = attachmentStagingId, RequestingMemberId = requestingMemberId },
                commandType: CommandType.StoredProcedure, cancellationToken: ct));
        }
        catch (SqlException ex) when (AttachmentErrors.IsKnown(ex.Number))
        {
            throw new AttachmentException(ex.Number, ex.Message);
        }
    }
}
