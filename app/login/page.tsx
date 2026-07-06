"use client";

import { use, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Escopos pedidos JÁ no login: além de identidade, Calendar/Gmail/Tasks — uma
// tela só resolve login + as integrações. access_type=offline + prompt=consent
// garantem que o Google devolva um refresh_token (senão só vem access_token,
// que expira em ~1h e não serve pro /fast operar depois).
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Não recebemos a confirmação do Google. Tenta de novo?",
  auth_failed: "Não conseguimos confirmar seu login. Tenta de novo?",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // `use()` numa Promise em Client Component — suporte oficial desta versão
  // do Next pra ler searchParams sem precisar de Server Component por cima.
  const { error: errorParam } = use(searchParams);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: GOOGLE_SCOPES,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      setLoading(false);
      console.error("[login] signInWithOAuth falhou:", error.message);
    }
    // Sucesso: o navegador é redirecionado pro Google, não há mais o que fazer aqui.
  }

  return (
    <main className="relative flex min-h-screen items-center overflow-hidden px-8 py-16 md:px-20">
      <div
        className="signal-rings"
        style={{ width: 900, height: 900, right: "-24%", top: "50%", transform: "translateY(-50%)" }}
        aria-hidden="true"
      />
      <div
        className="signal-sweep"
        style={{ width: 900, height: 900, right: "-24%", top: "50%", transform: "translateY(-50%)" }}
        aria-hidden="true"
      />
      <div className="relative z-10 flex max-w-md flex-col items-start gap-5 text-left">
        <span className="inline-flex items-center gap-2 rounded border border-line px-2.5 py-1.5 font-mono text-[11px] tracking-wide text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_8px_1px_rgba(94,234,212,0.7)]" />
          SINCRONIZANDO · AGENDA · GMAIL · TAREFAS
        </span>
        <h1 className="text-balance bg-gradient-to-br from-foreground to-violet bg-clip-text font-display text-4xl font-extrabold leading-[1.12] tracking-tight text-transparent">
          Sua secretária, em minutos
        </h1>
        <p className="max-w-sm text-[15px] leading-relaxed text-muted">
          Entre com sua conta Google pra conectar agenda, email e tarefas — sem
          precisar mexer em nada técnico. Você configura o resto na próxima tela.
        </p>
        {errorParam && (
          <p className="rounded-lg border border-red-900/40 bg-red-950/40 px-4 py-2 text-sm text-red-300">
            {ERROR_MESSAGES[errorParam] ?? "Algo deu errado. Tenta de novo?"}
          </p>
        )}
        <button
          onClick={handleLogin}
          disabled={loading}
          className="mt-2 inline-flex items-center gap-2.5 rounded-lg border border-line bg-surface px-5 py-3 text-[14.5px] font-medium text-foreground transition hover:border-cyan active:scale-[0.98] disabled:opacity-60"
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-cyan font-mono text-[10px] text-cyan">
            G
          </span>
          {loading ? "Redirecionando…" : "Entrar com Google"}
        </button>
      </div>
    </main>
  );
}
