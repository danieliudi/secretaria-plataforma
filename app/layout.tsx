import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Fragment_Mono } from "next/font/google";
import "./globals.css";

const displayFont = Bricolage_Grotesque({
  variable: "--font-display",
  weight: ["600", "800"],
  subsets: ["latin"],
});

const bodyFont = Instrument_Sans({
  variable: "--font-body",
  weight: ["400", "500"],
  subsets: ["latin"],
});

const monoFont = Fragment_Mono({
  variable: "--font-mono-signal",
  weight: ["400"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Secretária — configure a sua",
  description: "Plataforma de onboarding self-serve da secretária agêntica.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
