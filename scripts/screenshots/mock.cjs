// Demo-data mock of the AKRHO API, used only to drive the real React app for screenshots.
const CH = { id: 1, name: "Brgy. San Isidro Chapter", code: "AKR-04-0117" };
const paged = (items) => ({ items, total: items.length, skip: 0, take: 50 });
const RT = "2027-08-08";
const members = [
  [1, "TANGLAW", "001", "Ramon", "C", "Delgado", "O+", "Electrician", "President", "0917 555 0101"],
  [2, "BAGWIS", "002", "Joel", "R", "Mariano", "A+", "Registered Nurse", "Vice President", "0917 555 0102"],
  [3, "LAKANDULA", "003", "Arnel", "S", "Bautista", "O-", "Heavy Equipment Operator", "Secretary", "0917 555 0103"],
  [4, "HIMAGSIK", "004", "Dennis", "L", "Portugal", "B+", "Carpenter", "Treasurer", "0917 555 0104"],
  [5, "AGOS", "005", "Rey", "O", "Fabian", "O+", "Barangay Tanod", "Auditor", "0917 555 0105"],
  [6, "SIGLAHI", "006", "Michael", "T", "Santos", "AB+", "Jeepney Driver", null, "0917 555 0106"],
  [7, "BALANGAY", "007", "Carlo", "M", "Reyes", "A-", "Welder", null, "0917 555 0107"],
  [8, "DALISAY", "008", "Paolo", "G", "Cruz", "O+", "Teacher", null, "0917 555 0108"],
  [9, "KIDLAT", "009", "Jun", "P", "Villanueva", "B-", "Mechanic", null, "0917 555 0109"],
  [10, "LIWANAG", "010", "Noel", "A", "Garcia", "O+", "Security Guard", null, "0917 555 0110"],
].map(([id, g, n, f, mi, l, bt, prof, off, mob]) => ({
  memberId: id, giftName: g, memberNumber: `${CH.code}-${n}`, chapterId: 1, chapterName: CH.name,
  status: id === 10 ? "Inactive" : "Active", fullName: `${f} ${mi}. ${l}`, firstName: f, middleName: mi, lastName: l,
  mobileNo: mob, profession: prof, bloodType: bt, renewedThrough: id === 9 ? "2026-08-08" : RT, isCurrent: id !== 9,
  officeName: off, isBlocked: false, rowVersion: "AAAAAAAAB9E=",
}));
const byId = (id) => members.find(m => m.memberId === id);

