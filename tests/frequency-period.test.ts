// Tests for lib/domain/frequency-period.ts — the "N times per period"
// landing-day + due-day rules introduced when we stopped marking
// in-progress periods as unlabeled.

import { describe, expect, it } from "vitest";

import {
  frequencyDueDay,
  frequencyPeriodEnd,
  isPastDuePending,
  unlabeledLandingDay,
} from "@/lib/domain/frequency-period";
import type { Rhythm } from "@/lib/validators/rhythm";

const weekly1x: Rhythm = { type: "frequency", count: 1, perCount: 1, perUnit: "weeks" };
const thricePerWeek: Rhythm = { type: "frequency", count: 3, perCount: 1, perUnit: "weeks" };
const twiceDaily: Rhythm = { type: "frequency", count: 2, perCount: 1, perUnit: "days" };
const everyTwoWeeks: Rhythm = { type: "frequency", count: 1, perCount: 2, perUnit: "weeks" };
const monthly: Rhythm = { type: "frequency", count: 1, perCount: 1, perUnit: "months" };
const daily: Rhythm = { type: "daily" };
const single: Rhythm = { type: "single" };

describe("frequencyPeriodEnd", () => {
  it("returns scheduled_for + 1 week for weekly rhythms (exclusive end)", () => {
    expect(frequencyPeriodEnd("2026-05-25", weekly1x)).toBe("2026-06-01");
    expect(frequencyPeriodEnd("2026-05-25", thricePerWeek)).toBe("2026-06-01");
  });

  it("handles every-2-weeks correctly", () => {
    expect(frequencyPeriodEnd("2026-05-25", everyTwoWeeks)).toBe("2026-06-08");
  });

  it("handles monthly via month arithmetic, not 30 days", () => {
    expect(frequencyPeriodEnd("2026-01-15", monthly)).toBe("2026-02-15");
    expect(frequencyPeriodEnd("2026-02-15", monthly)).toBe("2026-03-15");
  });

  it("handles daily frequency (Multi-Daily)", () => {
    expect(frequencyPeriodEnd("2026-05-25", twiceDaily)).toBe("2026-05-26");
  });

  it("returns scheduled_for unchanged for non-frequency rhythms", () => {
    expect(frequencyPeriodEnd("2026-05-25", daily)).toBe("2026-05-25");
    expect(frequencyPeriodEnd("2026-05-25", single)).toBe("2026-05-25");
  });
});

describe("frequencyDueDay", () => {
  it("is periodEnd - 1 day (last day inside the inclusive period)", () => {
    expect(frequencyDueDay("2026-05-25", weekly1x)).toBe("2026-05-31");
    expect(frequencyDueDay("2026-05-25", thricePerWeek)).toBe("2026-05-31");
  });

  it("for a daily-frequency, the due day is scheduled_for itself", () => {
    expect(frequencyDueDay("2026-05-25", twiceDaily)).toBe("2026-05-25");
  });

  it("handles month boundaries", () => {
    // March 31 + 1 month = April 30 (date-fns clamps); due day = April 29.
    // Use a less ambiguous date: Jan 15 + 1 month = Feb 15, due = Feb 14.
    expect(frequencyDueDay("2026-01-15", monthly)).toBe("2026-02-14");
  });
});

describe("isPastDuePending — frequency vs. non-frequency", () => {
  describe("weekly (1×/week)", () => {
    // Period 5/25 .. 5/31 inclusive (periodEnd 6/1 exclusive).
    it("is NOT past-due while inside the period", () => {
      expect(isPastDuePending("2026-05-25", weekly1x, "2026-05-25")).toBe(false);
      expect(isPastDuePending("2026-05-25", weekly1x, "2026-05-27")).toBe(false);
      expect(isPastDuePending("2026-05-25", weekly1x, "2026-05-31")).toBe(false);
    });

    it("becomes past-due once today >= periodEnd", () => {
      expect(isPastDuePending("2026-05-25", weekly1x, "2026-06-01")).toBe(true);
      expect(isPastDuePending("2026-05-25", weekly1x, "2026-06-15")).toBe(true);
    });
  });

  describe("non-frequency", () => {
    it("matches the legacy scheduled_for < today rule for daily", () => {
      expect(isPastDuePending("2026-05-25", daily, "2026-05-25")).toBe(false);
      expect(isPastDuePending("2026-05-25", daily, "2026-05-26")).toBe(true);
    });

    it("matches the legacy rule for singles too", () => {
      expect(isPastDuePending("2026-05-25", single, "2026-05-25")).toBe(false);
      expect(isPastDuePending("2026-05-25", single, "2026-05-26")).toBe(true);
    });
  });
});

describe("unlabeledLandingDay", () => {
  it("jumps to the due day for frequency (not scheduled_for)", () => {
    expect(unlabeledLandingDay("2026-05-25", weekly1x)).toBe("2026-05-31");
    expect(unlabeledLandingDay("2026-05-25", everyTwoWeeks)).toBe("2026-06-07");
  });

  it("uses scheduled_for unchanged for non-frequency", () => {
    expect(unlabeledLandingDay("2026-05-25", daily)).toBe("2026-05-25");
    expect(unlabeledLandingDay("2026-05-25", single)).toBe("2026-05-25");
  });
});
