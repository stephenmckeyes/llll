import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

import { BottomNav } from "./_components/bottom-nav";
import { MigrationCheckBanner } from "./_components/migration-check-banner";

// Lock the viewport: no pinch / double-tap zoom, no accidental rescaling on
// input focus. Mission is laid out for one canonical scale; zooming into the
// dashboard breaks the sticky-header math and produces the "weird
// zoom/unzoom" feel on iOS.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Link-preview metadata (this is what WhatsApp / iMessage / etc. show
// when the URL is pasted). Kept deliberately minimal: just the name +
// one tagline, no product explanation. openGraph/twitter mirror the
// same so every platform shows the identical, tidy preview.
export const metadata: Metadata = {
  title: "Mission",
  description: "The best tool for building personal identity and community.",
  openGraph: {
    title: "Mission",
    description: "The best tool for building personal identity and community.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Mission",
    description: "The best tool for building personal identity and community.",
  },
};

// Pre-hydration inline script that reads the user's saved theme out of
// localStorage and applies the `.dark` / `.sleep` classes to <html>
// BEFORE React renders. Without this, every page load briefly paints
// the default light theme and then re-paints once the React tree
// mounts and applies the saved preference — visually noisy and
// disorienting if the user prefers dark.
//
// The script also resolves `system` to the live OS preference. Stored
// as a tiny string so it can be inlined in dangerouslySetInnerHTML.
const themeScript = `
(function () {
  try {
    var saved = localStorage.getItem("mission-theme") || "system";
    var root = document.documentElement;
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = saved === "dark" || saved === "sleep" || (saved === "system" && prefersDark);
    root.classList.toggle("dark", dark);
    root.classList.toggle("sleep", saved === "sleep");
    // Seed the time-format localStorage key with 'auto' on first
    // paint so components that call useTimeFormat before hydration
    // (SSR mismatch prevention) read a stable value. The Settings
    // picker overrides this once the user picks 12h / 24h.
    if (!localStorage.getItem("mission-time-format")) {
      localStorage.setItem("mission-time-format", "auto");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // `suppressHydrationWarning` is required because the theme script
      // mutates <html>'s className before React hydrates, which would
      // otherwise trigger a mismatch warning.
      suppressHydrationWarning
      // App-shell layout: viewport is bounded (h-svh + overflow-hidden).
      // BottomNav sits at the bottom of the flex column, an in-flow
      // sibling of `{children}`; only the {children} wrapper scrolls, so
      // the outer chrome (header + BottomNav) stays put while page
      // content moves. Per user spec: "the screen fits the device's
      // screen where the bottom is located at the top of the schedule/
      // friends/levels/etc buttons so that if there is a section that
      // is supposed to scroll, that section scrolls, but the outlying
      // parts of the app do not move."
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex h-svh flex-col overflow-hidden">
        {/* Startup schema check — red strip if any migration listed in
            lib/db/schema-check.ts hasn't been applied yet. Silent when
            everything's caught up. */}
        <MigrationCheckBanner />
        {/* The scroll container. Every page's content lives inside
            this bounded region; the outer chrome (BottomNav below)
            stays fixed to the viewport. Individual pages may nest
            their own scroll containers (e.g. Day view). min-h-0 is
            required so the flex child can actually shrink below its
            content's natural height. */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
        {/* Persistent 5-slot bottom nav. Now an in-flow flex sibling
            (was fixed before the app-shell refactor) so it always sits
            at the bottom of the viewport without needing a spacer. */}
        <BottomNav />
        {/* Vercel Speed Insights — collects real-user Core Web Vitals
            (load time, interaction latency) from production visitors.
            This is the data we use to find what's actually slow. No-op
            outside Vercel. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
