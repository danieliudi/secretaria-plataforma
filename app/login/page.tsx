"use client";

import { use, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OAUTH_PROVIDERS, enabledOAuthProviders, type OAuthProviderId } from "@/lib/oauth-providers";
import { garanteOrigemCanonica } from "@/lib/site-url";
import { Logo } from "@/components/Logo";

const providers = enabledOAuthProviders();

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Não recebemos a confirmação. Tenta de novo?",
  auth_failed: "Não conseguimos confirmar seu login. Tenta de novo?",
};

type ChecklistItem = { title: string; desc: string; recommended?: boolean };
type ChecklistGroup = { step: number; label: string; items: ChecklistItem[] };

// Checklist do que cada caminho do wizard exige — não é uma cópia do wizard,
// é o que dá pra saber ANTES de logar, pra ninguém começar e travar no meio
// por falta de um token que precisava ter gerado antes. Os dois grupos viram
// uma trilha de 2 decisões (não uma sequência temporal estrita) — o número é
// só pra separar visualmente "isso é uma escolha" de "isso é outra".
const CHECKLIST: ChecklistGroup[] = [
  {
    step: 1,
    label: "Gerenciador de tarefas — escolha 1 na próxima tela",
    items: [
      {
        title: "Google Tasks (recomendado pra começar rápido)",
        desc: "Nada além da conta que você usou pra logar acima — reusa o mesmo login, sem token extra.",
        recommended: true,
      },
      {
        title: "ClickUp",
        desc: "Token pessoal (perfil → Settings → Apps → API Token) e as lists já criadas no ClickUp.",
      },
      {
        title: "Notion",
        desc: "Token de uma integração do Notion (notion.so/my-integrations), com as páginas já conectadas a ela em \"Connections\".",
      },
      {
        title: "Trello",
        desc: "Token pessoal — peça pra quem te convidou o link de autorização pronto (usa a API key da plataforma).",
      },
    ],
  },
  {
    step: 2,
    label: "Canal de conversa — escolha 1 ou os dois",
    items: [
      {
        title: "Telegram (recomendado pra testar — grátis e na hora)",
        desc: "Só precisa ter o Telegram instalado; o bot é criado no próprio wizard, em poucos passos.",
        recommended: true,
      },
      {
        title: "WhatsApp",
        desc: "Grátis — todo mundo conversa pelo mesmo número da plataforma. Você vincula o seu com um código de 6 letras, sem token nem configuração manual.",
      },
    ],
  },
];

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="10" height="7" viewBox="0 0 10 7" fill="none" aria-hidden="true">
      <path d="M1 1.2L5 5.5L9 1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
    // Host errado (permalink de deploy da Netlify, por exemplo): move o
    // navegador pro host canônico ANTES de começar o fluxo, senão o cookie do
    // code verifier do PKCE nasce aqui e o `code` volta lá — ver lib/site-url.ts.
    // A navegação já começou; sair daqui sem tocar em mais nada.
    if (garanteOrigemCanonica("/login")) return;

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
    <main className="aurora-bg flex min-h-screen items-center justify-center px-8 py-16 md:px-20">
      <div className="flex w-full max-w-md flex-col items-start gap-6 text-left">
        <Logo variant="header" />
        <h1 className="text-balance text-[32px] font-semibold leading-[1.2] tracking-tight text-aurora-fg">
          Sua secretária, em minutos
        </h1>
        <p className="max-w-sm text-[15px] leading-relaxed text-aurora-muted">
          Entre com sua conta {providers.map((p) => p.label).join(" ou ")} pra
          conectar agenda, e-mail e tarefas, sem precisar mexer em nada
          técnico. Você configura o resto na próxima tela.
        </p>
        {errorParam && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {ERROR_MESSAGES[errorParam] ?? "Algo deu errado. Tenta de novo?"}
          </p>
        )}
        <div className="mt-1 flex w-full flex-col gap-3">
          {providers.map((cfg) => (
            <button
              key={cfg.id}
              onClick={() => handleLogin(cfg.id)}
              disabled={loadingProvider !== null}
              className="inline-flex items-center justify-center gap-2.5 rounded-lg bg-aurora-fg px-5 py-3.5 text-[14.5px] font-semibold text-aurora-bg transition active:scale-[0.98] disabled:opacity-60"
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-aurora-bg text-[10px] font-bold text-aurora-fg">
                {cfg.id === "google" ? "G" : "O"}
              </span>
              {loadingProvider === cfg.id ? "Redirecionando…" : `Entrar com ${cfg.label}`}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-aurora-muted-2">Leva menos de 3 minutos.</p>

        <div className="w-full aurora-card rounded-2xl border border-aurora-line bg-aurora-surface px-[18px] pb-2 pt-[18px]">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-aurora-muted-2">
            O que você vai precisar antes de começar
          </p>
          <ol className="m-0 list-none p-0">
            {CHECKLIST.map((group, gi) => (
              <li key={group.step} className={`relative flex gap-3.5 ${gi === CHECKLIST.length - 1 ? "pb-2" : "pb-[22px]"}`}>
                {gi < CHECKLIST.length - 1 && (
                  <span aria-hidden="true" className="absolute left-[12.5px] top-[13px] bottom-[-9px] w-px bg-aurora-line" />
                )}
                <span className="relative z-[1] flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border border-aurora-accent/45 bg-aurora-accent/[0.14] text-[12px] font-bold text-aurora-accent-text shadow-[0_0_0_4px_rgba(139,92,246,0.07)]">
                  {group.step}
                </span>
                <div className="min-w-0 flex-1 pt-[3px]">
                  <p className="mb-1.5 text-[13px] font-semibold text-aurora-fg">{group.label}</p>
                  <div>
                    {group.items.map((item) => (
                      <details
                        key={item.title}
                        open={item.recommended}
                        className="group border-b border-aurora-line-soft last:border-none"
                      >
                        <summary className="cursor-pointer list-none py-[9px] outline-none [&::-webkit-details-marker]:hidden">
                          <div className="flex items-center justify-between gap-2.5">
                            <span
                              className={`min-w-0 text-[13.5px] font-semibold ${
                                item.recommended ? "text-aurora-fg" : "text-aurora-muted"
                              }`}
                            >
                              {item.title}
                            </span>
                            <span className="flex flex-none items-center gap-2">
                              {item.recommended && (
                                <span className="rounded-full border border-aurora-accent/35 bg-aurora-accent/[0.15] px-2 py-0.5 text-[10.5px] font-semibold text-aurora-accent-text">
                                  recomendado
                                </span>
                              )}
                              <ChevronIcon className="flex-none text-aurora-muted-2 transition-transform group-open:rotate-180" />
                            </span>
                          </div>
                        </summary>
                        <p
                          className={`mt-0.5 pb-2.5 text-[12.5px] leading-relaxed ${
                            item.recommended ? "text-aurora-fg/85" : "text-aurora-muted"
                          }`}
                        >
                          {item.desc}
                        </p>
                      </details>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </main>
  );
}