const announcements = [
  { announcementId: 31, title: "URGENT: O+ blood needed at Sta. Rosa Community Hospital", body: "A brother's mother needs 2 bags of O+ blood for surgery tomorrow morning. If you can donate, please go to the hospital blood bank before 8 PM tonight and mention the patient name Delgado. Salamat, mga kapatid.", isUrgent: true, urgentTypeId: 1, urgentTypeName: "BloodRequest", bloodTypeId: 1, bloodTypeName: "O+", publishDateUtc: "2026-10-30T09:15:00Z", expiryDate: "2026-11-02", createdBy: 1, editedBy: null, editedDateUtc: null, isWithdrawn: false, withdrawnBy: null, withdrawnDateUtc: null, withdrawnReason: null, isNational: false, hasRead: false },
  { announcementId: 30, title: "National Founding Anniversary — call for delegates", body: "The National Council invites every chapter to send two delegates to the founding anniversary assembly. Chapter presidents, please confirm your delegates through your city council by 15 November.", isUrgent: false, urgentTypeId: null, urgentTypeName: null, bloodTypeId: null, bloodTypeName: null, publishDateUtc: "2026-10-25T02:00:00Z", expiryDate: null, createdBy: 99, editedBy: null, editedDateUtc: null, isWithdrawn: false, withdrawnBy: null, withdrawnDateUtc: null, withdrawnReason: null, isNational: true, hasRead: true },
  { announcementId: 29, title: "Coastal clean-up this Saturday", body: "Assembly at the barangay hall 6:00 AM. Bring gloves and water. Breakfast will be provided by the chapter.", isUrgent: false, urgentTypeId: null, urgentTypeName: null, bloodTypeId: null, bloodTypeName: null, publishDateUtc: "2026-10-20T11:00:00Z", expiryDate: "2026-10-26", createdBy: 3, editedBy: null, editedDateUtc: null, isWithdrawn: false, withdrawnBy: null, withdrawnDateUtc: null, withdrawnReason: null, isNational: false, hasRead: true },
];
const memos = [
  { memoId: 12, memoNumber: "MEMO 2026-004", subject: "Schedule of general assembly for November", body: "All members are requested to attend the general assembly on 8 November 2026, 7:00 PM, at the San Isidro barangay hall. Agenda: year-end outreach, election of committee heads, and the treasurer's quarterly report.", publishDateUtc: "2026-10-28T04:00:00Z", createdBy: 3, supersedesMemoId: 11, isSuperseded: false, supersededByMemoId: null, supersededByMemoNumber: null, hasRead: false },
  { memoId: 11, memoNumber: "MEMO 2026-003", subject: "Schedule of general assembly for November", body: "General assembly on 1 November.", publishDateUtc: "2026-10-15T04:00:00Z", createdBy: 3, supersedesMemoId: null, isSuperseded: true, supersededByMemoId: 12, supersededByMemoNumber: "MEMO 2026-004", hasRead: true },
  { memoId: 10, memoNumber: "MEMO 2026-002", subject: "Uniform guidelines for public activities", body: "Members joining public activities must wear the chapter shirt and carry their digital ID on their phone.", publishDateUtc: "2026-09-10T04:00:00Z", createdBy: 1, supersedesMemoId: null, isSuperseded: false, supersededByMemoId: null, supersededByMemoNumber: null, hasRead: true },
];
const meetings = [
  { meetingId: 41, subject: "Regular monthly meeting — October", meetingDate: "2026-10-25", location: "San Isidro Barangay Hall", isFinalized: true, finalizedDateUtc: "2026-10-25T14:00:00Z", collectionTotal: 1450, presentCount: 7, lateCount: 1 },
  { meetingId: 40, subject: "Special meeting — clean-up drive planning", meetingDate: "2026-10-11", location: "TANGLAW's residence", isFinalized: true, finalizedDateUtc: "2026-10-11T13:00:00Z", collectionTotal: 600, presentCount: 6, lateCount: 0 },
  { meetingId: 39, subject: "Regular monthly meeting — September", meetingDate: "2026-09-27", location: "San Isidro Barangay Hall", isFinalized: true, finalizedDateUtc: "2026-09-27T14:00:00Z", collectionTotal: 1200, presentCount: 8, lateCount: 0 },
];
const att = [[1,1,200],[2,1,200],[3,1,150],[4,1,300],[5,2,100],[6,1,200],[7,3,null],[8,1,300],[9,4,null],[10,null,null]];
const meetingDetail = { meetingId: 41, chapterId: 1, subject: meetings[0].subject, meetingDate: "2026-10-25", body: "Agenda: 1) Treasurer's report 2) Coastal clean-up wrap-up 3) Plans for the founding anniversary.", location: meetings[0].location, isFinalized: true, finalizedBy: 1, finalizedDateUtc: "2026-10-25T14:00:00Z", createdBy: 3, createdDateUtc: "2026-10-24T10:00:00Z", ledgerEntryId: 205, ledgerEntryIsReversed: false,
  attendance: att.map(([id, s, amt]) => ({ memberId: id, giftName: byId(id).giftName, memberNumber: byId(id).memberNumber, statusName: byId(id).status, attendanceStatusId: s, fundAmount: amt, checkedInAtUtc: s && s < 3 ? "2026-10-25T11:05:00Z" : null })),
  reopenHistory: [] };
