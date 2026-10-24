import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GovFix — Public Service Desk",
  description: "A clear and accountable municipal grievance workflow for the City of Brookdale.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
