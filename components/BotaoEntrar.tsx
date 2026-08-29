"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Botão do canto do cabeçalho PÚBLICO (landing, /funcionalidades, /novidades,
// /termos, /privacidade).
//
// Por que existe: o botão era "Entrar → /login" fixo em todas as páginas do
// site. Pra quem já está logado isso é simplesmente errado — e pior, era a
// ÚNICA ponte de volta pro produto. Quem clicava em "Termos" ou "Novidades"
// de dentro do app caía numa página de marketing que só oferecia "Entrar", sem
// nenhum caminho de volta a não ser o botão do navegador (achado da revisão de
// navegação de 29/08/2026).
//
// É CLIENTE, não servidor, de propósito: /termos, /privacidade e
// /funcionalidades são pré-renderizadas estaticamente hoje. Checar sessão no
// servidor tornaria as três dinâmicas — cada visitante anônimo passaria a
// pagar uma renderização por causa do rótulo de um botão. Aqui o custo fica
// só em quem tem sessão, e a página segue estática e cacheável.
//
// O estado inicial é o de VISITANTE (a maioria de quem vê estas páginas), pra
// não piscar "Ir pro app" na cara de quem não tem conta. `min-width` fixo
// segura o layout quando o rótulo troca.
export function BotaoEntrar() {
  const [logado, setLogado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelado) setLogado(Boolean(data.user));
      })
      .catch(() => {
        // Falha na checagem degrada pro comportamento de sempre ("Entrar"),
        // que continua correto pra visitante e só custa um clique a mais pra
        // quem tem sessão. Nunca some da tela.
      });
    return () => {
      cancelado = true;
    };
  }, []);

  return (
    <Link
      href={logado ? "/app" : "/login"}
      className="min-w-[88px] rounded-lg border border-aurora-line px-4 py-2 text-center text-[13.5px] font-semibold text-aurora-fg transition hover:border-aurora-accent/50"
    >
      {logado ? "Ir pro app" : "Entrar"}
    </Link>
  );
}