const activities = [
  { activityId: 7, activityName: "Coastal Clean-up Drive", activityDate: "2026-10-24", description: "Barangay shoreline clean-up with the youth council.", isClosed: false, fundedTotal: 5000, spentTotal: 3280 },
  { activityId: 6, activityName: "Feeding Program — San Isidro Elementary", activityDate: "2026-09-19", description: "Lugaw and bread for 120 pupils.", isClosed: true, fundedTotal: 8000, spentTotal: 7650 },
];
const expenses = [
  { expenseId: 81, activityId: 7, activityName: "Coastal Clean-up Drive", expenseDate: "2026-10-24", payee: "Aling Nena's Carinderia", description: "Breakfast for 35 volunteers", amount: 1750, categoryId: 1, categoryName: "Food & Refreshments", recordedBy: 4, approvedBy: 1, isVoided: false },
  { expenseId: 80, activityId: 7, activityName: "Coastal Clean-up Drive", expenseDate: "2026-10-23", payee: "San Isidro Hardware", description: "Garbage bags, gloves, rakes", amount: 1530, categoryId: 3, categoryName: "Supplies", recordedBy: 4, approvedBy: 1, isVoided: false },
  { expenseId: 79, activityId: null, activityName: null, expenseDate: "2026-10-05", payee: "Sta. Rosa City Council", description: "Quarterly council remittance", amount: 1000, categoryId: 7, categoryName: "Council Remittance", recordedBy: 4, approvedBy: 1, isVoided: false },
  { expenseId: 78, activityId: 6, activityName: "Feeding Program — San Isidro Elementary", expenseDate: "2026-09-18", payee: "Palengke supplier", description: "Rice and chicken (entered twice by mistake)", amount: 2400, categoryId: 1, categoryName: "Food & Refreshments", recordedBy: 4, approvedBy: null, isVoided: true },
];
const donations = [
  { donationId: 55, activityId: 7, activityName: "Coastal Clean-up Drive", donationDate: "2026-10-20", donorName: "Hon. Barangay Captain L. Ramos", donorType: "Government Official", amount: 3000, isInKind: false, inKindDescription: null, chapterReceiptNo: "CR-2026-018", recordedBy: 4, isVoided: false },
  { donationId: 54, activityId: 7, activityName: "Coastal Clean-up Drive", donationDate: "2026-10-18", donorName: "San Isidro Hardware", donorType: "Business", amount: 0, isInKind: true, inKindDescription: "20 pairs of work gloves", chapterReceiptNo: "CR-2026-017", recordedBy: 4, isVoided: false },
  { donationId: 53, activityId: 6, activityName: "Feeding Program — San Isidro Elementary", donationDate: "2026-09-12", donorName: "BAGWIS (member)", donorType: "Member", amount: 2000, isInKind: false, inKindDescription: null, chapterReceiptNo: "CR-2026-016", recordedBy: 4, isVoided: false },
];
const ledger = [
  [206, "2026-10-25", "In", 1450, "Meeting contributions — Regular monthly meeting, October", "Meeting", null],
  [205, "2026-10-24", "Out", 1750, "Breakfast for 35 volunteers — Aling Nena's Carinderia", "Expense", "Coastal Clean-up Drive"],
  [204, "2026-10-23", "Out", 1530, "Garbage bags, gloves, rakes — San Isidro Hardware", "Expense", "Coastal Clean-up Drive"],
  [203, "2026-10-20", "In", 3000, "Donation — Hon. Barangay Captain L. Ramos (CR-2026-018)", "Donation", "Coastal Clean-up Drive"],
  [202, "2026-10-11", "In", 600, "Meeting contributions — Special meeting", "Meeting", null],
  [201, "2026-10-05", "Out", 1000, "Quarterly council remittance — Sta. Rosa City Council", "Expense", null],
  [200, "2026-09-27", "In", 1200, "Meeting contributions — Regular monthly meeting, September", "Meeting", null],
  [199, "2026-09-19", "In", 2400, "REVERSAL of entry 198 — duplicate expense voided", "ExpenseVoid", "Feeding Program — San Isidro Elementary"],
  [198, "2026-09-18", "Out", 2400, "Rice and chicken — Palengke supplier", "Expense", "Feeding Program — San Isidro Elementary"],
  [150, "2026-08-08", "In", 5500, "Balance carried forward from membership year 2025", "Opening", null],
].map(([id, d, t, a, desc, src, act]) => ({ ledgerEntryId: id, entryDate: d, entryType: t, amount: a, description: desc, sourceType: src, activityName: act ?? undefined, isReversal: id === 199, reversesEntryId: id === 199 ? 198 : undefined }));

const cases = [
  { caseId: 3, memberId: 9, giftName: "KIDLAT", memberNumber: byId(9).memberNumber, categoryId: 2, categoryName: "Conduct unbecoming", statusName: "Under Review", dateFiled: "2026-10-12", resolutionDate: null },
  { caseId: 2, memberId: 7, giftName: "BALANGAY", memberNumber: byId(7).memberNumber, categoryId: 1, categoryName: "Absence without notice", statusName: "Reconciled", dateFiled: "2026-08-20", resolutionDate: "2026-09-05" },
  { caseId: 1, memberId: 10, giftName: "LIWANAG", memberNumber: byId(10).memberNumber, categoryId: 3, categoryName: "Misuse of chapter name", statusName: "Dismissed", dateFiled: "2026-06-02", resolutionDate: "2026-06-30" },
];
const caseDetail = { case: { ...cases[0], content: "During the 11 October special meeting KIDLAT raised his voice at an officer and left before the meeting was adjourned. Two brothers witnessed it. He has been invited to explain at the next officers' meeting.", resolutionNotes: null, filedBy: 1, filedByGiftName: "TANGLAW" },
  timeline: [
    { updateId: 6, updateDateUtc: "2026-10-12T10:00:00Z", statusName: "Pending", updatedBy: 1, updatedByGiftName: "TANGLAW", notes: "Case filed." },
    { updateId: 7, updateDateUtc: "2026-10-18T09:30:00Z", statusName: "Under Review", updatedBy: 3, updatedByGiftName: "LAKANDULA", notes: "KIDLAT acknowledged the notice and will attend the officers' meeting on 8 November." },
  ] };

