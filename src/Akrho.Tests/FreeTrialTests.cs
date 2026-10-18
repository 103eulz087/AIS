using System.Security.Claims;
using System.Text.RegularExpressions;
using Akrho.Api.Features.AppSettings;
using Akrho.Infrastructure.Repositories;
using Akrho.Infrastructure.Security;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Akrho.Tests;

/// <summary>Test double: every feature open unless listed in <c>closed</c>.</summary>
public sealed class FakeMemberAccessService(params string[] closed) : IMemberAccessService
{
    public int Calls { get; private set; }

    public Task<MemberAccess> GetAsync(int memberId, CancellationToken ct)
    {
        Calls++;
        var keys = new[]
        {
            AppFeatures.Announcements, AppFeatures.Dashboard, AppFeatures.Members, AppFeatures.Meetings,
            AppFeatures.Funds, AppFeatures.Memos, AppFeatures.CorrectiveActions, AppFeatures.ChapterChat,
            AppFeatures.PrivateMessages, AppFeatures.DigitalId, AppFeatures.ChapterAdmin
        };
        var rows = new MemberAccessRows(
            new MemberAccessRow(true, 30, null, null, 0, false, closed.Length > 0, 2026),
            keys.Select(k => new MemberAccessFeatureRow(k, k, !closed.Contains(k))).ToList());
        return Task.FromResult(new MemberAccess(rows));
    }

    public void Invalidate() { }
}

public class AppSettingsExceptionTests
{
    [Fact]
    public void Error_51950_maps_to_Forbidden() =>
        new AppSettingsException(51950, "no").Category.Should().Be(AppSettingsErrorCategory.Forbidden);

    [Theory]
    [InlineData(51951)]
    [InlineData(51952)]
    [InlineData(51953)]
    public void Errors_51951_to_51953_map_to_BadRequest(int number) =>
        new AppSettingsException(number, "bad").Category.Should().Be(AppSettingsErrorCategory.BadRequest);
}

public class RequireFeatureFilterTests
{
    private sealed class FakeUser(int memberId, bool isCouncilOfficer = false) : ICurrentUser
    {
        public int MemberId => memberId;
        public int ChapterId => 1;
        public int AccountId => 1;
        public IReadOnlySet<string> Roles => new HashSet<string>();
        public IReadOnlySet<int> CouncilIds => new HashSet<int>();
        public bool IsChapterOfficer => false;
        public bool IsCouncilOfficer => isCouncilOfficer;
    }

    private static async Task<(object? Result, bool NextCalled)> RunAsync(
        string featureKey, FakeMemberAccessService access, bool authenticated, int memberId,
        bool isCouncilOfficer = false, bool exemptCouncilOfficers = false)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IMemberAccessService>(access);
        services.AddSingleton<ICurrentUser>(new FakeUser(memberId, isCouncilOfficer));
        var http = new DefaultHttpContext { RequestServices = services.BuildServiceProvider() };
        http.User = authenticated
            ? new ClaimsPrincipal(new ClaimsIdentity([new Claim("mid", memberId.ToString())], "TestAuth"))
            : new ClaimsPrincipal(new ClaimsIdentity());

