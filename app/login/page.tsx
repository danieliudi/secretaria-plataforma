"use client";

import { use, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OAUTH_PROVIDERS, enabledOAuthProviders, type OAuthProviderId } from "@/lib/oauth-providers";

const providers = enabledOAuthProviders();

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Não recebemos a confirmação. Tenta de novo?",
  auth_failed: "Não conseguimos confirmar seu login. Tenta de novo?",
};

type ChecklistItem = { title: string; desc: string };
type ChecklistGroup = { label: string; items: ChecklistItem[] };

// Checklist do que cada caminho do wizard exige — não é uma cópia do wizard,
// é o que dá pra saber ANTES de logar, pra ninguém começar e travar no meio
// por falta de um token que precisava ter gerado antes.
const CHECKLIST: ChecklistGroup[] = [
  {
    label: "Gerenciador de tarefas — escolha 1 na próxima tela",
    items: [
      {
        title: "Google Tasks (recomendado pra começar rápido)",
        desc: "Nada além da conta que você usou pra logar acima — reusa o mesmo login, sem token extra.",
      },
      {
        title: "ClickUp",
        desc: "Token pessoal (perfil → Settings → Apps → API Token) e as lists já criadas no ClickUp.",
      },
      {
        title: "Notion",
        desc: "Token de uma integração interna (notion.so/my-integrations) com os databases já compartilhados com ela.",
      },
      {
        title: "Trello",
        desc: "Token pessoal — peça pra quem te convidou o link de autorização pronto (usa a API key da plataforma).",
      },
    ],
  },
  {
    label: "Canal de conversa — escolha 1 ou os dois",
    items: [
      {
        title: "Telegram (recomendado pra testar — grátis e na hora)",
        desc: "Só precisa ter o Telegram instalado; o bot é criado no próprio wizard, em poucos passos.",
      },
      {
        title: "WhatsApp",
        desc: "Tem custo mensal de número dedicado; a configuração é feita manualmente depois, por quem administra a plataforma.",
      },
    ],
  },
];

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
          SINCRONIZANDO · AGENDA · E-MAIL · TAREFAS
        </span>
        <h1 className="text-balance bg-gradient-to-br from-foreground to-violet bg-clip-text font-display text-4xl font-extrabold leading-[1.12] tracking-tight text-transparent">
          Sua secretária, em minutos
        </h1>
        <p className="max-w-sm text-[15px] leading-relaxed text-muted">
          Entre com sua conta {providers.map((p) => p.label).join(" ou ")} pra
          conectar agenda, e-mail e tarefas, sem precisar mexer em nada
          técnico. Você configura o resto na próxima tela.
        </p>
        {errorParam && (
          <p className="rounded-lg border border-red-900/40 bg-red-950/40 px-4 py-2 text-sm text-red-300">
            {ERROR_MESSAGES[errorParam] ?? "Algo deu errado. Tenta de novo?"}
          </p>
        )}
        <div className="mt-2 flex flex-col gap-3">
          {providers.map((cfg) => (
            <button
              key={cfg.id}
              onClick={() => handleLogin(cfg.id)}
              disabled={loadingProvider !== null}
              className="inline-flex items-center gap-2.5 rounded-lg border border-line bg-surface px-5 py-3 text-[14.5px] font-medium text-foreground transition hover:border-cyan active:scale-[0.98] disabled:opacity-60"
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-cyan font-mono text-[10px] text-cyan">
                {cfg.id === "google" ? "G" : "O"}
              </span>
              {loadingProvider === cfg.id ? "Redirecionando…" : `Entrar com ${cfg.label}`}
            </button>
          ))}
        </div>
        <details className="w-full rounded-lg border border-line bg-surface/60 px-4 py-3 text-muted">
          <summary className="cursor-pointer font-mono text-[11px] tracking-wide text-cyan">
            O QUE VOCÊ VAI PRECISAR ANTES DE COMEÇAR
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {CHECKLIST.map((group) => (
              <div key={group.label} className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-2">
                  {group.label}
                </span>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <li key={item.title} className="text-[13px] leading-relaxed">
                      <span className="font-medium text-foreground">{item.title}</span>
                      {" — "}
                      {item.desc}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </div>
    </main>
  );
}
