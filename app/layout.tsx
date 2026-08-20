import type { Metadata } from "next";
import { EB_Garamond, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Rebrand 20/08/2026: Instrument Sans + Fraunces → Hanken Grotesk + Eb
// Garamond, junto da troca de paleta pra slate+ouro (ver globals.css) — as
// duas fontes vêm do mesmo board de referência da paleta nova.
const bodyFont = Hanken_Grotesk({
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

// Fonte de apoio, usada só como contraste editorial pontual (ex.: a manchete
// da /app) — nunca substitui a Hanken Grotesk como corpo de texto.
const displayFont = EB_Garamond({
  variable: "--font-display",
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
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
    <html lang="pt-BR" className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
