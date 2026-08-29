"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// "Novidades" no cabeçalho da área logada — botão + painel que desliza por
// cima do app (mockup de 29/08/2026, aprovado).
//
// POR QUE PAINEL E NÃO PÁGINA: antes isto era um link pra /novidades, que é
// página do SITE — cabeçalho público, botão "Entrar", logo apontando pra
// landing, e nenhum caminho de volta pro app. Clicar em "o que mudou"
// custava a sessão de trabalho inteira. Ler changelog é uma pausa de vinte
// segundos, não uma viagem: o painel abre por cima, você lê, fecha, e
// continua na mesma tela com a mesma rolagem.
//
// A página pública NÃO morre — ela é a versão compartilhável (link próprio,
// indexável, serve quem ainda não é cliente). Mesmo conteúdo, mesma tabela,
// duas apresentações porque são dois públicos.
//
// A leitura é do CLIENTE, na tabela pública `atualizacoes` (RLS de leitura
// pública, o mesmo que a página usa) em vez de descer por prop: o cabeçalho
// é montado em 3 lugares (app, admin, onboarding) e nenhum deles já buscava
// isso. Falha em silêncio — sem ponto e sem lista, nunca com erro na tela.
//
// O "já vi" mora em localStorage, não no banco: é conveniência por
// navegador, não estado de negócio. Perder isso (aba anônima, limpar dados)
// só faz o ponto reaparecer uma vez.
const CHAVE = "mia:novidades-visto-em";

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

// Mesmas cores semânticas da página pública — deliberadamente NÃO usam
// --aurora-accent, senão "isso é novo" se confundiria com a marca Mia.
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

function leVisto(): string | null {
  try {
    return window.localStorage.getItem(CHAVE);
  } catch {
    // Modo privado / storage bloqueado.
    return null;
  }
}

function gravaVisto(valor: string): void {
  try {
    window.localStorage.setItem(CHAVE, valor);
  } catch {
    /* sem storage, sem marca — o ponto simplesmente não aparece */
  }
}

