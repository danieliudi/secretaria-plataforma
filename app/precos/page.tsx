import { notFound } from "next/navigation";
import Link from "next/link";
import { carregaDonoDaPlataforma } from "@/lib/admin-guard";

// Prévia interna da página de preços — ainda em beta fechado com conhecidos,
// sem cobrança nenhuma rodando. 404 (não "acesso negado") pra quem não é
// dono, mesmo padrão do /admin: pra todo mundo além do dono, essa rota não
// existe. Quando decidir publicar de verdade, troca esse guard por
// `export const dynamic` normal e tira este comentário.
//
// Números e nomes de plano são ilustrativos — vieram do mockup aprovado
// (artifact "Áudio, preço e cobrança", 18/08/2026). Nada aqui é preço final;
// o modelo de cobrança (Parte 2/3 daquele documento) ainda não foi decidido.
export const dynamic = "force-dynamic";

const WHATSAPP_NUMERO = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";
const WHATSAPP_LINK = WHATSAPP_NUMERO ? `https://wa.me/${WHATSAPP_NUMERO.replace(/\D/g, "")}` : null;

interface Plano {
  nome: string;
  preco: string;
  sufixo?: string;
  inclui: string;
  itens: string[];
  destaque?: boolean;
}

const PLANOS: Plano[] = [
  {
    nome: "Starter",
    preco: "R$ 39",
    sufixo: "/mês",
    inclui: "300 mensagens inclusas · R$ 0,15 por mensagem extra",
    itens: ["1 canal (WhatsApp, Telegram ou Teams)", "Google Tasks ou Microsoft To Do", "Confirmação e lembrete manuais"],
  },
  {
    nome: "Pro",
    preco: "R$ 89",
    sufixo: "/mês",
    inclui: "1.200 mensagens inclusas · R$ 0,10 por mensagem extra",
    itens: ["Canais ilimitados, ao mesmo tempo", "Qualquer provedor de tarefas", "Confirmação e lembrete automáticos", "Respostas em áudio"],
    destaque: true,
  },
  {
    nome: "Negócios",
    preco: "Sob consulta",
    inclui: "Volume alto, mais de uma secretária",
    itens: ["Tudo do Pro", "Múltiplos usuários por conta", "Suporte prioritário"],
  },
];

export default async function PrecosPage() {
  const dono = await carregaDonoDaPlataforma();
  if (!dono) notFound();

  return (
    <main className="aurora-bg flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="aurora-glow h-2 w-2 rounded-sm bg-aurora-accent" />
          <span className="text-[13.5px] font-bold tracking-tight text-aurora-fg">Mia</span>
        </Link>
        <span className="rounded-full border border-aurora-warn/35 bg-aurora-warn/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-aurora-warn">
          Prévia interna — só você vê essa página
        </span>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-6 pb-4 pt-8 text-center md:pt-14">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-aurora-accent-text">Planos</span>
        <h1 className="text-balance font-serif text-[36px] font-semibold italic leading-[1.1] tracking-tight text-aurora-fg md:text-[44px]">
          O que cabe no seu bolso.
        </h1>
        <p className="max-w-md text-[15px] leading-relaxed text-aurora-muted">
          Mensalidade fixa com mensagens inclusas — excedente cobrado só se passar do pacote.
        </p>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-5 px-6 pb-10 pt-8 sm:grid-cols-3">
        {PLANOS.map((plano) => (
          <div
            key={plano.nome}
            className={`relative flex flex-col gap-4 rounded-[20px] border p-6 ${
              plano.destaque
                ? "border-aurora-accent/50 bg-aurora-accent/[0.06]"
                : "border-aurora-line bg-aurora-surface"
            }`}
          >
            {plano.destaque && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-aurora-accent px-3 py-1 text-[9.5px] font-bold uppercase tracking-wide text-aurora-accent-ink">
                Mais escolhido
              </span>
            )}
            <span className="text-[12px] font-bold uppercase tracking-wide text-aurora-accent-text">{plano.nome}</span>
            <div className="text-[27px] font-bold text-aurora-fg">
              {plano.preco}
              {plano.sufixo && <span className="text-[13px] font-medium text-aurora-muted-2">{plano.sufixo}</span>}
            </div>
            <p className="text-[12px] leading-relaxed text-aurora-muted">{plano.inclui}</p>
            <ul className="flex flex-col gap-2">
              {plano.itens.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[12.5px] leading-snug text-aurora-fg/90">
                  <span className="mt-0.5 text-aurora-ok">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            {WHATSAPP_LINK ? (
              <a
                href={WHATSAPP_LINK}
                target="_blank"
                rel="noreferrer"
                className={`mt-1 rounded-lg py-2.5 text-center text-[13px] font-bold ${
                  plano.destaque ? "bg-aurora-accent text-aurora-accent-ink" : "bg-aurora-fg text-aurora-bg"
                }`}
              >
                Falar com a gente
              </a>
            ) : (
              <span className="mt-1 rounded-lg bg-aurora-surface-2 py-2.5 text-center text-[13px] font-bold text-aurora-muted-2">
                Falar com a gente
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 pb-20">
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11.5px] text-aurora-muted-2">
          <span className="rounded-full border border-aurora-line px-3 py-1">⚡ Pix automático — cancela quando quiser</span>
          <span className="rounded-full border border-aurora-line px-3 py-1">Cartão também aceito</span>
        </div>
        <p className="mt-6 text-center text-[12px] leading-relaxed text-aurora-muted-2">
          Nenhum desses planos está cobrando de ninguém ainda — a Mia continua em teste gratuito com
          quem já usa. Cobrança liga quando esses números virarem decisão de verdade.
        </p>
      </section>

      <footer className="border-t border-aurora-line-soft">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-6 py-7">
          <span className="h-2 w-2 rounded-sm bg-aurora-accent" />
          <span className="text-[13px] font-semibold text-aurora-muted">Mia</span>
        </div>
      </footer>
    </main>
  );
}
