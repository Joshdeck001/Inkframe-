import type { Metadata } from "next";
import { Inter } from "next/font/google";

// Every page's own CSS already specifies `Inter` first in its font stack
// (e.g. "-apple-system, Inter, Arial, sans-serif") — it just was never
// actually loaded, so browsers silently fell back to the OS default
// (Segoe UI on Windows, etc.) instead of the intended typeface. This loads
// the real font under that exact family name; it changes no CSS, no
// layout, no colors — just makes the already-specified font actually render.
const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "InkFrame",
  description: "InkFrame — AI-powered writing, formatting and publishing agent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