export function NovidadesPainel() {
  const [aberto, setAberto] = useState(false);
  const [visto, setVisto] = useState<string | null>(null);
  const [maisRecente, setMaisRecente] = useState<string | null>(null);
  const [entradas, setEntradas] = useState<Atualizacao[] | null>(null);
  const [carregando, setCarregando] = useState(false);

  const botaoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);

  // Ao montar: só a data mais recente, pra decidir o ponto. Uma coluna de uma
  // linha — a lista inteira só é buscada se a pessoa abrir o painel.
  useEffect(() => {
    let cancelado = false;
    const marcado = leVisto();
    setVisto(marcado);

    createClient()
      .from("atualizacoes")
      .select("publicado_em")
      .order("publicado_em", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelado || !data?.publicado_em) return;
        const ultima = data.publicado_em as string;
        setMaisRecente(ultima);
        // Sem marca nenhuma = primeira visita depois desta feature existir.
        // Não mostra ponto: seria alerta sobre coisa que já era antiga pra
        // pessoa. Só grava a marca e passa a avisar do que vier daqui pra frente.
        if (!marcado) {
          gravaVisto(ultima);
          setVisto(ultima);
        }
      });

    return () => {
      cancelado = true;
    };
  }, []);

  const temNovidade = Boolean(visto && maisRecente && new Date(maisRecente) > new Date(visto));

  const fechar = useCallback(() => {
    setAberto(false);
    // Marcar como lido só no FECHAMENTO (não na abertura): se a pessoa abre
    // sem querer e fecha na hora, ainda perdeu a marca — mas se marcássemos
    // ao abrir, um clique acidental apagaria o aviso antes de ela ter lido
    // qualquer coisa. Fechar é o gesto que significa "terminei aqui".
    const agora = new Date().toISOString();
    gravaVisto(agora);
    setVisto(agora);
    botaoRef.current?.focus();
  }, []);

  function abrir() {
    setAberto(true);
    // Lista buscada uma vez só, na primeira abertura.
    if (entradas === null && !carregando) {
      setCarregando(true);
      createClient()
        .from("atualizacoes")
        .select("id, titulo, descricao, categoria, publicado_em")
        .order("publicado_em", { ascending: false })
        .limit(50)
        .then(({ data, error }) => {
          setEntradas(error ? [] : ((data ?? []) as Atualizacao[]));
          setCarregando(false);
        });
    }
  }

  // Esc fecha, foco vai pro painel ao abrir, e Tab não escapa enquanto ele
  // está aberto — é um diálogo modal, quem navega por teclado não pode ficar
  // tabulando por baixo do scrim sem ver onde está.
  useEffect(() => {
    if (!aberto) return;
    fecharRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        fechar();
        return;
      }
      if (e.key !== "Tab" || !painelRef.current) return;
      const focaveis = painelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    // Trava a rolagem do fundo — sem isso, rolar dentro do painel "vaza" pra
    // página atrás quando a lista chega ao fim.
    const overflowAntes = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = overflowAntes;
    };
  }, [aberto, fechar]);

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        className="relative whitespace-nowrap text-[12.5px] font-semibold text-aurora-muted transition hover:text-aurora-fg"
      >
        Novidades
        {temNovidade && (
          <span
            aria-label="há novidades que você ainda não viu"
            className="absolute -right-[9px] -top-[3px] h-1.5 w-1.5 rounded-full bg-aurora-accent ring-2 ring-aurora-header-bg"
          />
        )}
      </button>

      {aberto && (
        <>
          <div
            onClick={fechar}
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-aurora-fg/35 backdrop-blur-[1.5px]"
          />
          <div
            ref={painelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="novidades-titulo"
            className="fixed right-0 top-0 z-50 flex h-full w-[min(430px,86vw)] flex-col border-l border-aurora-line bg-aurora-surface shadow-[-18px_0_44px_-22px_rgba(15,23,42,0.4)]"
          >
            <div className="flex-none border-b border-aurora-line-soft px-[22px] pb-[15px] pt-[19px]">
              <div className="flex items-start gap-3">
                <div>
                  <h2 id="novidades-titulo" className="text-[16.5px] font-bold tracking-tight text-aurora-fg">
                    Novidades
                  </h2>
                  <p className="mt-1 text-[12.5px] leading-normal text-aurora-muted">
                    O que sua secretária ganhou desde a sua última visita.
                  </p>
                </div>
                <button
                  ref={fecharRef}
                  type="button"
                  onClick={fechar}
                  aria-label="Fechar novidades"
                  className="ml-auto flex h-[29px] w-[29px] flex-none items-center justify-center rounded-lg border border-aurora-line bg-aurora-surface text-[14px] leading-none text-aurora-muted transition hover:bg-aurora-surface-2 hover:text-aurora-fg"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-[22px] pb-[18px] pt-1">
              {carregando && <p className="py-6 text-[13px] text-aurora-muted">Carregando…</p>}

              {!carregando && entradas !== null && entradas.length === 0 && (
                <p className="py-6 text-[13px] text-aurora-muted">Nada por aqui ainda.</p>
              )}

              {!carregando &&
                entradas?.map((e) => {
                  // "novo" por ENTRADA, não só o ponto no botão: saber quais
                  // são novas é o que transforma "existe algo" em "isso aqui
                  // eu ainda não li".
                  const nova = Boolean(visto && new Date(e.publicado_em) > new Date(visto));
                  return (
                    <div
                      key={e.id}
                      className="relative border-b border-aurora-line-soft py-4 last:border-none"
                    >
                      {nova && (
                        <span
                          aria-hidden="true"
                          className="absolute -left-3 top-[23px] h-[5px] w-[5px] rounded-full bg-aurora-accent"
                        />
                      )}
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-bold text-aurora-fg">{e.titulo}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide ${TAG_CLASS[e.categoria]}`}
                        >
                          {TAG_LABEL[e.categoria]}
                        </span>
                        {nova && (
                          <span className="rounded-full bg-aurora-accent/[0.18] px-[7px] py-px text-[9.5px] font-extrabold uppercase tracking-wide text-aurora-accent-text">
                            novo
                          </span>
                        )}
                        <span className="ml-auto font-mono text-[11px] text-aurora-muted">
                          {formataData(e.publicado_em)}
                        </span>
                      </div>
                      <p className="text-[12.8px] leading-relaxed text-aurora-muted">{e.descricao}</p>
                    </div>
                  );
                })}
            </div>

            <div className="flex-none border-t border-aurora-line-soft bg-aurora-surface-2 px-[22px] py-3">
              <a
                href="/novidades"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-aurora-accent-text hover:underline hover:underline-offset-2"
              >
                Ver página completa ↗
              </a>
              <small className="mt-0.5 block text-[11px] text-aurora-muted">
                Abre a versão pública — a que dá pra compartilhar com alguém.
              </small>
            </div>
          </div>
        </>
      )}
    </>
  );
}
