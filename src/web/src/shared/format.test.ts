import { describe, expect, it } from "vitest";
import { peso, pesoSigned, membershipYearLabel } from "./format";

describe("peso", () => {
  it("always shows two decimals", () => expect(peso(38420)).toBe("₱38,420.00"));
  it("handles zero", () => expect(peso(0)).toBe("₱0.00"));
  // A blank contribution is normal — contributions are voluntary — and must not
  // render as ₱NaN on a member's screen.
  it("renders a dash for missing values", () => {
    expect(peso(null)).toBe("—");
    expect(peso(undefined)).toBe("—");
  });
});

describe("pesoSigned", () => {
  it("marks money in and out", () => {
    expect(pesoSigned(3400, "In")).toBe("+₱3,400.00");
    expect(pesoSigned(1250, "Out")).toBe("−₱1,250.00");
  });
});

describe("membershipYearLabel", () => {
  it("spans two calendar years", () => expect(membershipYearLabel(2027)).toBe("2027–28"));
});
