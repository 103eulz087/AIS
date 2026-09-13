namespace Akrho.Infrastructure.Security;

/// <summary>
/// Scope enforcement. The single highest-risk area in this codebase: one missed check
/// leaks another chapter's financial records.
/// </summary>
/// <remarks>
/// This is defence in depth, not the only defence. Every stored procedure ALSO takes
/// <c>@RequestingMemberId</c> and filters by it. Do not remove either layer because
/// the other exists.
/// </remarks>
public interface IScopeGuard
{
    /// <summary>Throws unless the caller may read or write records belonging to this chapter.</summary>
    void EnsureChapter(ICurrentUser caller, int chapterId);

    /// <summary>Whether the caller is in the chapter — governs how much of a member record is returned.</summary>
    bool IsSameChapter(ICurrentUser caller, int chapterId);

    /// <summary>Whether the caller may see a corrective action's narrative.</summary>
    bool CanSeeCaseNarrative(ICurrentUser caller, int subjectMemberId, int chapterId);
}

public sealed class ScopeGuard : IScopeGuard
{
    public void EnsureChapter(ICurrentUser caller, int chapterId)
    {
        if (caller.ChapterId != chapterId)
            throw new ScopeViolationException(
                $"Member {caller.MemberId} attempted to access chapter {chapterId}.");
    }

    public bool IsSameChapter(ICurrentUser caller, int chapterId) => caller.ChapterId == chapterId;

    /// <summary>
    /// Option B, per client decision: everyone sees the name, category, status and date;
    /// only officers and the member concerned see the written account.
    /// </summary>
    public bool CanSeeCaseNarrative(ICurrentUser caller, int subjectMemberId, int chapterId)
        => caller.ChapterId == chapterId
           && (caller.IsChapterOfficer || caller.MemberId == subjectMemberId);
}

public sealed class ScopeViolationException(string message) : Exception(message);
