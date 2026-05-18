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

  it("frequency 3× per day → Multi Daily (auto-multi-daily)", () => {
    // The form converts "Daily + multi times" to a frequency rhythm
    // with perUnit=days perCount=1 count=N. The label collapses both
    // shapes into "Multi Daily".
    expect(
      rhythmCategoryLabel({
        type: "frequency",
        count: 3,
        perCount: 1,
        perUnit: "days",
      })
    ).toBe("Multi Daily");
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

describe("rhythmCategoryLabel — Multi prefix from scheduled_times", () => {
  it("single time → base label only", () => {
    expect(rhythmCategoryLabel({ type: "daily" }, ["09:00"])).toBe("Daily");
  });

  it("daily + multi times → Multi Daily", () => {
    expect(
      rhythmCategoryLabel({ type: "daily" }, ["09:00", "18:00"])
    ).toBe("Multi Daily");
  });

  it("weekdays + multi times → Multi Specific", () => {
    expect(
      rhythmCategoryLabel(
        { type: "weekdays", days: ["mon", "wed"] },
        ["08:00", "20:00"]
      )
    ).toBe("Multi Specific");
  });

  it("interval=3 + multi times → Multi N per Period", () => {
    expect(
      rhythmCategoryLabel({ type: "interval", days: 3 }, ["08:00", "20:00"])
    ).toBe("Multi N per Period");
  });

  it("3× per week (frequency) + multi times → Multi N per Period", () => {
    expect(
      rhythmCategoryLabel(
        { type: "frequency", count: 3, perCount: 1, perUnit: "weeks" },
        ["08:00", "20:00"]
      )
    ).toBe("Multi N per Period");
  });

  it("frequency-day-multi (the converted Daily+multi) → Multi Daily even with empty times", () => {
    expect(
      rhythmCategoryLabel({
        type: "frequency",
        count: 2,
        perCount: 1,
        perUnit: "days",
      })
    ).toBe("Multi Daily");
  });
});
