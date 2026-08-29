import type { Metadata, Viewport } from "next";
import { EB_Garamond, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { RegistraServiceWorker } from "@/components/RegistraServiceWorker";

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
  // PWA: o manifest é o que faz o Android oferecer "instalar" e, com o
  // share_target declarado lá dentro, listar a Mia no menu de compartilhar do
  // sistema quando a pessoa termina de gravar uma reunião.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Mia", statusBarStyle: "default" },
};

// Cor da barra do sistema quando o app roda instalado — mesmo tom do cabeçalho
// (--aurora-header-bg), pra não aparecer uma faixa branca por cima dele.
export const viewport: Viewport = {
  themeColor: "#e9edf3",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <RegistraServiceWorker />
        {children}
      </body>
    </html>
  );
}
