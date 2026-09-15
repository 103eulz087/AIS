using Akrho.Infrastructure.Repositories;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Pins the SQL-error-number-to-HTTP-category mapping for the Digital ID credential module.
/// See usp_Credential_GetOrIssueForSelf.sql (51260) for the THROW this mirrors, and
/// MemberProfileException/DashboardException for the pattern this follows.
/// </summary>
public class CredentialExceptionTests
{
    [Fact]
    public void Member_not_found_maps_to_NotFound()
    {
        // Defence in depth only — unreachable for an authenticated caller, since
        // usp_Credential_GetOrIssueForSelf has no MemberId parameter to substitute; the row
        // read/issued for is always the caller's own.
        new CredentialException(51260, "Member not found.")
            .Category.Should().Be(CredentialErrorCategory.NotFound);
    }

    [Fact]
    public void An_unrecognised_error_number_falls_back_to_BadRequest_not_a_silent_pass()
    {
        new CredentialException(50999, "Some other procedure error.")
            .Category.Should().Be(CredentialErrorCategory.BadRequest);
    }
}
