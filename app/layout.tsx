import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mission",
  description:
    "A simple, RuneScape-inspired productivity tracker. Build rhythms, log progress, grow.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
