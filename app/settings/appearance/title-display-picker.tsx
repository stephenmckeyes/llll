"use client";

// ---------------------------------------------------------------------------
// TitleDisplayPicker — how long activity titles render on the calendar
// (Day rows + Week/Month banners): cut off / wrap / smaller text. Client
// preference (localStorage), applied instantly everywhere via
// lib/ui/title-display-client.
// ---------------------------------------------------------------------------

import { Segmented } from "@/app/_components/segmented";
import {
  isTitleDisplay,
  setTitleDisplayClient,
  useTitleDisplay,
} from "@/lib/ui/title-display-client";

const OPTIONS = [
  ["truncate", "Cut off (…)"],
  ["wrap", "Wrap"],
  ["shrink", "Smaller text"],
] as const;

export function TitleDisplayPicker() {
  const value = useTitleDisplay();
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        options={OPTIONS}
        value={value}
        onChange={(v) => {
          if (isTitleDisplay(v)) setTitleDisplayClient(v);
        }}
      />
      <div className="max-w-xs rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <p className="activity-title truncate text-sm font-medium">
          Evening walk around the lake with the neighborhood running club
        </p>
      </div>
    </div>
  );
}
