import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Legacy Files - Local File Locker",
  robots: { index: false, follow: false },
};

export default function LegacyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