const msgs = [
  [501, 3, "Magandang umaga mga kapatid! Reminder: clean-up is this Saturday, 6 AM sa barangay hall.", "2026-10-22T23:05:00Z"],
  [502, 6, "Copy! I'll bring the jeep for the supplies.", "2026-10-22T23:12:00Z"],
  [503, 4, "Budget for breakfast is approved. Receipts to me after, salamat.", "2026-10-23T00:40:00Z"],
  [504, 2, "Ilan po ang volunteers so far?", "2026-10-23T01:02:00Z"],
  [505, 1, "35 confirmed including the youth council. Salamat sa lahat!", "2026-10-23T01:10:00Z"],
].map(([id, s, b, d]) => ({ messageId: id, senderId: s, senderGiftName: byId(s).giftName, senderMemberNumber: byId(s).memberNumber, body: b, sentDateUtc: d, isDeleted: false, deletedDateUtc: null, flagCount: 0, hasFlagged: false, canSeeRemovedBody: false }));
const conversations = [
  { roomId: 901, otherMemberId: 4, otherGiftName: "HIMAGSIK", otherChapterName: CH.name, lastMessageId: 9, lastMessagePreview: "Na-upload ko na po yung resibo ng hardware.", lastMessageDate: "2026-10-30T08:20:00Z", unreadCount: 1, isMuted: false },
  { roomId: 902, otherMemberId: 77, otherGiftName: "MAKISIG", otherChapterName: "Brgy. Dila Chapter", lastMessageId: 8, lastMessagePreview: "See you at the council meeting, brod.", lastMessageDate: "2026-10-27T12:00:00Z", unreadCount: 0, isMuted: false },
];

const credential = { giftName: "TANGLAW", fullName: "Ramon C. Delgado", memberNumber: byId(1).memberNumber, chapterName: CH.name, chapterCode: CH.code, nationalCouncilName: "National Council", regionName: "Region IV-A CALABARZON", provinceName: "Laguna", cityName: "Santa Rosa", dateSurvive: "2011-03-19", bloodTypeName: "O+", statusName: "Active", renewedThrough: RT, credentialIssuedDateUtc: "2026-08-12T02:00:00Z", credentialExpiryDateUtc: "2027-08-08T15:59:59Z", verificationUrl: "https://ais.example.ph/verify/3f2a1c9e-89aa-4b7a-8f0a-5c1d2e3f4a5b" };
const profile = { memberId: 1, memberNumber: byId(1).memberNumber, firstName: "Ramon", middleName: "C", lastName: "Delgado", giftName: "TANGLAW", birthdate: "1985-04-02", dateSurvive: "2011-03-19", presidentDuringSurvive: "MAGITING", masterInitiatorDuringSurvive: "BATHALA", chapterId: 1, chapterName: CH.name, homeCouncilId: null, councilName: null, chapterOfRecord: CH.name, status: "Active", renewedThrough: RT, seconderMemberId: null, approvedBy: null, approvedDateUtc: "2024-01-15T00:00:00Z", address: "Purok 3, Brgy. San Isidro, Santa Rosa, Laguna", mobileNo: "0917 555 0101", email: null, bloodTypeId: 1, bloodTypeName: "O+", bloodTypeConfirmedDateUtc: "2026-08-12T00:00:00Z", profession: "Electrician", photoUrl: null, skillIds: [1, 3], rowVersion: "AAAAAAAAB9E=" };

const apps = [
  { applicationId: 21, referenceNo: "APP-2026-0021", firstName: "Marvin", middleName: "D", lastName: "Aquino", giftName: "SINAG", mobileNo: "0918 555 0201", email: null, statusName: "PendingApproval", submittedDateUtc: "2026-10-29T06:00:00Z", decidedBy: null, decidedDateUtc: null },
  { applicationId: 20, referenceNo: "APP-2026-0020", firstName: "Leo", middleName: null, lastName: "Manalo", giftName: "BAGYO", mobileNo: "0918 555 0202", email: null, statusName: "ReturnedForCorrection", submittedDateUtc: "2026-10-21T06:00:00Z", decidedBy: 1, decidedDateUtc: "2026-10-22T06:00:00Z" },
  { applicationId: 19, referenceNo: "APP-2026-0019", firstName: "Ernesto", middleName: "B", lastName: "Lim", giftName: "ALAB", mobileNo: "0918 555 0203", email: null, statusName: "Approved", submittedDateUtc: "2026-10-02T06:00:00Z", decidedBy: 1, decidedDateUtc: "2026-10-04T06:00:00Z" },
];
const appDetail = { ...apps[0], chapterId: 1, birthDate: "1993-07-14", dateSurvive: "2018-02-10", presidentDuringSurvive: "TANGLAW", masterInitiatorDuringSurvive: "BATHALA", seconderNameGiven: "BAGWIS", seconderMemberNumberGiven: byId(2).memberNumber, seconderMemberId: 2, seconderResolvedGiftName: "BAGWIS", seconderResolvedMemberNumber: byId(2).memberNumber, decisionReason: null, createdMemberId: null,
  history: [{ membershipApplicationUpdateId: 1, updateDateUtc: "2026-10-29T06:00:00Z", updatedBy: null, statusName: "PendingApproval", notes: "Submitted through the chapter join link." }], priorApplications: [] };

const officerSeats = members.slice(0, 5).map((m, i) => ({ memberRoleId: 300 + i, officeId: i + 1, officeName: m.officeName, sortOrder: i + 1, grantsLogin: true, roleName: i === 0 ? "ChapterAdmin" : i === 3 ? "ChapterTreasurer" : "ChapterOfficer", memberId: m.memberId, giftName: m.giftName, memberNumber: m.memberNumber, fullName: m.fullName, termStart: "2026-08-09", termEnd: null, isCurrent: true, renewedThrough: RT, hasAccount: i !== 4 }));

