-- Leftover ZZTEST fixture member from an earlier, unrelated test run — never cleaned up,
-- and its mobile number (09170000000) collides with
-- ChapterRegistrationApprovalControlTests.Approve_leaves_zero_rows_anywhere_when_the_enrolment_link_insert_fails_partway_through's
-- own fixture, which uses the same fixed mobile number scheme. Confirmed no dependent
-- MemberRole/UserAccount/EnrolmentLink/MemberAccountAction/SeatOverride rows before writing this.
DELETE FROM dbo.Member WHERE MemberId = 1305 AND MemberNumber = 'ZZTEST-360f0c21217348e896d0';
