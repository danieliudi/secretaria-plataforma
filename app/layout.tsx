import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

const bodyFont = Instrument_Sans({
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mia — sua secretária no WhatsApp",
  description:
    "Uma secretária que cuida da sua agenda, do seu e-mail e das suas tarefas pelo WhatsApp. Você fala como falaria com uma pessoa.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${bodyFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