// ---------- Portal ----------
const councils = [
  [1, "National Council", "National", null, 0, true, 1, 0, 0],
  [2, "Region IV-A CALABARZON Regional Council", "Regional", 1, 1, true, 1, 0, 0],
  [3, "Laguna Provincial Council", "Provincial", 2, 2, true, 2, 0, 0],
  [4, "Sta. Rosa City Council", "City/Municipal", 3, 3, true, 0, 6, 2],
  [5, "Biñan City Council", "City/Municipal", 3, 3, false, 0, 3, 0],
].map(([id, n, lv, p, d, seated, kids, chap, det]) => ({ councilId: id, councilName: n, levelName: lv, parentCouncilId: p, depth: d, isActive: true, isDissolved: false, hasSeatedOfficers: seated, neverConstituted: false, isDormant: !seated, seatedOfficerCount: seated ? (id === 4 ? 4 : 6) : 0, directChildCouncilCount: kids, directChapterCount: chap, directMemberCount: det }));
const regQueue = [
  { registrationId: 14, referenceNo: "CHR-2026-0014", registrationType: "Charter", proposedChapterName: "Brgy. Pooc Chapter", chapterId: null, chapterName: null, statusName: "Submitted", submittedDateUtc: "2026-10-28T03:00:00Z", actingCouncilId: 4, actingCouncilName: "Sta. Rosa City Council", intendedCouncilId: 4, routingReason: "Parent", decidedBy: null, decidedDateUtc: null, canAct: true },
  { registrationId: 13, referenceNo: "CHR-2026-0013", registrationType: "Charter", proposedChapterName: "Brgy. Canlalay Chapter", chapterId: null, chapterName: null, statusName: "Submitted", submittedDateUtc: "2026-10-26T03:00:00Z", actingCouncilId: 3, actingCouncilName: "Laguna Provincial Council", intendedCouncilId: 5, routingReason: "ParentDormant", decidedBy: null, decidedDateUtc: null, canAct: true },
  { registrationId: 12, referenceNo: "TOV-2026-0012", registrationType: "Turnover", proposedChapterName: null, chapterId: 1, chapterName: CH.name, statusName: "Approved", submittedDateUtc: "2026-08-10T03:00:00Z", actingCouncilId: 4, actingCouncilName: "Sta. Rosa City Council", intendedCouncilId: 4, routingReason: "Parent", decidedBy: 50, decidedDateUtc: "2026-08-12T03:00:00Z", canAct: false },
];
const offNames = ["President","Vice President","Secretary","Treasurer","Auditor","Master Initiator I","Master Initiator II","Master Initiator III"];
const regOfficers = [["Eduardo","Navarro","KALASAG"],["Bryan","Torres","SIBOL"],["Mark","Dizon","HIRAYA"],["Ronald","Castro","TALAS"],["Ariel","Mendoza","DAKILA"],["Romeo","Flores","BATHALA"],["Victor","Ramos","MAKATA"],["Jose","Pascual","TIKAS"]]
  .map(([f, l, g], i) => ({ registrationOfficerId: 700 + i, officeId: i + 1, officeName: offNames[i], sortOrder: i + 1, grantsLogin: i < 5, memberId: null, memberNumber: null, firstName: f, middleName: null, lastName: l, giftName: g, birthDate: "1988-01-01", mobileNo: `0919 555 03${10 + i}`, email: null, dateSurvive: "2015-06-12", presidentDuringSurvive: "MAGITING", masterInitiatorDuringSurvive: "BATHALA", verifiedBy: i < 3 ? 50 : null, verifiedByGiftName: i < 3 ? "MAKISIG" : null, verifiedDateUtc: i < 3 ? "2026-10-29T03:00:00Z" : null, verifyNote: null, createdMemberId: null, hasAccount: false }));
const regDetail = { registrationId: 14, referenceNo: "CHR-2026-0014", registrationType: "Charter", chapterId: null, chapterName: null, proposedChapterName: "Brgy. Pooc Chapter", barangay: "Pooc", regionId: 4, provinceId: 34, municipalityId: 3428, regionName: "Region IV-A CALABARZON", provinceName: "Laguna", municipalityName: "Santa Rosa", markAccentId: 3, accentName: "Forest", hexValue: "#2E6B52", intendedCouncilId: 4, intendedCouncilName: "Sta. Rosa City Council", actingCouncilId: 4, actingCouncilName: "Sta. Rosa City Council", routingReason: "Parent", submittedByMemberId: null, submittedByGiftName: null, submittedDateUtc: "2026-10-28T03:00:00Z", statusName: "Submitted", isOpen: true, decidedBy: null, decidedByGiftName: null, decidedDateUtc: null, decisionReason: null, createdChapterId: null, officers: regOfficers,
  history: [{ chapterRegistrationUpdateId: 1, updateDateUtc: "2026-10-28T03:00:00Z", updatedBy: null, statusName: "Submitted", notes: "Submitted through the public registration form." }],
  routing: { routingId: 1, intendedCouncilId: 4, actingCouncilId: 4, routingReason: "Parent", actorMemberId: null, actedOnUtc: "2026-10-28T03:00:00Z", remarks: null } };
