using Akrho.Infrastructure.Repositories;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Primitives;

namespace Akrho.Api.Features.AppSettings;

/// <summary>A member's free-trial state and which features are open to him right now.</summary>
public sealed class MemberAccess(MemberAccessRows rows)
{
    public MemberAccessRow State { get; } = rows.Access;
    public IReadOnlyList<MemberAccessFeatureRow> Features { get; } = rows.Features;

    /// <summary>An unknown key is treated as open: the gate must never fail closed on a typo.</summary>
    public bool IsFeatureOpen(string featureKey) =>
        Features.FirstOrDefault(f => string.Equals(f.FeatureKey, featureKey, StringComparison.Ordinal))?.IsOpen ?? true;
}

public interface IMemberAccessService
{
    /// <summary>Cached per member for 30 seconds; cleared on every settings save.</summary>
    Task<MemberAccess> GetAsync(int memberId, CancellationToken ct);

    /// <summary>Drops every cached entry (called after PUT /api/app-settings).</summary>
    void Invalidate();
}

public sealed class MemberAccessService(IAppSettingsRepository repo, IMemoryCache cache) : IMemberAccessService
{
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(30);

    // One generation token shared by every instance (the service itself is scoped).
    // Cancelling it evicts all entries that were registered against it.
    private static CancellationTokenSource generation = new();

    public async Task<MemberAccess> GetAsync(int memberId, CancellationToken ct)
    {
        var key = $"member-access:{memberId}";
        if (cache.TryGetValue(key, out MemberAccess? hit) && hit is not null) return hit;

        var token = Volatile.Read(ref generation).Token;
        var access = new MemberAccess(await repo.GetAccessAsync(memberId, ct));
        using var entry = cache.CreateEntry(key);
        entry.Value = access;
        entry.AbsoluteExpirationRelativeToNow = Ttl;
        entry.AddExpirationToken(new CancellationChangeToken(token));
        return access;
    }

    public void Invalidate()
    {
        var old = Interlocked.Exchange(ref generation, new CancellationTokenSource());
        old.Cancel();
        old.Dispose();
    }
}
