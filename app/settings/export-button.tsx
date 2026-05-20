"use client";

// ---------------------------------------------------------------------------
// ExportButton — Settings page button that calls the exportData server
// action, then turns the returned JSON string into a Blob the browser
// downloads via the standard <a download> trick.
//
// Why client-side: server actions can't directly trigger a browser
// download (they're React-style RPCs, not HTTP file responses). The
// action returns the JSON + filename; this component handles the
// File-System side of the equation.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { exportData } from "@/app/actions/export";

export function ExportButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleExport() {
    setError(null);
    startTransition(async () => {
      try {
        const { json, filename } = await exportData();
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        // Synthesize an <a> with download attribute, click it, then
        // revoke the object URL so the browser frees the Blob.
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Export failed.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleExport}
        disabled={isPending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Preparing…" : "Download JSON"}
      </button>
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
