import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

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
      // Intentionally NO `h-full` / `min-h-full` / `flex` here. Past
      // versions constrained <html> and <body> to viewport height and
      // made <body> a flex container; combined with `overflow-x:
      // hidden` in globals.css that turned <body> into a sized scroll
      // container instead of letting the viewport scroll naturally.
      // Result: page-level scroll silently broke everywhere except
      // views that used their OWN internal scroll container (Day view).
      // Keeping the markup minimal here lets the browser handle
      // viewport scroll by default. Each page's `<main>` carries its
      // own `min-h-svh` so short pages still look full.
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        {/* Vercel Speed Insights — collects real-user Core Web Vitals
            (load time, interaction latency) from production visitors.
            This is the data we use to find what's actually slow. No-op
            outside Vercel. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
