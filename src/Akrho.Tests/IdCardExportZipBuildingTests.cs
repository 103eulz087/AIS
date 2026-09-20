using System.IO.Compression;
using System.Reflection;
using Akrho.Api.Features.IdCardExport;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Storage;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Akrho.Tests;

/*
 * IdCardExportEndpoints's ZIP construction (members.xlsx + photos/*) is pure, DB-free glue
 * code — given a list of IdCardExportMemberRow and a real IFileStorage, it either finds a
 * PhotoPath and copies that file into the archive under a renamed entry, or it doesn't (no
 * error, no placeholder — see that file's own WritePhotoEntriesAsync comment). No stored
 * procedure or authorization boundary is exercised here (that is
 * IdCardExportScopeTests/IdCardExportExceptionTests' job); this suite proves the ZIP a real
 * National CouncilAdmin would receive is actually well-formed, using a REAL LocalFileStorage
 * rooted at a throwaway temp directory (deleted in Dispose) rather than mocking file I/O —
 * consistent with this project's "do not mock the database/procedures" posture applied to the
 * one other piece of real I/O this module does.
 *
 * BuildZipAsync/WriteWorkbookEntry/WritePhotoEntriesAsync are private static members of
 * IdCardExportEndpoints — there is no public seam to call them through without either adding
 * one (a production-code change beyond this task) or standing up the full endpoint
 * (ICurrentUser/policy plumbing this project has never built a TestServer for — see
 * ChatModuleIntegrationTests.cs's own header). Reflection is already an established technique
 * in this test project (ChapterRegistrationStructuralInvariantTests.cs,
 * ChatPrivacyAndScopeLeakTests.cs both reflect over types from this same assembly); used here
 * to invoke the one private method (BuildZipAsync) rather than duplicating its logic in test
 * code, which would prove nothing about the actual shipped behavior.
 */
public sealed class IdCardExportZipBuildingTests : IDisposable
{
    private readonly string _tempRoot;
    private readonly IFileStorage _storage;

    public IdCardExportZipBuildingTests()
    {
        _tempRoot = Path.Combine(Path.GetTempPath(), "ZZTEST-IdCardExportZip-" + Guid.NewGuid().ToString("N"));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Storage:UploadPath"] = _tempRoot })
            .Build();
        _storage = new LocalFileStorage(config);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempRoot))
            Directory.Delete(_tempRoot, recursive: true);
    }

    private static async Task<byte[]> InvokeBuildZipAsync(
        IReadOnlyList<IdCardExportMemberRow> members, IFileStorage storage, string webOrigin)
    {
        var method = typeof(IdCardExportEndpoints).GetMethod(
            "BuildZipAsync", BindingFlags.NonPublic | BindingFlags.Static);
        method.Should().NotBeNull("IdCardExportEndpoints.BuildZipAsync must still exist under that exact name/signature");

        var task = (Task<byte[]>)method!.Invoke(
            null, [members, storage, webOrigin, CancellationToken.None])!;
        return await task;
    }

    private static ZipArchive OpenZip(byte[] zipBytes) =>
        new(new MemoryStream(zipBytes), ZipArchiveMode.Read);

    [Fact]
    public async Task Zip_always_contains_the_members_workbook()
    {
        var members = new List<IdCardExportMemberRow>
        {
            new(1, "ZZTEST-001", "Juan", null, "Dela Cruz", "TESTGIFT", "O+",
                1, "ZZTEST Chapter", "ZZT", "Active", null, null, Guid.NewGuid())
        };

        var zipBytes = await InvokeBuildZipAsync(members, _storage, "https://portal.example");

        using var archive = OpenZip(zipBytes);
        archive.GetEntry("members.xlsx").Should().NotBeNull();
    }

    /// <summary>
    /// Covers "a member with no uploaded photo doesn't break the export": PhotoPath null must
    /// produce zero entries under photos/ for that member — no error, no empty/placeholder
    /// file — while a member who DOES have one still gets a real, renamed copy of it.
    /// </summary>
    [Fact]
    public async Task Member_without_a_photo_gets_no_zip_entry_while_a_member_with_one_gets_a_renamed_copy()
    {
        var stored = await _storage.SaveAsync(
            new MemoryStream([0xFF, 0xD8, 0xFF, 0xD9]), "whatever-the-phone-called-it.jpg",
            "image/jpeg", CancellationToken.None);

        var withPhoto = new IdCardExportMemberRow(
            1, "ZZTEST-001", "Juan", null, "Dela Cruz", "TESTGIFT", "O+",
            1, "ZZTEST Chapter", "ZZT", "Active", stored.RelativePath, "image/jpeg", Guid.NewGuid());
        var withoutPhoto = new IdCardExportMemberRow(
            2, "ZZTEST-002", "Pedro", null, "Reyes", "TESTGIFT2", null,
            1, "ZZTEST Chapter", "ZZT", "Active", null, null, Guid.NewGuid());

        var zipBytes = await InvokeBuildZipAsync([withPhoto, withoutPhoto], _storage, "https://portal.example");

        using var archive = OpenZip(zipBytes);
        var photoEntries = archive.Entries.Where(e => e.FullName.StartsWith("photos/", StringComparison.Ordinal)).ToList();

        photoEntries.Should().ContainSingle().Which.FullName.Should().Be("photos/ZZTEST-001.jpg");
        photoEntries.Should().NotContain(e => e.FullName.Contains("ZZTEST-002"),
            "a member with no PhotoPath must produce no file at all, not an empty or placeholder one");
    }

    [Fact]
    public async Task No_member_in_scope_still_produces_a_valid_zip_with_only_the_empty_workbook()
    {
        var zipBytes = await InvokeBuildZipAsync([], _storage, "https://portal.example");

        using var archive = OpenZip(zipBytes);
        archive.Entries.Should().ContainSingle().Which.FullName.Should().Be("members.xlsx");
    }
}