const chapStats = [
  ["Brgy. San Isidro Chapter", "San Isidro", 10, 9, 8, 1, 0, 3, 7, 1450*3, 4280, 1],
  ["Brgy. Dila Chapter", "Dila", 24, 22, 20, 2, 0, 3, 15, 5200, 3100, 0],
  ["Brgy. Balibago Chapter", "Balibago", 31, 28, 26, 3, 1, 4, 20, 8900, 6400, 2],
  ["Brgy. Tagapo Chapter", "Tagapo", 18, 17, 14, 2, 0, 2, 11, 2600, 1800, 0],
  ["Brgy. Macabling Chapter", "Macabling", 12, 12, 9, 3, 0, 2, 8, 1900, 900, 0],
  ["Brgy. Market Area Chapter", "Market Area", 15, 13, 13, 2, 0, 3, 10, 3300, 2950, 1],
].map(([n, b, tot, act, ren, lap, ex, mh, avg, pin, pout, cases], i) => ({ chapterId: i + 1, chapterName: n, barangay: b, parentCouncilId: 4, parentCouncilName: "Sta. Rosa City Council", isActive: true, memberTotal: tot, memberPending: 0, memberApproved: 0, memberActive: act, memberInactive: tot - act, memberSuspended: 0, memberRejected: 0, newThisPeriod: i % 3, renewedCount: ren, lapsedCount: lap, exemptCount: ex, notRecordedCount: tot - ren - lap - ex, hasRenewalData: true, meetingsHeld: mh, totalPresent: mh * avg, totalOnSheets: mh * tot, averagePresentPerMeeting: avg, openingBalance: 5000 + i * 900, periodIn: pin, periodOut: pout, closingBalance: 5000 + i * 900 + pin - pout, caseCountPending: 0, caseCountUnderReview: cases, caseCountReconciled: 0, caseCountDismissed: 0 }));
const sum = (k) => chapStats.reduce((a, c) => a + c[k], 0);
const rollup = (id) => { const c = councils.find(x => x.councilId === id); return { councilId: id, councilName: c.councilName, levelName: c.levelName, parentCouncilId: c.parentCouncilId, depth: c.depth, hasSeatedOfficers: c.hasSeatedOfficers, directChildCouncilCount: c.directChildCouncilCount, totalCouncilsInSubtree: 1, directChapterCount: 6, totalChaptersInSubtree: 6, activeChapterCount: 6, inactiveChapterCount: 0, memberTotal: sum("memberTotal"), memberPending: 0, memberApproved: 0, memberActive: sum("memberActive"), memberInactive: sum("memberInactive"), memberSuspended: 0, memberRejected: 0, newThisPeriod: sum("newThisPeriod"), detachedMemberCount: 2, renewedCount: sum("renewedCount"), lapsedCount: sum("lapsedCount"), exemptCount: sum("exemptCount"), notRecordedCount: sum("notRecordedCount"), hasRenewalData: true, regSubmittedCount: 1, regReturnedForCorrectionCount: 0, regApprovedCount: 6, meetingsHeld: sum("meetingsHeld"), totalPresent: sum("totalPresent"), totalOnSheets: sum("totalOnSheets"), averagePresentPerMeeting: 11.8 }; };
const stats = { fromDate: "2026-08-09", toDate: "2026-10-31", focus: rollup(4), childCouncils: [], chapters: chapStats, totalChapterCount: 6, correctiveActionTotals: [{ statusName: "Under Review", caseCount: 4 }, { statusName: "Reconciled", caseCount: 2 }] };
const councilRoster = { seats: [
  [600, 1, "President", "CouncilAdmin", 50, "MAKISIG", "AKR-04-0121-003", "Rodel P. Santiago", "Brgy. Dila Chapter"],
  [601, 3, "Secretary", "CouncilSecretary", 51, "BATIS", "AKR-04-0125-011", "Allan V. Ocampo", "Brgy. Balibago Chapter"],
  [602, 4, "Treasurer", "CouncilTreasurer", 52, "HALIGI", "AKR-04-0117-004", "Dennis L. Portugal", CH.name],
  [603, 6, "Public Information Officer", "CouncilPIO", 53, "TINIG", "AKR-04-0402-002", "Ferdinand Q. Salazar", "Brgy. Poblacion Chapter (Cabuyao)"],
].map(([rid, oid, on, rn, mid, g, num, fn, hc]) => ({ memberRoleId: rid, councilOfficeId: oid, officeName: on, roleName: rn, memberId: mid, giftName: g, memberNumber: num, fullName: fn, homeChapterName: hc, termStart: "2026-08-09", termEnd: null, isCurrent: true, renewedThrough: RT, hasAccount: true })),
  overrides: [{ seatOverrideId: 1, memberRoleId: 603, giftName: "TINIG", memberNumber: "AKR-04-0402-002", homeChapterName: "Brgy. Poblacion Chapter (Cabuyao)", reason: "Only qualified PIO volunteer; former Sta. Rosa resident who moved to Cabuyao in 2025.", seatedOnUtc: "2026-08-15T03:00:00Z", seatedByGiftName: "MAKISIG" }] };
