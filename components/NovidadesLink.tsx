"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// "Novidades" no cabeçalho da área logada, com ponto dourado quando há
// entrada de changelog publicada depois da última visita (mockup de
// 27/08/2026, aprovado).
//
// Existe por um motivo concreto: a auditoria mostrou que /novidades só era
// alcançável pela landing — quem estava logado nunca via que a plataforma
// tinha mudado. O ponto é o que transforma "existe uma página" em "eu soube
// que mudou".
//
// A leitura é do CLIENTE, na tabela pública `atualizacoes` (mesma que a
// página usa, RLS de leitura pública) em vez de descer por prop: o cabeçalho
// é montado em 3 lugares e nenhum deles já buscava isso. É uma query só,
// de uma coluna, e falha em silêncio — sem ponto, nunca com erro na tela.
//
// O "já vi" mora em localStorage, não no banco: é conveniência por
// navegador, não estado de negócio. Perder isso (aba anônima, limpar dados)
// só faz o ponto reaparecer uma vez.
const CHAVE = "mia:novidades-visto-em";

export function NovidadesLink() {
  const [temNovidade, setTemNovidade] = useState(false);

  useEffect(() => {
    let cancelado = false;

    createClient()
      .from("atualizacoes")
      .select("publicado_em")
      .order("publicado_em", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelado || !data?.publicado_em) return;
        let visto: string | null = null;
        try {
          visto = window.localStorage.getItem(CHAVE);
        } catch {
          // Modo privado / storage bloqueado: trata como "nunca viu" e mostra
          // o ponto. Melhor avisar demais que esconder o que mudou.
        }
        // Sem marca nenhuma = primeira visita depois desta feature existir.
        // Não mostra ponto: seria um alerta sobre coisa que já era antiga
        // pra pessoa. Só grava a marca e passa a avisar do que vier daqui
        // pra frente.
        if (!visto) {
          try {
            window.localStorage.setItem(CHAVE, data.publicado_em as string);
          } catch {
            /* sem storage, sem marca — o ponto simplesmente não aparece */
          }
          return;
        }
        if (new Date(data.publicado_em as string) > new Date(visto)) {
          setTemNovidade(true);
        }
      });

    return () => {
      cancelado = true;
    };
  }, []);

  function marcaComoVisto() {
    setTemNovidade(false);
    try {
      window.localStorage.setItem(CHAVE, new Date().toISOString());
    } catch {
      /* best-effort */
    }
  }

  // Aba nova pelo mesmo motivo dos Termos (ver AccountMenu.tsx): /novidades é
  // página do SITE — cabeçalho público, sem volta pro app. Abrindo fora, o
  // changelog não custa a sessão de trabalho de ninguém.
  //
  // Anotado como próximo passo: dar ao changelog uma versão DENTRO do app
  // (mesmo conteúdo da tabela `atualizacoes`, no cabeçalho do produto). É o
  // item de navegação que os usuários mais vão abrir, e abrir fora é a
  // solução simples, não a melhor.
  return (
    <a
      href="/novidades"
      target="_blank"
      rel="noopener noreferrer"
      onClick={marcaComoVisto}
      className="relative whitespace-nowrap text-[12.5px] font-semibold text-aurora-muted transition hover:text-aurora-fg"
    >
      Novidades
      {temNovidade && (
        <span
          aria-label="há novidades que você ainda não viu"
          className="absolute -right-[9px] -top-[3px] h-1.5 w-1.5 rounded-full bg-aurora-accent ring-2 ring-aurora-header-bg"
        />
      )}
    </a>
  );
}
