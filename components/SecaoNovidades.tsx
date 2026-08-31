import { createClient } from "@supabase/supabase-js";

// O changelog, agora como SEÇÃO da vitrine em vez de página própria.
//
// Por que juntou (decisão do Daniel, 31/08/2026): duas páginas separadas
// dividiam o mesmo assunto em dois endereços que ninguém sabia qual visitar.
// Aqui a vitrine responde "o que ela faz" e a seção responde "o que mudou" —
// na mesma rolagem, pra quem já leu a primeira metade.
//
// Lê com o client anon SEM COOKIE (RLS "atualizacoes: leitura pública"), não o
// service role: é conteúdo público de propósito, não tem por que passar por
// cima de RLS.
//
// Sem cookie porque o cookie é o que forçaria a vitrine a renderizar a cada
// visita. Ela é a página de marketing, o conteúdo aqui muda uma vez por semana,
// e antes desta mudança ela era estática — trocar isso por uma ida ao banco em
// toda visita seria pagar caro por uma seção que quase nunca muda. Com o client
// anon puro, o `revalidate` da página volta a funcionar (ver
// app/funcionalidades/page.tsx).
export const ENTRADAS_VISIVEIS = 4;

interface Atualizacao {
  id: number;
  titulo: string;
  descricao: string;
  publicado_em: string;
}

/** "31 ago" — o pt-BR curto devolve "31 de ago.", que ocupa espaço à toa numa coluna estreita. */
function formataData(iso: string): string {
  return new Date(iso)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" })
    .replace(" de ", " ")
    .replace(".", "");
}

export async function SecaoNovidades() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data, error } = await supabase
    .from("atualizacoes")
    .select("id, titulo, descricao, publicado_em")
    .order("publicado_em", { ascending: false });

  // Erro de leitura e tabela vazia NÃO são a mesma coisa, e tratar os dois
  // igual é como uma seção inteira some sem ninguém notar: a página é gerada
  // no build, então um soluço de rede na hora do deploy assaria um HTML sem o
  // changelog e nada apareceria em lugar nenhum. Gritar no log do build é o
  // que separa "não tem novidade" de "não consegui ler".
  //
  // Não derruba o build de propósito: é ISR de 10 min, então a próxima
  // revalidação recupera sozinha. O estrago tem prazo de validade — o que não
  // pode é ser silencioso.
  if (error) {
    console.error("[novidades] leitura falhou; a seção vai sair da página:", error.message);
    return null;
  }
  const todas = (data ?? []) as Atualizacao[];
  // Nada publicado ainda: a seção some inteira em vez de mostrar um vazio.
  if (todas.length === 0) return null;

  const sobrando = todas.length - ENTRADAS_VISIVEIS;

  return (
    <section id="novidades" className="scroll-mt-6 border-t border-aurora-line-soft bg-aurora-surface">
      <div className="mx-auto w-full max-w-5xl px-6 py-16 md:py-20">
        <h2 className="text-balance text-[28px] font-semibold leading-tight tracking-tight text-aurora-fg">
          O que mudou recentemente
        </h2>
        <p className="mt-1.5 max-w-md text-[14.5px] leading-relaxed text-aurora-muted">
          Ela ganha coisa nova toda semana. Aqui fica o registro, do mais recente pro mais antigo.
        </p>

        {/* O teto de 4 é sobre a página inteira, não sobre esta seção: a
            vitrine já é longa, e onze entradas no fim dela empurrariam o
            convite pra fora da tela de quem rolou até aqui. O resto continua
            NA MESMA PÁGINA, atrás do <details> — abrir noutra rota seria voltar
            ao que esta mudança está desfazendo. */}
        <ul className="mt-7 flex flex-col">
          {todas.slice(0, ENTRADAS_VISIVEIS).map((e) => (
            <li key={e.id} className="grid grid-cols-[70px_minmax(0,1fr)] gap-x-5 border-b border-aurora-line-soft py-4 last:border-none">
              <span className="pt-[3px] font-mono text-[11.5px] tabular-nums text-aurora-muted">
                {formataData(e.publicado_em)}
              </span>
              <div className="min-w-0">
                <span className="block text-[15.5px] font-semibold leading-snug text-aurora-fg">{e.titulo}</span>
                <p className="mt-1 text-[13.8px] leading-relaxed text-aurora-muted">{e.descricao}</p>
              </div>
            </li>
          ))}
        </ul>

        {sobrando > 0 && (
          <details className="group mt-1">
            <summary className="cursor-pointer list-none py-3 text-[13.5px] font-semibold text-aurora-accent-text transition hover:opacity-80">
              <span className="group-open:hidden">ver as {todas.length} atualizações ›</span>
              <span className="hidden group-open:inline">mostrar menos ‹</span>
            </summary>
            <ul className="flex flex-col border-t border-aurora-line-soft">
              {todas.slice(ENTRADAS_VISIVEIS).map((e) => (
                <li key={e.id} className="grid grid-cols-[70px_minmax(0,1fr)] gap-x-5 border-b border-aurora-line-soft py-4 last:border-none">
                  <span className="pt-[3px] font-mono text-[11.5px] tabular-nums text-aurora-muted">
                    {formataData(e.publicado_em)}
                  </span>
                  <div className="min-w-0">
                    <span className="block text-[15.5px] font-semibold leading-snug text-aurora-fg">{e.titulo}</span>
                    <p className="mt-1 text-[13.8px] leading-relaxed text-aurora-muted">{e.descricao}</p>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
