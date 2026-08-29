import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { BotaoEntrar } from "@/components/BotaoEntrar";

// Página pública (sem login) — mesmo lugar que o link "Novidades" na landing
// aponta. Lê com o client anon (RLS: "atualizacoes: leitura pública"), não o
// service role — é conteúdo de propósito público, não tem por que bypassar RLS
// aqui.
export const dynamic = "force-dynamic";

interface Atualizacao {
  id: number;
  titulo: string;
  descricao: string;
  categoria: "nova" | "melhoria" | "correcao";
  publicado_em: string;
}

const TAG_LABEL: Record<Atualizacao["categoria"], string> = {
  nova: "nova",
  melhoria: "melhoria",
  correcao: "correção",
};

// Cor semântica de status — deliberadamente NÃO usa --aurora-accent, senão
// "isso é novo" se confundiria visualmente com "isso é a marca Mia".
const TAG_CLASS: Record<Atualizacao["categoria"], string> = {
  nova: "bg-aurora-ok/10 text-aurora-ok",
  melhoria: "bg-aurora-info/10 text-aurora-info",
  correcao: "bg-aurora-warn/10 text-aurora-warn",
};

function formataData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  });
}

export default async function NovidadesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("atualizacoes")
    .select("id, titulo, descricao, categoria, publicado_em")
    .order("publicado_em", { ascending: false });

  const entradas = (error ? [] : data) as Atualizacao[];

  return (
    <main className="aurora-bg flex min-h-screen flex-col">
      {/* ── topo (mesmo padrão da landing) ── */}
      <header className="bg-aurora-header-bg">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
          <Link href="/">
            <Logo variant="header" />
          </Link>
          <div className="flex items-center gap-6">
            <span className="text-[13.5px] font-semibold text-aurora-fg">Novidades</span>
            <BotaoEntrar />
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pb-24 pt-6 md:pt-10">
        <div className="flex flex-col gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-aurora-accent-text">
            Histórico de atualizações
          </span>
          <h1 className="text-balance text-[32px] font-semibold leading-tight tracking-tight text-aurora-fg md:text-[38px]">
            O que mudou na Mia
          </h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-aurora-muted">
            Tudo que sua secretária ganhou ou melhorou, na ordem em que aconteceu.
          </p>
        </div>

        {entradas.length === 0 ? (
          <p className="text-[14px] text-aurora-muted">Nada por aqui ainda — volte em breve.</p>
        ) : (
          <div className="flex flex-col">
            {entradas.map((e, i) => (
              <div
                key={e.id}
                className="grid grid-cols-1 gap-1.5 py-5 sm:grid-cols-[88px_1fr] sm:gap-5"
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--aurora-line-soft)" }}
              >
                <span className="font-mono text-[11.5px] text-aurora-muted-2 sm:pt-0.5">
                  {formataData(e.publicado_em)}
                </span>
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-aurora-fg">{e.titulo}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${TAG_CLASS[e.categoria]}`}
                    >
                      {TAG_LABEL[e.categoria]}
                    </span>
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-aurora-muted">{e.descricao}</p>
                </div>
              </div>
            ))}
          </div>
        )}
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
