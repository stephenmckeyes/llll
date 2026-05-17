// Tests for lib/domain/rhythms.ts — the rhythm-to-instance generator.

import { describe, expect, it } from "vitest";
import { generateInstances } from "@/lib/domain/rhythms";

describe("generateInstances — single rhythm", () => {
  it("produces exactly one instance on range.from", () => {
    expect(
      generateInstances(
        { type: "single" },
        { from: "2026-03-15", to: "2026-03-15" }
      )
    ).toEqual([{ scheduledFor: "2026-03-15" }]);
  });

  it("uses range.from even when range.to is later (singles ignore the window)", () => {
    expect(
      generateInstances(
        { type: "single" },
        { from: "2026-03-15", to: "2026-12-31" }
      )
    ).toEqual([{ scheduledFor: "2026-03-15" }]);
  });

  it("returns empty for an inverted range", () => {
    expect(
      generateInstances(
        { type: "single" },
        { from: "2026-03-15", to: "2026-03-14" }
      )
    ).toEqual([]);
  });
});

describe("generateInstances — daily rhythm", () => {
  it("produces one instance per day across a multi-day range", () => {
    expect(
      generateInstances(
        { type: "daily" },
        { from: "2026-01-01", to: "2026-01-05" }
      )
    ).toEqual([
      { scheduledFor: "2026-01-01" },
      { scheduledFor: "2026-01-02" },
      { scheduledFor: "2026-01-03" },
      { scheduledFor: "2026-01-04" },
      { scheduledFor: "2026-01-05" },
    ]);
  });

  it("returns a single instance for a one-day range", () => {
    expect(
      generateInstances(
        { type: "daily" },
        { from: "2026-01-01", to: "2026-01-01" }
      )
    ).toEqual([{ scheduledFor: "2026-01-01" }]);
  });

  it("returns empty for an inverted range", () => {
    expect(
      generateInstances(
        { type: "daily" },
        { from: "2026-12-31", to: "2026-01-01" }
      )
    ).toEqual([]);
  });
});

describe("generateInstances — weekdays rhythm", () => {
  // Reference: 2026-01-01 is a Thursday.
  it("selects only the specified weekdays within range", () => {
    const result = generateInstances(
      { type: "weekdays", days: ["mon", "wed"] },
      { from: "2026-01-01", to: "2026-01-14" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-05", // Mon
      "2026-01-07", // Wed
      "2026-01-12", // Mon
      "2026-01-14", // Wed
    ]);
  });

  it("handles every weekday selected", () => {
    const result = generateInstances(
      {
        type: "weekdays",
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      },
      { from: "2026-01-01", to: "2026-01-07" }
    );
    expect(result).toHaveLength(7);
  });

  it("handles weekends only", () => {
    const result = generateInstances(
      { type: "weekdays", days: ["sat", "sun"] },
      { from: "2026-01-01", to: "2026-01-11" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-03", // Sat
      "2026-01-04", // Sun
      "2026-01-10", // Sat
      "2026-01-11", // Sun
    ]);
  });

  it("returns empty if range contains no matching weekday", () => {
    // Mon Jan 5 → Tue Jan 6: no Wednesday in between.
    const result = generateInstances(
      { type: "weekdays", days: ["wed"] },
      { from: "2026-01-05", to: "2026-01-06" }
    );
    expect(result).toEqual([]);
  });
});

describe("generateInstances — interval rhythm", () => {
  it("steps forward by N days from the anchor", () => {
    // anchor=2025-12-30, +3=Jan 2, +6=Jan 5, +9=Jan 8, +12=Jan 11
    // Range [Jan 1, Jan 10] keeps Jan 2, Jan 5, Jan 8.
    const result = generateInstances(
      { type: "interval", days: 3 },
      { from: "2026-01-01", to: "2026-01-10" },
      { anchor: "2025-12-30" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-02",
      "2026-01-05",
      "2026-01-08",
    ]);
  });

  it("uses range.from as anchor when none provided", () => {
    const result = generateInstances(
      { type: "interval", days: 2 },
      { from: "2026-01-01", to: "2026-01-07" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-01",
      "2026-01-03",
      "2026-01-05",
      "2026-01-07",
    ]);
  });

  it("returns empty when next anchor + interval is past range.to", () => {
    const result = generateInstances(
      { type: "interval", days: 30 },
      { from: "2026-01-01", to: "2026-01-05" },
      { anchor: "2026-01-15" }
    );
    expect(result).toEqual([]);
  });

  it("handles a month boundary correctly", () => {
    // anchor=2026-01-23, +5=Jan 28, +10=Feb 2, +15=Feb 7, +20=Feb 12
    const result = generateInstances(
      { type: "interval", days: 5 },
      { from: "2026-01-28", to: "2026-02-10" },
      { anchor: "2026-01-23" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-28",
      "2026-02-02",
      "2026-02-07",
    ]);
  });

  it("includes the anchor itself if it lies within range", () => {
    const result = generateInstances(
      { type: "interval", days: 7 },
      { from: "2026-01-01", to: "2026-01-15" },
      { anchor: "2026-01-01" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
    ]);
  });
});

