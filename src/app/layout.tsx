import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "alc-pjm",
  description: "Lightweight Jira-like project management board",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
