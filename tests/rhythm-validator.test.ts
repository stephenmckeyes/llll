// Tests for lib/validators/rhythm.ts — the Zod schema that guards
// the recurrence field before it reaches the DB.

import { describe, expect, it } from "vitest";
import { rhythmSchema } from "@/lib/validators/rhythm";

describe("rhythmSchema — accepts valid shapes", () => {
  it("daily", () => {
    expect(() => rhythmSchema.parse({ type: "daily" })).not.toThrow();
  });

  it("weekdays with one day", () => {
    expect(() =>
      rhythmSchema.parse({ type: "weekdays", days: ["mon"] })
    ).not.toThrow();
  });

  it("weekdays with multiple days", () => {
    expect(() =>
      rhythmSchema.parse({ type: "weekdays", days: ["mon", "wed", "fri"] })
    ).not.toThrow();
  });

  it("interval with positive integer", () => {
    expect(() =>
      rhythmSchema.parse({ type: "interval", days: 7 })
    ).not.toThrow();
  });

  it("frequency weekly", () => {
    expect(() =>
      rhythmSchema.parse({ type: "frequency", count: 3, period: "week" })
    ).not.toThrow();
  });

  it("frequency monthly", () => {
    expect(() =>
      rhythmSchema.parse({ type: "frequency", count: 1, period: "month" })
    ).not.toThrow();
  });

  it("frequency daily (N times per day)", () => {
    expect(() =>
      rhythmSchema.parse({ type: "frequency", count: 5, period: "day" })
    ).not.toThrow();
  });
});

describe("rhythmSchema — rejects invalid shapes", () => {
  it("unknown type", () => {
    expect(() => rhythmSchema.parse({ type: "weekly" })).toThrow();
  });

  it("missing type", () => {
    expect(() => rhythmSchema.parse({ days: ["mon"] })).toThrow();
  });

  it("weekdays with empty days array", () => {
    expect(() =>
      rhythmSchema.parse({ type: "weekdays", days: [] })
    ).toThrow();
  });

  it("weekdays with invalid day name", () => {
    expect(() =>
      rhythmSchema.parse({ type: "weekdays", days: ["mon", "funday"] })
    ).toThrow();
  });

  it("interval missing days", () => {
    expect(() => rhythmSchema.parse({ type: "interval" })).toThrow();
  });

  it("interval with zero days", () => {
    expect(() =>
      rhythmSchema.parse({ type: "interval", days: 0 })
    ).toThrow();
  });

  it("interval with negative days", () => {
    expect(() =>
      rhythmSchema.parse({ type: "interval", days: -1 })
    ).toThrow();
  });

  it("interval with fractional days", () => {
    expect(() =>
      rhythmSchema.parse({ type: "interval", days: 2.5 })
    ).toThrow();
  });

  it("frequency with invalid period", () => {
    expect(() =>
      rhythmSchema.parse({ type: "frequency", count: 3, period: "year" })
    ).toThrow();
  });

  it("frequency with zero count", () => {
    expect(() =>
      rhythmSchema.parse({ type: "frequency", count: 0, period: "week" })
    ).toThrow();
  });
});
