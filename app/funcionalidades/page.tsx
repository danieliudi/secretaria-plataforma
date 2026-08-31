import Link from "next/link";
import { Logo } from "@/components/Logo";
import { EXEMPLOS } from "@/lib/exemplos";
import { BotaoEntrar } from "@/components/BotaoEntrar";
import { SecaoNovidades } from "@/components/SecaoNovidades";

// Página pública — antes isso só existia resumido na Home ("Como se fala
// com ela"). Aqui cada categoria ganha descrição própria; os EXEMPLOS
// (mesma fonte da Home, lib/exemplos.ts) continuam sendo os mesmos pedidos
// reais, só detalhados.
//
// As frases de EXEMPLOS são só o que a PESSOA diria (nunca alternam com
// resposta da Mia) — por isso viram lista de citação, igual já é na Home,
// em vez de bolha de chat: inventar a resposta da Mia pra cada uma seria
// texto de propaganda que ninguém testou, não um exemplo real.
export const metadata = {
  title: "Funcionalidades — Mia",
};

// A seção de novidades lê do banco, mas o conteúdo muda uma vez por semana e
// esta é a página de marketing. ISR de 10 min: entrada nova aparece sozinha,
// sem deploy, e sem uma ida ao banco por visitante.
export const revalidate = 600;

export default function FuncionalidadesPage() {
  return (
    <main className="aurora-bg flex min-h-screen flex-col">
      <header className="bg-aurora-header-bg">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
          <Link href="/">
            <Logo variant="header" />
          </Link>
          <div className="flex items-center gap-6">
            {/* "Novidades" saiu do menu: virou a última seção desta página. A
                rota /novidades continua existindo e redireciona pra âncora —
                o painel de dentro do app e os links dos termos apontam pra
                ela, e link salvo por alguém não pode quebrar. */}
            <span className="text-[13.5px] font-semibold text-aurora-fg">Funcionalidades</span>
            <BotaoEntrar />
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-6 pb-10 pt-14 text-center md:pt-20">
        <h1 className="text-balance font-serif text-[36px] font-semibold leading-[1.1] tracking-tight text-aurora-fg md:text-[44px]">
          Tudo que a Mia faz por você
        </h1>
        <p className="max-w-lg text-[15.5px] leading-relaxed text-aurora-muted">
          Ela cuida da sua agenda, do seu e-mail e das suas tarefas — e você fala com ela
          como falaria com uma pessoa.
        </p>
      </section>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 pb-20 pt-4 md:gap-24">
        {EXEMPLOS.map((grupo, i) => {
          const par = i % 2 === 1;
          return (
            <section
              key={grupo.titulo}
              className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-14"
            >
              <div className={par ? "md:order-2" : undefined}>
                <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-accent-text">
                  {grupo.eyebrow}
                </span>
                <h2 className="mt-2 text-balance text-[26px] font-semibold leading-tight tracking-tight text-aurora-fg">
                  {grupo.titulo}
                </h2>
                <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-aurora-muted">
                  {grupo.descricao}
                </p>
              </div>
              <div className={`aurora-card flex flex-col gap-2 rounded-2xl border border-aurora-line bg-aurora-surface p-5 ${par ? "md:order-1" : ""}`}>
                {grupo.frases.map((frase) => (
                  <p
                    key={frase}
                    className="rounded-lg bg-aurora-surface-2 px-3 py-2 text-[13.5px] leading-snug text-aurora-fg"
                  >
                    “{frase}”
                  </p>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <SecaoNovidades />

      <section className="border-t border-aurora-line-soft">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-5 px-6 py-20">
          <h2 className="text-balance text-[32px] font-semibold leading-tight tracking-tight text-aurora-fg">
            Pronto pra parar de ser o seu próprio assistente?
          </h2>
          <Link
            href="/login"
            className="aurora-glow-btn rounded-lg bg-aurora-accent px-6 py-3.5 text-[14.5px] font-semibold text-aurora-accent-ink transition active:scale-[0.98]"
          >
            Criar a minha secretária
          </Link>
        </div>
      </section>

      <footer className="border-t border-aurora-line-soft">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-2 gap-y-2 px-6 py-7">
          <Logo variant="footer" />
          <span className="mx-1 text-aurora-line">·</span>
          <Link href="/privacidade" className="text-[13px] text-aurora-muted-2 transition hover:text-aurora-muted">
            Privacidade
          </Link>
          <span className="text-aurora-line">·</span>
          <Link href="/termos" className="text-[13px] text-aurora-muted-2 transition hover:text-aurora-muted">
            Termos de Uso
          </Link>
        </div>
      </footer>
    </main>
  );
}
