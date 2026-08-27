"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Menu da conta no cabeçalho da área logada (mockup de 27/08/2026, aprovado).
//
// Nasceu pra resolver um buraco real achado na auditoria de produção: depois
// do login, o nome no canto era TEXTO MORTO e não havia como sair da conta —
// `signOut` só existia dentro do wizard de onboarding, alcançável por links
// soltos do painel. Junto com o Sair vieram as páginas que existiam mas não
// tinham link nenhum de dentro do app (/funcionalidades, /precos, /termos,
// /privacidade, /onboarding).
//
// O e-mail é lido no cliente em vez de descer por prop: o cabeçalho é
// montado em 3 lugares (app, admin, onboarding) e só um deles já tinha o
// e-mail em mãos — plumbing nos outros dois só pra isso não se paga. Falha na
// leitura degrada pro nome sozinho, nunca quebra o menu.
const ITENS = [
  { href: "/onboarding", label: "Configurar minha secretária", icone: "⚙" },
  { href: "/funcionalidades", label: "Funcionalidades", icone: "✦" },
] as const;

// "Meu plano" do mockup NÃO entra pra todo mundo, e o rótulo mudou — os dois
// por causa do que /precos realmente é hoje: prévia interna de uma página não
// lançada, com `notFound()` deliberado pra quem não é dono (mesmo padrão do
// /admin), preços ilustrativos e modelo de cobrança ainda não decidido.
// Linkar pra todos daria 404 no cliente; tirar o guard publicaria preço
// não-final — decisão de produto, não ajuste de navegação. Então: só o dono
// vê, e com nome honesto ("prévia"), já que não existe plano nem cobrança
// rodando pra chamar de "meu plano".
const ITEM_PRECOS = { href: "/precos", label: "Preços (prévia)", icone: "◈" } as const;

export function AccountMenu({
  userLabel,
  isPlatformOwner = false,
}: {
  userLabel: string;
  isPlatformOwner?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelado) setEmail(data.user?.email ?? null);
      })
      .catch(() => {
        /* best-effort — sem e-mail o menu mostra só o nome */
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Fecha ao clicar fora ou apertar Esc. Sem isso o menu fica preso aberto no
  // celular, onde não existe "clicar em outro lugar" tão óbvio quanto no desktop.
  useEffect(() => {
    if (!aberto) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  async function sair() {
    setSaindo(true);
    try {
      await createClient().auth.signOut();
    } finally {
      // Redirect "duro" (não router.push) — mesmo motivo do wizard: precisa
      // recarregar do zero pra limpar estado de servidor da sessão antiga.
      window.location.href = "/login";
    }
  }

  const iniciais =
    userLabel
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0] ?? "")
      .join("")
      .toUpperCase() || "?";

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-[12.5px] font-semibold text-aurora-muted-2 transition hover:bg-aurora-surface-2"
      >
        <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-aurora-accent text-[11px] font-extrabold text-aurora-accent-ink">
          {iniciais}
        </span>
        <span className="max-w-[120px] truncate">{userLabel}</span>
        <span aria-hidden="true" className="text-[9px] leading-none text-aurora-muted">
          ▼
        </span>
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[244px] rounded-[11px] border border-aurora-line bg-aurora-surface p-1.5 shadow-[0_14px_34px_rgba(15,23,42,0.14),0_2px_8px_rgba(15,23,42,0.06)]"
        >
          <div className="mb-1.5 border-b border-aurora-line-soft px-[11px] pb-2.5 pt-2">
            <p className="text-[13px] font-bold leading-tight text-aurora-fg">{userLabel}</p>
            {email && <p className="mt-0.5 truncate text-[11.5px] text-aurora-muted">{email}</p>}
          </div>

          {[...ITENS, ...(isPlatformOwner ? [ITEM_PRECOS] : [])].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setAberto(false)}
              className="flex items-center gap-[9px] rounded-[7px] px-[11px] py-2 text-[12.5px] font-semibold text-aurora-muted-2 transition hover:bg-aurora-surface-2"
            >
              <span aria-hidden="true" className="w-3.5 flex-shrink-0 text-center text-[12px] opacity-70">
                {item.icone}
              </span>
              {item.label}
            </Link>
          ))}

          <div className="mx-[7px] my-1.5 h-px bg-aurora-line-soft" />

          <Link
            href="/termos"
            role="menuitem"
            onClick={() => setAberto(false)}
            className="flex items-center gap-[9px] rounded-[7px] px-[11px] py-2 text-[12.5px] font-semibold text-aurora-muted-2 transition hover:bg-aurora-surface-2"
          >
            <span aria-hidden="true" className="w-3.5 flex-shrink-0 text-center text-[12px] opacity-70">
              §
            </span>
            Termos e privacidade
          </Link>

          <div className="mx-[7px] my-1.5 h-px bg-aurora-line-soft" />

          <button
            type="button"
            role="menuitem"
            onClick={sair}
            disabled={saindo}
            className="flex w-full items-center gap-[9px] rounded-[7px] px-[11px] py-2 text-left text-[12.5px] font-semibold text-red-700 transition hover:bg-aurora-surface-2 disabled:opacity-60"
          >
            <span aria-hidden="true" className="w-3.5 flex-shrink-0 text-center text-[12px] opacity-70">
              →
            </span>
            {saindo ? "Saindo…" : "Sair da conta"}
          </button>
        </div>
      )}
    </div>
  );
}
