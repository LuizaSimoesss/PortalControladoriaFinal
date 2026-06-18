import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Portal Controladoria | Apex",
  description: "Portal de Controladoria Apex Partners",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full">
      <head>
        <link rel="icon" href="/favicon-apex.svg" type="image/svg+xml" />
      </head>
      <body className="h-full overflow-hidden flex" style={{ background: "#f1f5f9" }} suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