describe("generateInstances — flexible frequency (perCount + perUnit)", () => {
  it("'3 times per 2 weeks' steps every 14 days from start_date", () => {
    // Anchored to `from`. Jan 1 + 14 = Jan 15, + 14 = Jan 29, + 14 = Feb 12.
    const result = generateInstances(
      { type: "frequency", count: 3, perCount: 2, perUnit: "weeks" },
      { from: "2026-01-01", to: "2026-01-31" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-01",
      "2026-01-15",
      "2026-01-29",
    ]);
  });

  it("'1 time per 3 days' steps in 3-day chunks from start_date", () => {
    const result = generateInstances(
      { type: "frequency", count: 1, perCount: 3, perUnit: "days" },
      { from: "2026-01-01", to: "2026-01-10" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-01",
      "2026-01-04",
      "2026-01-07",
      "2026-01-10",
    ]);
  });

  it("'1 time per 2 months' steps in 2-month chunks from start_date", () => {
    const result = generateInstances(
      { type: "frequency", count: 1, perCount: 2, perUnit: "months" },
      { from: "2026-01-15", to: "2026-12-31" }
    );
    // addMonths from Jan 15 → Mar 15, May 15, Jul 15, Sep 15, Nov 15.
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-15",
      "2026-03-15",
      "2026-05-15",
      "2026-07-15",
      "2026-09-15",
      "2026-11-15",
    ]);
  });

  it("backwards-compat: legacy { count, period: 'week' } anchors to from too", () => {
    const newShape = generateInstances(
      { type: "frequency", count: 3, perCount: 1, perUnit: "weeks" },
      { from: "2026-01-01", to: "2026-01-31" }
    );
    const oldShape = generateInstances(
      { type: "frequency", count: 3, period: "week" },
      { from: "2026-01-01", to: "2026-01-31" }
    );
    expect(newShape).toEqual(oldShape);
  });
});

describe("generateInstances — frequency rhythm (legacy period shape)", () => {
  it("weekly: one instance per week from start_date", () => {
    // from = Thu Jan 1 → Jan 1, Jan 8, Jan 15, Jan 22, Jan 29.
    const result = generateInstances(
      { type: "frequency", count: 3, period: "week" },
      { from: "2026-01-01", to: "2026-01-31" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
      "2026-01-22",
      "2026-01-29",
    ]);
  });

  it("monthly: one instance per month from start_date", () => {
    const result = generateInstances(
      { type: "frequency", count: 1, period: "month" },
      { from: "2026-01-01", to: "2026-04-30" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
  });

  it("daily period: one instance per day in range", () => {
    const result = generateInstances(
      { type: "frequency", count: 5, period: "day" },
      { from: "2026-01-01", to: "2026-01-03" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });

  it("count is metadata only — does not multiply the instance list", () => {
    // count=3 vs count=10 should not change the number of instances.
    const three = generateInstances(
      { type: "frequency", count: 3, period: "week" },
      { from: "2026-01-05", to: "2026-01-18" }
    );
    const ten = generateInstances(
      { type: "frequency", count: 10, period: "week" },
      { from: "2026-01-05", to: "2026-01-18" }
    );
    expect(three).toEqual(ten);
    expect(three).toHaveLength(2);
  });
});

describe("generateInstances — calendar edge cases", () => {
  it("handles the leap day in 2028", () => {
    const result = generateInstances(
      { type: "daily" },
      { from: "2028-02-28", to: "2028-03-01" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("handles year boundary for daily", () => {
    const result = generateInstances(
      { type: "daily" },
      { from: "2025-12-30", to: "2026-01-02" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("handles year boundary for interval", () => {
    const result = generateInstances(
      { type: "interval", days: 2 },
      { from: "2025-12-30", to: "2026-01-04" },
      { anchor: "2025-12-30" }
    );
    expect(result.map((i) => i.scheduledFor)).toEqual([
      "2025-12-30",
      "2026-01-01",
      "2026-01-03",
    ]);
  });
});

describe("generateInstances — purity", () => {
  it("returns the same output for the same inputs (idempotent)", () => {
    const a = generateInstances(
      { type: "weekdays", days: ["mon", "wed", "fri"] },
      { from: "2026-01-01", to: "2026-01-31" }
    );
    const b = generateInstances(
      { type: "weekdays", days: ["mon", "wed", "fri"] },
      { from: "2026-01-01", to: "2026-01-31" }
    );
    expect(a).toEqual(b);
  });
});
