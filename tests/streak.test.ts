// Tests for lib/domain/streak.ts — the per-activity streak counter
// displayed in the Grid view's Success column.

import { describe, expect, it } from "vitest";

import { computeStreak, periodEndDateStr } from "@/lib/domain/streak";
import type { Rhythm } from "@/lib/validators/rhythm";

const TODAY = "2026-05-17";
const DAILY: Rhythm = { type: "daily" };
const WEEKLY_3X: Rhythm = {
  type: "frequency",
  count: 3,
  perCount: 1,
  perUnit: "weeks",
};

describe("computeStreak — daily rhythms", () => {
  it("empty list → 0", () => {
    expect(computeStreak([], DAILY, TODAY)).toBe(0);
  });

  it("three completed days in a row → 3", () => {
    const insts = [
      { scheduled_for: "2026-05-16", status: "completed" },
      { scheduled_for: "2026-05-15", status: "completed" },
      { scheduled_for: "2026-05-14", status: "completed" },
    ];
    expect(computeStreak(insts, DAILY, TODAY)).toBe(3);
  });

  it("missed day breaks the streak", () => {
    const insts = [
      { scheduled_for: "2026-05-16", status: "completed" },
      { scheduled_for: "2026-05-15", status: "missed" },
      { scheduled_for: "2026-05-14", status: "completed" },
    ];
    expect(computeStreak(insts, DAILY, TODAY)).toBe(1);
  });

  it("past-pending (unlabeled) breaks the streak", () => {
    const insts = [
      { scheduled_for: "2026-05-16", status: "completed" },
      { scheduled_for: "2026-05-15", status: "pending" }, // user never marked
      { scheduled_for: "2026-05-14", status: "completed" },
    ];
    expect(computeStreak(insts, DAILY, TODAY)).toBe(1);
  });

  it("today's pending is skipped (still in progress)", () => {
    const insts = [
      { scheduled_for: TODAY, status: "pending" }, // user has all day
      { scheduled_for: "2026-05-16", status: "completed" },
      { scheduled_for: "2026-05-15", status: "completed" },
    ];
    expect(computeStreak(insts, DAILY, TODAY)).toBe(2);
  });

  it("today's pending counts when completed", () => {
    const insts = [
      { scheduled_for: TODAY, status: "completed" },
      { scheduled_for: "2026-05-16", status: "completed" },
    ];
    expect(computeStreak(insts, DAILY, TODAY)).toBe(2);
  });
});

describe("computeStreak — frequency (3x per week) rhythms", () => {
  it("a completed week + previous completed week → 2", () => {
    // Week-anchor instances on Mondays.
    const insts = [
      { scheduled_for: "2026-05-11", status: "completed" }, // week of May 11
      { scheduled_for: "2026-05-04", status: "completed" }, // week of May 4
    ];
    expect(computeStreak(insts, WEEKLY_3X, TODAY)).toBe(2);
  });

  it("current week still pending → skip; previous completed → 1", () => {
    // TODAY is Sun May 17 — within the May 11 week (May 11–17).
    const insts = [
      { scheduled_for: "2026-05-11", status: "pending" }, // user hasn't hit 3x yet
      { scheduled_for: "2026-05-04", status: "completed" },
    ];
    expect(computeStreak(insts, WEEKLY_3X, TODAY)).toBe(1);
  });

  it("previous week missed → streak broken before earlier wins", () => {
    const insts = [
      { scheduled_for: "2026-05-11", status: "completed" },
      { scheduled_for: "2026-05-04", status: "pending" }, // didn't hit 3x, week ended
      { scheduled_for: "2026-04-27", status: "completed" },
    ];
    expect(computeStreak(insts, WEEKLY_3X, TODAY)).toBe(1);
  });
});

describe("periodEndDateStr", () => {
  it("daily: end = next day", () => {
    expect(periodEndDateStr("2026-05-17", DAILY)).toBe("2026-05-18");
  });

  it("1x per week: end = +7 days", () => {
    expect(
      periodEndDateStr("2026-05-11", {
        type: "frequency",
        count: 1,
        perCount: 1,
        perUnit: "weeks",
      })
    ).toBe("2026-05-18");
  });

  it("2x per 3 weeks: end = +21 days", () => {
    expect(
      periodEndDateStr("2026-05-04", {
        type: "frequency",
        count: 2,
        perCount: 3,
        perUnit: "weeks",
      })
    ).toBe("2026-05-25");
  });

  it("3x per month: end = +1 month", () => {
    expect(
      periodEndDateStr("2026-05-01", {
        type: "frequency",
        count: 3,
        perCount: 1,
        perUnit: "months",
      })
    ).toBe("2026-06-01");
  });
});
