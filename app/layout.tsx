import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chatter",
  description: "Private, intentional conversations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
