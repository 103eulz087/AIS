using Microsoft.Extensions.Configuration;

namespace Akrho.Infrastructure.Storage;

/// <summary>
/// What gets handed back after a successful save. <see cref="RelativePath"/> is a
/// storage-relative identifier (currently just the generated on-disk filename) — NOT an
/// absolute OS path, and not anything derived from the caller's own filename. It is what
/// gets persisted in <c>dbo.AttachmentStaging.FilePath</c> and handed back into
/// <see cref="IFileStorage.OpenReadAsync"/> later; only <see cref="IFileStorage"/> itself
/// ever resolves it against the configured root.
/// </summary>
public sealed record StoredFile(string RelativePath, long FileSize);

/// <summary>
/// Where attachments (receipt photos/PDFs staged for an expense) actually live on disk.
/// Every file is saved under a server-generated GUID name; the caller's own filename is
/// NEVER used to build the on-disk path — that would be a path-traversal vector the moment
/// any client sent one containing "..", a drive letter, or a UNC prefix. The original name
/// is kept only for display, by the caller, in a database column separate from the path.
/// </summary>
public interface IFileStorage
{
    Task<StoredFile> SaveAsync(Stream content, string originalFileName, string contentType, CancellationToken ct);

    /// <summary>
    /// <paramref name="relativePath"/> must be a value previously returned as
    /// <see cref="StoredFile.RelativePath"/> — never a caller-supplied path. The chapter-scope
    /// check that decides whether the requesting member may see this file at all happens
    /// one layer up (the attachment repository / stored procedure); this method only turns a
    /// known-good relative path into bytes.
    /// </summary>
    Task<Stream> OpenReadAsync(string relativePath, CancellationToken ct);

    /// <summary>
    /// The SAME content-type -&gt; extension mapping <see cref="SaveAsync"/> uses internally to
    /// name a newly-stored file, exposed so a caller that needs to give a COPY of an already-
    /// stored file a different, human-meaningful name (e.g. the ID card export renaming a
    /// member's photo to <c>{MemberNumber}.jpg</c> for a ZIP entry) reuses the exact same
    /// jpg/png/heic table instead of maintaining a second one. Never used to change the
    /// on-disk stored file's own name. Falls back to ".bin" for an unmapped or null content
    /// type, same fallback <see cref="SaveAsync"/> itself uses for an unrecognized upload.
    /// </summary>
    string ResolveExtension(string? contentType);
}

/// <summary>
/// Local-disk implementation, rooted at configuration key <c>Storage:UploadPath</c>
/// (defaults to "uploads", resolved relative to the running binaries — outside any
/// web-servable directory; this API calls no <c>UseStaticFiles</c> in Program.cs at all,
/// so nothing under any path is served as a static file regardless).
/// </summary>
public sealed class LocalFileStorage : IFileStorage
{
    // A receipt photo from a phone camera is typically a JPEG/HEIC; PDFs cover scanned
    // receipts. Mapping content type -> extension means the on-disk name never depends on
    // whatever the client happened to send as a filename.
    private static readonly Dictionary<string, string> ExtensionByContentType =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["image/jpeg"] = ".jpg",
            ["image/png"] = ".png",
            ["image/heic"] = ".heic",
            ["application/pdf"] = ".pdf"
        };

    private readonly string _rootPath;

    public LocalFileStorage(IConfiguration configuration)
    {
        var configuredPath = configuration["Storage:UploadPath"] ?? "uploads";
        _rootPath = Path.IsPathRooted(configuredPath)
            ? configuredPath
            : Path.Combine(AppContext.BaseDirectory, configuredPath);

        Directory.CreateDirectory(_rootPath);
    }

    public async Task<StoredFile> SaveAsync(Stream content, string originalFileName, string contentType, CancellationToken ct)
    {
        var extension = ExtensionByContentType.TryGetValue(contentType, out var mapped)
            ? mapped
            : SanitizeExtension(originalFileName);

        var relativePath = $"{Guid.NewGuid():N}{extension}";
        var fullPath = Path.Combine(_rootPath, relativePath);

        await using (var fileStream = new FileStream(
            fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, bufferSize: 81920, useAsync: true))
        {
            await content.CopyToAsync(fileStream, ct);
        }

        return new StoredFile(relativePath, new FileInfo(fullPath).Length);
    }

    public Task<Stream> OpenReadAsync(string relativePath, CancellationToken ct)
    {
        // relativePath is expected to be a bare generated filename with no directory
        // component of its own (see SaveAsync) — the root-prefix check below is defence in
        // depth against a future caller ever passing something unexpected, not the primary
        // guard (the primary guard is that we generate the name ourselves).
        var fullPath = Path.GetFullPath(Path.Combine(_rootPath, relativePath));
        if (!fullPath.StartsWith(_rootPath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Resolved file path escapes the storage root.");

        Stream stream = new FileStream(
            fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize: 81920, useAsync: true);
        return Task.FromResult(stream);
    }

    public string ResolveExtension(string? contentType) =>
        contentType is not null && ExtensionByContentType.TryGetValue(contentType, out var mapped)
            ? mapped
            : ".bin";

    private static string SanitizeExtension(string originalFileName)
    {
        var justName = Path.GetFileName(originalFileName); // drops any directory component
        var ext = Path.GetExtension(justName);
        return ext.Length is > 0 and <= 5 && ext.All(c => c == '.' || char.IsLetterOrDigit(c))
            ? ext.ToLowerInvariant()
            : ".bin";
    }
}
