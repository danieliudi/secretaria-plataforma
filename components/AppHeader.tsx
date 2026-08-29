import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { FeedbackButton } from "@/components/FeedbackButton";
import { LogoLockup } from "@/components/Logo";
import { NovidadesPainel } from "@/components/NovidadesPainel";

// Cabeçalho compartilhado por /app, /admin e /onboarding.
//
// Redesenho de 27/08/2026 (mockup aprovado pelo Daniel). O que mudou e por quê:
//
//  - MARCA: lockup "variante B" a 40px (símbolo recortado + filete + tagline).
//    Antes era o símbolo original a 19px com "Mia" ao lado — a margem embutida
//    no PNG fazia o desenho sumir ao lado do menu. Ver Logo.tsx.
//
//  - NOVIDADES e MENU DA CONTA: entram porque uma auditoria de produção achou
//    que a área logada não tinha navegação NENHUMA além das duas abas — nem
//    para /novidades, /funcionalidades, /precos, /termos, /privacidade, nem
//    para SAIR DA CONTA (que só existia dentro do wizard). O nome no canto era
//    texto morto; virou o botão que abre esse menu.
//
//  - Só quem é `is_platform_owner` vê a aba Administração; pra todo mundo mais
//    /admin nem existe (ver lib/admin-guard.ts), então mostrar o link levaria a
//    um 404. Mas quem NÃO é dono passa a ter cabeçalho útil mesmo assim: antes
//    via só a marca e o feedback, sem nenhum caminho pra lugar nenhum.
export function AppHeader({
  active,
  isPlatformOwner,
  pendentes,
  userLabel,
}: {
  active: "app" | "admin";
  isPlatformOwner: boolean;
  pendentes: number;
  userLabel: string;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 bg-aurora-header-bg px-5 py-4 sm:px-8 sm:py-5">
      <Link href="/app" aria-label="Ir para Minha secretária">
        {/* Celular: só o símbolo a 32px — a tagline custaria ~120px de largura
            e empurraria "Novidades" pra fora da barra. Ver Logo.tsx. */}
        <span className="sm:hidden">
          <LogoLockup alturaSimbolo={32} mostrarTagline={false} />
        </span>
        <span className="hidden sm:inline-flex">
          <LogoLockup alturaSimbolo={40} />
        </span>
      </Link>

      {isPlatformOwner && (
        <nav className="order-last flex w-full gap-1 rounded-full border border-aurora-line bg-aurora-surface-2 p-[3px] sm:order-none sm:w-auto">
          <Link
            href="/app"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-[7px] text-[12.5px] font-semibold transition sm:flex-none ${
              active === "app"
                ? "aurora-glow bg-aurora-accent text-aurora-accent-ink"
                : "text-aurora-muted hover:text-aurora-fg"
            }`}
          >
            Minha secretária
          </Link>
          <Link
            href="/admin"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-[7px] text-[12.5px] font-semibold transition sm:flex-none ${
              active === "admin"
                ? "aurora-glow bg-aurora-accent text-aurora-accent-ink"
                : "text-aurora-muted hover:text-aurora-fg"
            }`}
          >
            Administração
            {pendentes > 0 && (
              <span className="rounded-full bg-aurora-bg px-[7px] py-px text-[10.5px] font-bold leading-normal text-aurora-fg">
                {pendentes}
              </span>
            )}
          </Link>
        </nav>
      )}

      <div className="ml-auto flex items-center gap-3 sm:gap-[18px]">
        <NovidadesPainel />
        <FeedbackButton />
        <span aria-hidden="true" className="hidden h-5 w-px bg-aurora-line sm:block" />
        <AccountMenu userLabel={userLabel} />
      </div>
    </header>
  );
}
