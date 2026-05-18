// Tests for the categorical rhythm label used in the Grid view's
// "Type" column. The buckets are user-spec: Multi / Daily / Specific /
// N per Period.

import { describe, expect, it } from "vitest";

import { rhythmCategoryLabel } from "@/lib/domain/rhythm-summary";

describe("rhythmCategoryLabel — Grid type-column buckets", () => {
  it("single → Once (singles are filtered out of the grid; defensive)", () => {
    expect(rhythmCategoryLabel({ type: "single" })).toBe("Once");
  });

  it("daily → Daily", () => {
    expect(rhythmCategoryLabel({ type: "daily" })).toBe("Daily");
  });

  it("weekdays → Specific", () => {
    expect(
      rhythmCategoryLabel({ type: "weekdays", days: ["mon", "wed", "fri"] })
    ).toBe("Specific");
  });

  it("interval=1 → Daily (collapsed since every-1-day == daily)", () => {
    expect(rhythmCategoryLabel({ type: "interval", days: 1 })).toBe("Daily");
  });

  it("interval=N (N>1) → N per Period", () => {
    expect(rhythmCategoryLabel({ type: "interval", days: 3 })).toBe(
      "N per Period"
    );
    expect(rhythmCategoryLabel({ type: "interval", days: 14 })).toBe(
      "N per Period"
    );
  });

  it("frequency 1× per day → Daily", () => {
    expect(
      rhythmCategoryLabel({
        type: "frequency",
        count: 1,
        perCount: 1,
        perUnit: "days",
      })
    ).toBe("Daily");
  });

  it("frequency 3× per day → Multi (multi-daily)", () => {
    expect(
      rhythmCategoryLabel({
        type: "frequency",
        count: 3,
        perCount: 1,
        perUnit: "days",
      })
    ).toBe("Multi");
  });

  it("frequency 3× per week → N per Period", () => {
    expect(
      rhythmCategoryLabel({
        type: "frequency",
        count: 3,
        perCount: 1,
        perUnit: "weeks",
      })
    ).toBe("N per Period");
  });

  it("frequency 2× per 3 weeks → N per Period", () => {
    expect(
      rhythmCategoryLabel({
        type: "frequency",
        count: 2,
        perCount: 3,
        perUnit: "weeks",
      })
    ).toBe("N per Period");
  });
});