        var nextCalled = false;
        var ctx = new DefaultEndpointFilterInvocationContext(http);
        var result = await new RequireFeatureFilter(featureKey, exemptCouncilOfficers).InvokeAsync(ctx, _ =>
        {
            nextCalled = true;
            return ValueTask.FromResult<object?>("ok");
        });
        return (result, nextCalled);
    }

    [Fact]
    public async Task Closed_feature_returns_403_trial_ended_with_the_feature_key()
    {
        var (result, next) = await RunAsync(AppFeatures.Funds, new FakeMemberAccessService(AppFeatures.Funds), true, 7);

        next.Should().BeFalse();
        var problem = result.Should().BeOfType<ProblemHttpResult>().Subject;
        problem.StatusCode.Should().Be(403);
        problem.ProblemDetails.Title.Should().Be("Free trial ended");
        problem.ProblemDetails.Detail.Should().Be(
            "Your free trial has ended. This part of the app opens again once your membership payment for this year is recorded.");
        problem.ProblemDetails.Extensions["code"].Should().Be("trial-ended");
        problem.ProblemDetails.Extensions["featureKey"].Should().Be(AppFeatures.Funds);
        problem.ProblemDetails.Detail.Should().NotContainEquivalentOf("owe").And.NotContain("₱");
    }

    [Fact]
    public async Task Council_officer_passes_a_shared_Portal_route_but_not_a_member_app_route()
    {
        var closed = new FakeMemberAccessService(AppFeatures.ChapterAdmin);

        var (_, sharedNext) = await RunAsync(AppFeatures.ChapterAdmin, closed, true, 7, isCouncilOfficer: true, exemptCouncilOfficers: true);
        sharedNext.Should().BeTrue("the Portal is never gated");

        var (memberAppResult, memberAppNext) = await RunAsync(AppFeatures.ChapterAdmin, closed, true, 7, isCouncilOfficer: true);
        memberAppNext.Should().BeFalse();
        memberAppResult.Should().BeOfType<ProblemHttpResult>();

        var (_, chapterOfficerNext) = await RunAsync(AppFeatures.ChapterAdmin, closed, true, 7, exemptCouncilOfficers: true);
        chapterOfficerNext.Should().BeFalse("the exemption is for council officers only");
    }

    [Fact]
    public async Task Open_feature_passes_through()
    {
        var (result, next) = await RunAsync(AppFeatures.Dashboard, new FakeMemberAccessService(AppFeatures.Funds), true, 7);

        next.Should().BeTrue();
        result.Should().Be("ok");
    }

    [Fact]
    public async Task Anonymous_caller_passes_through_without_touching_the_access_service()
    {
        var access = new FakeMemberAccessService(AppFeatures.Funds);
        var (_, next) = await RunAsync(AppFeatures.Funds, access, authenticated: false, memberId: 0);

        next.Should().BeTrue();
        access.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Authenticated_token_without_a_member_id_passes_through()
    {
        var access = new FakeMemberAccessService(AppFeatures.Funds);
        var (_, next) = await RunAsync(AppFeatures.Funds, access, authenticated: true, memberId: 0);

        next.Should().BeTrue();
        access.Calls.Should().Be(0);
    }
}

/// <summary>
/// Structural, no database: each gated endpoints file names the right feature, and the files
/// that must stay open never call RequireFeature at all.
/// </summary>
public class FreeTrialGateStructuralTests
{
    private static string Api(params string[] parts)
    {
        var root = ChapterRegistrationTestDbConfig.FindRepoRoot(AppContext.BaseDirectory);
        root.Should().NotBeNull();
        return File.ReadAllText(Path.Combine(new[] { root!, "src", "Akrho.Api" }.Concat(parts).ToArray()));
    }

    private static int Count(string src, string needle) => Regex.Matches(src, Regex.Escape(needle)).Count;

    [Theory]
    [InlineData("Dashboard", "DashboardEndpoints.cs", "Dashboard", 1)]
    [InlineData("Ledger", "LedgerEndpoints.cs", "Funds", 1)]
    [InlineData("Activities", "ActivitiesEndpoints.cs", "Funds", 1)]
    [InlineData("Expenses", "ExpensesEndpoints.cs", "Funds", 1)]
    [InlineData("Donations", "DonationsEndpoints.cs", "Funds", 1)]
    [InlineData("Attachments", "AttachmentsEndpoints.cs", "Funds", 1)]
    [InlineData("Meetings", "MeetingsEndpoints.cs", "Meetings", 1)]
    [InlineData("Discipline", "CorrectiveActionsEndpoints.cs", "CorrectiveActions", 1)]
    [InlineData("Communications", "CommunicationsEndpoints.cs", "Memos", 1)]
    [InlineData("Chat", "ChatEndpoints.cs", "ChapterChat", 1)]
    [InlineData("Conversations", "ConversationsEndpoints.cs", "PrivateMessages", 1)]
    [InlineData("Credential", "CredentialEndpoints.cs", "DigitalId", 2)]
    [InlineData("MembershipApplications", "MembershipApplicationsEndpoints.cs", "ChapterAdmin", 5)]
    public void Gated_file_calls_RequireFeature_with_its_key(string folder, string file, string key, int times)
    {
        var src = Api("Features", folder, file);
        Count(src, $".RequireFeature(AppFeatures.{key})").Should().Be(times);
        Count(src, ".RequireFeature(").Should().Be(times, "no other feature key may appear in this file");
    }

