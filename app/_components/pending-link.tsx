"use client";

// ---------------------------------------------------------------------------
// PendingLink — a drop-in <Link> that shows an inline spinner while its
// navigation is in flight. Same mechanism as the view-switcher tabs:
// Next's useLinkStatus reports the nearest ancestor <Link>'s pending
// state, so the spinner appears the instant the user taps and clears
// when the destination finishes loading.
//
// Use it for any navigation that can take a beat (header buttons, back
// links, etc.) so a tap never feels like it did nothing.
// ---------------------------------------------------------------------------

import Link from "next/link";

import { TabPending } from "./tab-pending";

export function PendingLink({
  href,
  className,
  children,
  ariaLabel,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <Link href={href} className={className} aria-label={ariaLabel}>
      {children}
      <TabPending />
    </Link>
  );
}
