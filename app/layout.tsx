import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "InkFrame",
  description: "InkFrame — AI-powered writing, formatting and publishing agent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
