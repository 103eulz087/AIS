using Akrho.Infrastructure.Security;
using FluentAssertions;
using Xunit;

namespace Akrho.Tests;

/// <summary>
/// Raw tokens (enrolment links, refresh tokens) and passwords never reach the database
/// as anything but a hash. These tests pin the two low-level pieces that promise: hashing
/// is deterministic (so issue and redemption agree) and the password hasher actually
/// rejects a wrong password rather than accidentally accepting one.
/// </summary>
public class AuthSecurityTests
{
    [Fact]
    public void OpaqueToken_hash_is_deterministic_for_the_same_raw_value()
    {
        var raw = OpaqueToken.GenerateRaw();

        OpaqueToken.Hash(raw).Should().BeEquivalentTo(OpaqueToken.Hash(raw));
    }

    [Fact]
    public void OpaqueToken_raw_values_are_not_reused()
    {
        var a = OpaqueToken.GenerateRaw();
        var b = OpaqueToken.GenerateRaw();

        a.Should().NotBe(b);
        OpaqueToken.Hash(a).Should().NotBeEquivalentTo(OpaqueToken.Hash(b));
    }

    [Fact]
    public void OpaqueToken_hash_is_a_256_bit_value()
    {
        OpaqueToken.Hash(OpaqueToken.GenerateRaw()).Should().HaveCount(32);
    }

    [Fact]
    public void PasswordHasher_round_trips_the_correct_password()
    {
        var hasher = new PasswordHasherService();
        var hash = hasher.Hash("correct horse battery staple");

        hasher.Verify(hash, "correct horse battery staple").Should().BeTrue();
    }

    [Fact]
    public void PasswordHasher_rejects_the_wrong_password()
    {
        var hasher = new PasswordHasherService();
        var hash = hasher.Hash("correct horse battery staple");

        hasher.Verify(hash, "wrong password entirely").Should().BeFalse();
    }
}
