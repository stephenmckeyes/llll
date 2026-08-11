"use client";

// ---------------------------------------------------------------------------
// DefaultUntimedOpenPicker — two-button toggle for
// profiles.default_untimed_open (migration 0037). Controls whether
// each day's Timeline "Untimed activities" dropdown starts collapsed
// (default) or expanded. Same optimistic + revert-on-error pattern
// as the other settings pickers.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { updateDefaultUntimedOpen } from "@/app/actions/appearance";
import { Segmented } from "@/app/_components/segmented";

export function DefaultUntimedOpenPicker({
  initialOpen,
}: {
  initialOpen: boolean;
}) {
  const [value, setValue] = useState<"closed" | "open">(
    initialOpen ? "open" : "closed"
  );
  const [saved, setSaved] = useState<"closed" | "open">(
    initialOpen ? "open" : "closed"
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(next: string) {
    const v = next === "open" ? "open" : "closed";
    if (v === value || isPending) return;
    const prev = value;
    setValue(v);
    setError(null);
    startTransition(async () => {
      const res = await updateDefaultUntimedOpen(v === "open");
      if ("error" in res) {
        setValue(prev);
        setError(res.error);
      } else {
        setSaved(v);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Segmented
        options={[
          ["closed", "Collapsed"],
          ["open", "Expanded"],
        ]}
        value={value}
        onChange={pick}
      />
      {isPending && <p className="text-xs text-zinc-500">Saving…</p>}
      {!isPending && value !== saved && (
        <p className="text-xs text-zinc-500">
          Selection reverted — save failed.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
