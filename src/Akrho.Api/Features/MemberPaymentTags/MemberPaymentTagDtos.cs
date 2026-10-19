namespace Akrho.Api.Features.MemberPaymentTags;

/// <summary>GET /api/member-payment-tags/members — one row per matched member, either
/// from one chapter's own roster or a direct national-wide search, with his current
/// tri-state payment status ("Paid"/"Unpaid"/"Free") for the membership year (defaults
/// to the current one when omitted). Mirrors MemberPaymentTagRow.</summary>
public sealed record MemberPaymentTagMemberDto(
    int MemberId, string MemberNumber, string GiftName, string FullName, string? MobileNo,
    int ChapterId, string ChapterName,
    string StatusName, string PaymentStatus, DateTime? TaggedDateUtc, string? TaggedByGiftName,
    int MembershipYear);

/// <summary>POST /api/member-payment-tags/members/{memberId} — National Council only. No
/// amount, no reason: a simple tag, deliberately separate from the renewal-fee module
/// (see db/schema/25_member_payment_tag.sql's own header). Status is "Paid", "Unpaid", or
/// "Free" (added 2026-10-06 — some members are given free membership for the year; it
/// suppresses the Digital ID's "NOT YET PAID" watermark exactly like Paid does, but is
/// tracked as its own distinct state here and in the Paid/Unpaid/Free report) — validated
/// by the stored procedure itself (THROW 51915 for anything else), not here.</summary>
public sealed record SetMemberPaymentTagRequest(string Status, int? MembershipYear = null);

public sealed record MemberPaymentTagResultDto(int MemberId, string Status, int MembershipYear);

/// <summary>GET /api/member-payment-tags/stats — one row per chapter (or, with
/// ?chapterId=, just that one), for the Paid/Unpaid/Free report. Mirrors
/// MemberPaymentTagStatsRow.</summary>
public sealed record MemberPaymentTagStatsDto(
    int ChapterId, string ChapterName, string? RegionName, string? ProvinceName, string? CityName,
    int TotalMembers, int PaidCount, int FreeCount, int UnpaidCount, int MembershipYear);
