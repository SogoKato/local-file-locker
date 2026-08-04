import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bench - Local file locker",
  robots: {
    index: false,
    follow: false,
  },
};

export default function BenchLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