const jurMembers = members.slice(0, 6).map(m => ({ memberId: m.memberId, giftName: m.giftName, memberNumber: m.memberNumber, fullName: m.fullName, mobileNo: m.mobileNo, email: null, chapterId: 1, chapterName: CH.name, homeCouncilId: null, homeCouncilName: null, statusName: m.status, renewedThrough: m.renewedThrough, isBlocked: false, regionName: "Region IV-A CALABARZON", provinceName: "Laguna", cityName: "Santa Rosa" }));
const jurChapters = chapStats.map((c, i) => ({ chapterId: c.chapterId, chapterName: c.chapterName, isOnHold: i === 4, memberCount: c.memberTotal, regionName: "Region IV-A CALABARZON", provinceName: "Laguna", cityName: "Santa Rosa" }));

const PERSONAS = {
  chapter: { memberId: 1, chapterId: 1, chapterName: CH.name, giftName: "TANGLAW", roles: ["Member", "ChapterAdmin", "ChapterOfficer", "ChapterTreasurer"] },
  council: { memberId: 50, chapterId: 2, chapterName: "Brgy. Dila Chapter", giftName: "MAKISIG", roles: ["Member", "CouncilAdmin", "CouncilSecretary"] },
};

function handle(method, url, persona) {
  const u = new URL(url); const p = u.pathname; const q = u.searchParams;
  const m = (re) => re.test(p);
  if (p === "/api/auth/refresh") return { accessToken: "demo", expiresAtUtc: "2026-12-31T00:00:00Z" };
  if (p === "/api/auth/me") return PERSONAS[persona];
  if (method === "GET") {
    if (m(/\/ledger\/summary$/)) return { cashIn: 14150, cashOut: 6680, balance: 7470 };
    if (m(/\/ledger$/)) return paged(ledger);
    if (m(/\/dashboard$/)) return { fromDate: "2026-08-09", toDate: "2026-10-31", financial: { openingBalance: 5500, periodIn: 8650, periodOut: 6680, closingBalance: 7470, currentBalance: 7470, inFromMeetings: 3250, inFromDonations: 3000, inOther: 2400, outOnExpenses: 6680, outOther: 0 }, membership: { total: 10, pending: 1, approved: 0, active: 9, inactive: 1, suspended: 0, rejected: 0, newThisPeriod: 1 }, activity: { meetingsHeld: 3, totalPresent: 22, totalOnSheets: 30, averagePresentPerMeeting: 7.3 }, correctiveActionCounts: [{ statusName: "Under Review", caseCount: 1 }, { statusName: "Reconciled", caseCount: 1 }, { statusName: "Dismissed", caseCount: 1 }] };
    if (m(/\/meetings\/\d+$/)) return meetingDetail;
    if (m(/\/meetings$/)) return paged(meetings);
    if (m(/\/chapters\/\d+\/announcements$/)) return paged(announcements);
    if (m(/\/read-receipts$/)) return members.slice(0, 6).map((x, i) => ({ memberId: x.memberId, giftName: x.giftName, fullName: x.fullName, readDateUtc: `2026-10-30T1${i}:05:00Z` }));
    if (m(/\/memos$/)) return paged(memos);
    if (m(/\/activities$/)) return paged(activities);
    if (m(/\/expenses\/\d+$/)) return { ...expenses[0], chapterId: 1, attachments: [{ attachmentId: 1, fileName: "receipt-carinderia.jpg", fileSize: 184320, uploadedBy: 4 }], voidHistory: [] };
    if (m(/\/expenses$/)) return paged(expenses);
    if (m(/\/donations\/\d+$/)) return { ...donations[0], chapterId: 1, voidHistory: [] };
    if (m(/\/donations$/)) return paged(donations);
    if (m(/\/corrective-actions\/\d+$/)) return caseDetail;
    if (m(/\/corrective-actions$/)) return paged(cases);
    if (p === "/api/corrective-action-categories") return [{ categoryId: 1, categoryName: "Absence without notice" }, { categoryId: 2, categoryName: "Conduct unbecoming" }, { categoryId: 3, categoryName: "Misuse of chapter name" }];
    if (m(/\/chat\/room$/)) return { roomId: 1, chapterId: 1, roomName: CH.name, retentionMonths: 12, wasCreated: false, isMuted: false };
    if (m(/\/chat\/messages$/)) return [...msgs].reverse();
    if (m(/\/chat\/moderation-queue$/)) return { messages: [], flags: [], total: 0, skip: 0, take: 1 };
    if (m(/\/conversations\/\d+\/messages$/)) return [];
    if (p === "/api/conversations") return paged(conversations);
    if (p === "/api/members/me/credential") return credential;
    if (p === "/api/members/me") return profile;
    if (p === "/api/members/blocked") return [];
    if (p === "/api/members/search-jurisdiction") return paged(jurMembers);
    if (m(/^\/api\/members\/\d+$/)) return { ...profile, regionName: "Region IV-A CALABARZON", provinceName: "Laguna", cityName: "Santa Rosa" };
    if (p === "/api/members") return paged(members);
    if (p === "/api/blood-types") return ["O+","O-","A+","A-","B+","B-","AB+","AB-"].map((b, i) => ({ bloodTypeId: i + 1, bloodTypeName: b }));
    if (p === "/api/skills") return ["Electrical","Driving","First aid","Carpentry","Cooking"].map((s, i) => ({ skillId: i + 1, skillName: s }));
    if (p === "/api/membership-applications") return q.get("statusId")==="1" ? { items: [apps[0]], total: 1, skip: 0, take: 1 } : paged(apps);
    if (m(/\/membership-applications\/\d+$/)) return appDetail;
    if (m(/\/chapters\/\d+\/officers$/)) return officerSeats;
    if (p === "/api/chapters/me/invite-link") return { hasLink: true, createdDateUtc: "2026-08-15T03:00:00Z" };
    if (p === "/api/notifications/preferences") return { privateMessagePush: true, mentionPush: true, announcementPush: true };
    if (p === "/api/chapter-registrations") return paged(regQueue);
    if (m(/\/chapter-registrations\/13$/)) return { ...regDetail, registrationId: 13, referenceNo: "CHR-2026-0013", proposedChapterName: "Brgy. Canlalay Chapter", barangay: "Canlalay", municipalityName: "Biñan", intendedCouncilId: 5, intendedCouncilName: "Biñan City Council", actingCouncilId: 3, actingCouncilName: "Laguna Provincial Council", routingReason: "ParentDormant", officers: regOfficers.map(o => ({ ...o, verifiedBy: null, verifiedByGiftName: null, verifiedDateUtc: null })), routing: { ...regDetail.routing, intendedCouncilId: 5, actingCouncilId: 3, routingReason: "ParentDormant" } };
    if (m(/\/chapter-registrations\/\d+$/)) return regDetail;
    if (p === "/api/chapters") return chapStats.map(c => ({ chapterId: c.chapterId, chapterName: c.chapterName, regionName: "Region IV-A CALABARZON", provinceName: "Laguna", cityName: "Santa Rosa" }));
    if (p === "/api/chapters/search-jurisdiction") return paged(jurChapters);
    if (m(/statistics$/)) return stats;
    if (m(/^\/api\/councils\/\d+\/officers$/)) return councilRoster;
    if (p === "/api/councils") { const id = Number(q.get("councilId")); return id ? councils.filter(c => c.councilId === id) : councils; }
    if (p === "/api/announcements/national") return paged([announcements[1]]);
    if (p === "/api/regions") return [{ regionId: 4, regionCode: "04A", regionName: "Region IV-A CALABARZON" }];
    if (p === "/api/provinces") return [{ provinceId: 34, regionId: 4, provinceCode: 434, provinceName: "Laguna" }];
    if (p === "/api/municipalities") return [{ municipalityId: 3428, provinceId: 34, municipalityCode: 43428, municipalityName: "Santa Rosa", zipCode: "4026" }];
    if (m(/^\/api\/chapters\/invite\//)) return { isValid: true, chapterId: 1, chapterName: CH.name };
    if (m(/^\/api\/enrolment\//)) return { firstName: "Eduardo", giftName: "KALASAG", chapterName: "Brgy. Pooc Chapter", expiresOnUtc: "2026-11-03T03:00:00Z" };
  }
  if (method === "POST") {
    if (p === "/api/verifications") return { isValid: true, giftName: "TANGLAW", chapterName: CH.name, statusName: "Active", renewedThrough: RT, photoUrl: null };
    if (p === "/api/scans") return { isValid: true, giftName: "TANGLAW", chapterName: CH.name, statusName: "Active", renewedThrough: RT, isSameChapter: true, fullName: "Ramon C. Delgado", memberNumber: byId(1).memberNumber, bloodTypeName: "O+" };
    if (p === "/api/chapters/me/invite-link/regenerate") return { joinUrl: "https://ais.example.ph/j/7Kq2xZ9mVb", createdDateUtc: "2026-10-31T03:00:00Z" };
    return {};
  }
  return undefined;
}
module.exports = { handle };
