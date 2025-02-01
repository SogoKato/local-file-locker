import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local file locker",
  description: "Store encrypted data in the browser OPFS.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="bg-slate-50 dark:bg-slate-950"
      >
        {children}
      </body>
    </html>
  );
}
