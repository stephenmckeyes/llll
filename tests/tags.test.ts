// Tests for lib/domain/tags.ts — the color palette + lookup helpers.

import { describe, expect, it } from "vitest";

import {
  buildTagMap,
  computeTagUsage,
  isValidTagColor,
  TAG_COLOR_FALLBACK,
  tagChipClasses,
  tagColorFor,
  tagDotClasses,
} from "@/lib/domain/tags";

describe("isValidTagColor", () => {
  it("accepts every palette key in TAG_COLORS", () => {
    // Spot-check a few that the picker definitely shows.
    expect(isValidTagColor("emerald")).toBe(true);
    expect(isValidTagColor("amber")).toBe(true);
    expect(isValidTagColor("gray")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isValidTagColor("bananna")).toBe(false);
    expect(isValidTagColor("")).toBe(false);
    expect(isValidTagColor("#ff0000")).toBe(false);
  });
});

describe("buildTagMap", () => {
  it("indexes rows by name", () => {
    const map = buildTagMap([
      { id: "1", name: "fitness", color: "emerald" },
      { id: "2", name: "work", color: "blue" },
    ]);
    expect(map.fitness.color).toBe("emerald");
    expect(map.work.color).toBe("blue");
  });

  it("degrades unknown colors to the fallback", () => {
    const map = buildTagMap([
      { id: "1", name: "fitness", color: "neon-purple" }, // not in palette
    ]);
    expect(map.fitness.color).toBe(TAG_COLOR_FALLBACK);
  });

  it("empty input yields empty map", () => {
    expect(Object.keys(buildTagMap([])).length).toBe(0);
  });

  it("attaches usage counts when provided", () => {
    const usage = new Map([
      ["fitness", 4],
      ["work", 1],
    ]);
    const map = buildTagMap(
      [
        { id: "1", name: "fitness", color: "emerald" },
        { id: "2", name: "work", color: "blue" },
        { id: "3", name: "unused", color: "amber" },
      ],
      usage
    );
    expect(map.fitness.usage).toBe(4);
    expect(map.work.usage).toBe(1);
    expect(map.unused.usage).toBe(0); // never assigned
  });
});

describe("computeTagUsage", () => {
  it("counts tag occurrences across activities", () => {
    const usage = computeTagUsage([
      { default_skill_tags: ["fitness", "work"] },
      { default_skill_tags: ["fitness"] },
      { default_skill_tags: ["fitness", "family"] },
      { default_skill_tags: null },
      { default_skill_tags: [] },
    ]);
    expect(usage.get("fitness")).toBe(3);
    expect(usage.get("work")).toBe(1);
    expect(usage.get("family")).toBe(1);
    expect(usage.get("nope")).toBeUndefined();
  });
});

describe("tagColorFor", () => {
  const map = buildTagMap([
    { id: "1", name: "fitness", color: "emerald" },
  ]);

  it("returns the color for known names", () => {
    expect(tagColorFor("fitness", map)).toBe("emerald");
  });

  it("returns the gray fallback for unknown names", () => {
    expect(tagColorFor("unknown", map)).toBe(TAG_COLOR_FALLBACK);
  });
});

describe("tagChipClasses / tagDotClasses", () => {
  it("returns Tailwind class strings, not empty", () => {
    // We don't assert the exact class names (those can change as the
    // palette is tuned). Just ensure the helper isn't returning empty
    // for any valid palette key — a regression that would make tags
    // invisible.
    for (const c of [
      "emerald",
      "sky",
      "amber",
      "red",
      "violet",
      "blue",
      "pink",
      "orange",
      "lime",
      "teal",
      "fuchsia",
      "gray",
    ] as const) {
      expect(tagChipClasses(c).length).toBeGreaterThan(0);
      expect(tagDotClasses(c).length).toBeGreaterThan(0);
    }
  });
});
