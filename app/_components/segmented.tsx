"use client";

// ---------------------------------------------------------------------------
// Segmented — a small horizontal pill-button set used for filter / group-by
// controls. Extracted from total-view.tsx so the Share-with-friend modal
// can present the same control shape without divergent styling.
//
// Values are opaque strings; the parent owns the state and semantics.
// ---------------------------------------------------------------------------

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<readonly [string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([val, label]) => {
        const active = val === value;
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`touch-manipulation rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Row layout used inside a filter panel: a fixed-width label to the
// left, the control (usually a Segmented) to the right.
export function ControlRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </div>
  );
}
