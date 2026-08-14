import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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

const TAG_CLASS: Record<Atualizacao["categoria"], string> = {
  nova: "bg-cyan/10 text-cyan",
  melhoria: "bg-violet/10 text-violet",
  correcao: "bg-amber-700/10 text-amber-700",
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
    <main className="flex flex-col">
      {/* ── topo (mesmo padrão da landing) ── */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm bg-cyan" />
          <span className="text-[13.5px] font-bold tracking-tight text-foreground">sinal</span>
        </Link>
        <div className="flex items-center gap-6">
          <span className="text-[13.5px] font-semibold text-foreground">Novidades</span>
          <Link
            href="/login"
            className="rounded-lg border border-line px-4 py-2 text-[13.5px] font-semibold text-foreground transition hover:border-muted-2"
          >
            Entrar
          </Link>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pb-24 pt-6 md:pt-10">
        <div className="flex flex-col gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-2">
            Histórico de atualizações
          </span>
          <h1 className="text-balance text-[32px] font-semibold leading-tight tracking-tight text-foreground md:text-[38px]">
            O que mudou no sinal
          </h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted">
            Tudo que sua secretária ganhou ou melhorou, na ordem em que aconteceu.
          </p>
        </div>

        {entradas.length === 0 ? (
          <p className="text-[14px] text-muted">Nada por aqui ainda — volte em breve.</p>
        ) : (
          <div className="flex flex-col">
            {entradas.map((e, i) => (
              <div
                key={e.id}
                className="grid grid-cols-1 gap-1.5 py-5 sm:grid-cols-[88px_1fr] sm:gap-5"
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--line-soft)" }}
              >
                <span className="font-mono text-[11.5px] text-muted-2 sm:pt-0.5">
                  {formataData(e.publicado_em)}
                </span>
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-foreground">{e.titulo}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${TAG_CLASS[e.categoria]}`}
                    >
                      {TAG_LABEL[e.categoria]}
                    </span>
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-muted">{e.descricao}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-6 py-7">
          <span className="h-2 w-2 rounded-sm bg-cyan" />
          <span className="text-[13px] font-semibold text-muted">sinal</span>
        </div>
      </footer>
    </main>
  );
}
