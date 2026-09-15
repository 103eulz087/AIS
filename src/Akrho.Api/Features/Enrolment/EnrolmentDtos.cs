namespace Akrho.Api.Features.Enrolment;

/// <summary>Enough to greet the officer and show a countdown — not a login, he has no account yet.</summary>
public sealed record EnrolmentLinkDto(string FirstName, string GiftName, string ChapterName, DateTime ExpiresOnUtc);

public sealed record EnrolmentCompleteRequest(string Password);
