import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIDA CRM",
  description: "Verkaufschancen sicher strukturieren und mit AIDA bearbeiten.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
