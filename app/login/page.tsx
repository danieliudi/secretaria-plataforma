"use client";

import { use, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OAUTH_PROVIDERS, enabledOAuthProviders, type OAuthProviderId } from "@/lib/oauth-providers";

const providers = enabledOAuthProviders();

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Não recebemos a confirmação. Tenta de novo?",
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
  const [loadingProvider, setLoadingProvider] = useState<OAuthProviderId | null>(null);

  async function handleLogin(provider: OAuthProviderId) {
    setLoadingProvider(provider);
    const supabase = createClient();
    const cfg = OAUTH_PROVIDERS[provider];
    const redirectTo = `${window.location.origin}/auth/callback?provider=${provider}&intent=login`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        scopes: cfg.scopes,
        queryParams: cfg.queryParams,
      },
    });
    if (error) {
      setLoadingProvider(null);
      console.error("[login] signInWithOAuth falhou:", error.message);
    }
    // Sucesso: o navegador é redirecionado pro provider, não há mais o que fazer aqui.
  }

  return (
    <main className="flex min-h-screen items-center px-8 py-16 md:px-20">
      <div className="flex w-full max-w-md flex-col items-start gap-6 text-left">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm bg-cyan" />
          <span className="text-[13.5px] font-bold tracking-tight text-foreground">sinal</span>
        </div>
        <h1 className="text-balance text-[32px] font-semibold leading-[1.2] tracking-tight text-foreground">
          Sua secretária, em minutos
        </h1>
        <p className="max-w-sm text-[15px] leading-relaxed text-muted">
          Entre com sua conta {providers.map((p) => p.label).join(" ou ")} pra
          conectar agenda, e-mail e tarefas, sem precisar mexer em nada
          técnico. Você configura o resto na próxima tela.
        </p>
        {errorParam && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {ERROR_MESSAGES[errorParam] ?? "Algo deu errado. Tenta de novo?"}
          </p>
        )}
        <div className="mt-1 flex w-full flex-col gap-3">
          {providers.map((cfg) => (
            <button
              key={cfg.id}
              onClick={() => handleLogin(cfg.id)}
              disabled={loadingProvider !== null}
              className="inline-flex items-center justify-center gap-2.5 rounded-lg bg-foreground px-5 py-3.5 text-[14.5px] font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-background text-[10px] font-bold text-foreground">
                {cfg.id === "google" ? "G" : "O"}
              </span>
              {loadingProvider === cfg.id ? "Redirecionando…" : `Entrar com ${cfg.label}`}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-muted-2">Leva menos de 3 minutos.</p>
      </div>
    </main>
  );
}