    [Fact]
    public void Members_file_gates_search_and_identity_as_Members_and_enrolment_link_as_ChapterAdmin()
    {
        var src = Api("Features", "Members", "MembersEndpoints.cs");
        Count(src, ".RequireFeature(AppFeatures.Members)").Should().Be(2);
        Count(src, ".RequireFeature(AppFeatures.ChapterAdmin, exemptCouncilOfficers: true)").Should().Be(1,
            "the Portal's chapter registration screen re-issues enrolment links too");
        Count(src, ".RequireFeature(").Should().Be(3);
    }

    [Fact]
    public void Chapters_file_gates_only_invite_links_and_officer_writes_as_ChapterAdmin()
    {
        var src = Api("Features", "Chapters", "ChaptersEndpoints.cs");
        Count(src, ".RequireFeature(AppFeatures.ChapterAdmin)").Should().Be(4);
        Count(src, ".RequireFeature(").Should().Be(4);
    }

    [Fact]
    public void Communications_gates_memos_only_never_announcements_or_documents()
    {
        var src = Api("Features", "Communications", "CommunicationsEndpoints.cs");
        var memos = src.IndexOf("var memos", StringComparison.Ordinal);
        var gate = src.IndexOf(".RequireFeature(", StringComparison.Ordinal);
        var documents = src.IndexOf("var documents", StringComparison.Ordinal);
        gate.Should().BeGreaterThan(memos).And.BeLessThan(documents);
    }

    [Theory]
    [InlineData("Auth", "AuthEndpoints.cs")]
    [InlineData("Enrolment", "EnrolmentEndpoints.cs")]
    [InlineData("Notifications", "NotificationsEndpoints.cs")]
    [InlineData("Reference", "ReferenceEndpoints.cs")]
    [InlineData("Verification", "VerificationEndpoints.cs")]
    [InlineData("AppSettings", "AppSettingsEndpoints.cs")]
    [InlineData("ChapterRegistrations", "ChapterRegistrationsEndpoints.cs")]
    [InlineData("Councils", "CouncilsEndpoints.cs")]
    [InlineData("CouncilStatistics", "CouncilStatisticsEndpoints.cs")]
    [InlineData("CouncilPermissions", "CouncilPermissionsEndpoints.cs")]
    [InlineData("IdCardExport", "IdCardExportEndpoints.cs")]
    [InlineData("MemberPaymentTags", "MemberPaymentTagsEndpoints.cs")]
    public void Always_open_and_Portal_files_never_call_RequireFeature(string folder, string file)
    {
        Api("Features", folder, file).Should().NotContain(".RequireFeature(");
    }

    [Fact]
    public void Chat_hub_gates_chapter_groups_and_the_member_group_separately()
    {
        var src = Api("Features", "Chat", "ChatHub.cs");
        src.Should().Contain("AppFeatures.ChapterChat").And.Contain("AppFeatures.PrivateMessages");
        src.Should().Contain("chapterId > 0 && chatOpen").And.Contain("memberId > 0 && privateOpen");
    }

    [Fact]
    public void Settings_policy_is_registered_and_the_access_route_is_not_gated()
    {
        Api("Program.cs").Should().Contain("AuthorizationPolicies.AppSettingsManage");
        var src = Api("Features", "AppSettings", "AppSettingsEndpoints.cs");
        src.Should().Contain("/api/members/me/access").And.Contain("AuthorizationPolicies.AppSettingsManage");
    }
}
