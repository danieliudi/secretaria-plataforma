import Link from "next/link";
import { FeedbackButton } from "@/components/FeedbackButton";
import { Logo } from "@/components/Logo";

// Cabeçalho compartilhado por /app e /admin — mesma marca, mesmo trocador de
// papel. Só quem é `is_platform_owner` vê a aba Administração; pra todo mundo
// mais, /admin nem existe (ver lib/admin-guard.ts), então mostrar o link pra
// quem não tem acesso só levaria a um 404.
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
    <header className="flex items-center gap-4 bg-aurora-header-bg px-8 py-5">
      <Link href="/app">
        <Logo variant="headerApp" />
      </Link>

      {isPlatformOwner && (
        <nav className="flex gap-1 rounded-full border border-aurora-line bg-aurora-surface-2 p-[3px]">
          <Link
            href="/app"
            className={`flex items-center gap-1.5 rounded-full px-4 py-[7px] text-[12.5px] font-semibold transition ${
              active === "app"
                ? "aurora-glow bg-aurora-accent text-aurora-accent-ink"
                : "text-aurora-muted hover:text-aurora-fg"
            }`}
          >
            Minha secretária
          </Link>
          <Link
            href="/admin"
            className={`flex items-center gap-1.5 rounded-full px-4 py-[7px] text-[12.5px] font-semibold transition ${
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

      <div className="ml-auto flex items-center gap-4">
        <FeedbackButton />
        <span className="text-[12.5px] font-semibold text-aurora-muted-2">{userLabel}</span>
      </div>
    </header>
  );
}
