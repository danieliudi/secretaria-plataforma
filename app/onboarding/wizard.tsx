"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OAUTH_PROVIDERS, enabledOAuthProviders, type OAuthProviderId } from "@/lib/oauth-providers";

type Provider = "clickup" | "notion" | "trello" | "google_tasks";
type Channel = "whatsapp" | "telegram" | "both";
type RemoteList = { id: string; name: string; path: string };

const PROVIDER_OPTIONS: Array<{
  value: Provider;
  label: string;
  hint: string;
  placeholder: string;
  tokenSteps: string[] | null;
  helpLink: { href: string; label: string } | null;
  mapHint: string;
  /** Como buscar as listas reais: "flat" (frente → id), "nested" (frente → {nome: id}), ou "manual" (sem busca, cola o JSON). */
  pickerKind: "flat" | "nested" | "manual";
}> = [
  {
    value: "google_tasks",
    label: "Google Tasks",
    hint: "Grátis e já pronto — reusa o login que você acabou de fazer, sem token extra. Recomendado se você não usa nenhuma das outras plataformas ainda.",
    placeholder: '{"pessoal": "IDdaSuaListaAqui"}',
    tokenSteps: null,
    helpLink: null,
    mapHint: "Escolha pra cada frente qual lista do Google Tasks ela usa.",
    pickerKind: "flat",
  },
  {
    value: "clickup",
    label: "ClickUp",
    hint: "Cole seu token pessoal (app.clickup.com/settings/apps) e o mapa de frente → lists.",
    placeholder: '{"resibag": {"Pauta & Reuniões": "901700000000"}}',
    tokenSteps: [
      "Entra na sua conta do ClickUp pelo navegador.",
      "Clica no seu avatar (canto superior direito) → Settings.",
      "No menu da esquerda, desce até \"Apps\".",
      "Em \"API Token\", clica em \"Generate\" (ou \"Regenerate\" se já tiver um).",
      "Copia o token gerado e cola no campo acima.",
    ],
    helpLink: {
      href: "https://help.clickup.com/hc/en-us/articles/6303422883095-Create-your-own-app-with-the-ClickUp-API",
      label: "Guia oficial do ClickUp (com imagens)",
    },
    mapHint: "Depois de colar o token, clica em buscar e escolhe a lista de cada frente pelo nome.",
    pickerKind: "nested",
  },
  {
    value: "notion",
    label: "Notion",
    hint: "Token de uma integração interna (notion.so/my-integrations) — compartilhe cada database com ela antes.",
    placeholder: '{"resibag": "databaseIdAqui"}',
    tokenSteps: [
      "Acessa notion.so/my-integrations (logado com a conta certa).",
      "Clica em \"+ New integration\".",
      "Dá um nome, escolhe o workspace e o tipo \"Internal\".",
      "Depois de criada, clica em \"Show\" no token e copia (começa com \"secret_\" ou \"ntn_\").",
      "Importante: isso sozinho não dá acesso a nada — abre cada database que a secretária vai usar, clica nos \"...\" no canto superior direito → \"Connections\" → \"Connect to\" → escolhe a integração que você acabou de criar.",
    ],
    helpLink: {
      href: "https://www.notion.com/help/create-integrations-with-the-notion-api",
      label: "Guia oficial do Notion (com imagens)",
    },
    mapHint: "Depois de colar o token e compartilhar os databases com a integração, clica em buscar.",
    pickerKind: "flat",
  },
  {
    value: "trello",
    label: "Trello",
    hint: "Token de acesso pessoal. (A API key do app fica combinada por enquanto — se precisar, fale com quem administra a plataforma.)",
    placeholder: '{"resibag": {"A Fazer": "60a1b2c3d4e5f6"}}',
    tokenSteps: [
      "Quem administra a plataforma já tem uma chave de API do Trello configurada — você não precisa criar uma.",
      "Peça pra essa pessoa o link de autorização pronto (usa a chave dela). Ao abrir e clicar em \"Allow\", o Trello mostra seu token pessoal.",
      "Se você já tiver uma API key própria do Trello, também pode gerar por conta própria — veja o guia oficial abaixo.",
    ],
    helpLink: {
      href: "https://support.atlassian.com/trello/docs/getting-started-with-trello-rest-api/",
      label: "Guia oficial do Trello (com imagens)",
    },
    mapHint: "Depois de colar o token, clica em buscar e escolhe a lista de cada frente pelo nome.",
    pickerKind: "nested",
  },
];

const CHANNEL_OPTIONS: Array<{
  value: Channel;
  label: string;
  hint: string;
  cost: string | null;
  setup: string;
  recommended?: boolean;
}> = [
  {
    value: "whatsapp",
    label: "WhatsApp",
    hint: "Você já usa no dia a dia — ninguém precisa aprender um app novo.",
    cost: "Tem custo mensal por um número dedicado só pra secretária — no caso mais simples (número virtual, como a Salvy), fica em torno de R$ 29,90/mês. Também dá pra usar um chip físico só pra isso; o valor varia.",
    setup: "A configuração é feita manualmente por quem administra a plataforma depois que você concluir esse passo — você recebe uma mensagem com os próximos passos.",
    recommended: true,
  },
  {
    value: "telegram",
    label: "Telegram",
    hint: "Grátis, e você mesmo consegue criar o bot agora — sem esperar ninguém configurar nada.",
    cost: null,
    setup: "Você cria seu próprio bot em poucos passos e cola o token abaixo.",
  },
  {
    value: "both",
    label: "Os dois",
    hint: "WhatsApp pro dia a dia, Telegram como alternativa gratuita ou pra não misturar com o número pessoal.",
    cost: "A parte do WhatsApp tem custo mensal por um número dedicado — em torno de R$ 29,90/mês no caso mais simples (número virtual, como a Salvy), podendo variar com um chip físico. O Telegram continua grátis.",
    setup: "O Telegram você configura agora (token abaixo); o WhatsApp é configurado manualmente depois.",
  },
];

const LINK_ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Não recebemos a confirmação — tenta de novo?",
  auth_failed: "Não conseguimos confirmar essa conexão — tenta de novo?",
};

const TELEGRAM_BOT_STEPS = [
  "Abre o Telegram e procura por \"@BotFather\" (o bot oficial que cria outros bots).",
  "Manda o comando /newbot e segue as perguntas (nome e um @usuario terminado em \"bot\").",
  "O BotFather te devolve um token — algo como \"123456:ABC-DEF...\".",
  "Copia esse token e cola no campo abaixo.",
];

type Step = 1 | 2 | 3 | 4;

export default function OnboardingWizard(props: {
  slug: string;
  email: string;
  initialNome: string;
  initialCargo: string;
  initialFrentes: string;
  initialProvider: Provider;
  googleConnected: boolean;
  outlookConnected: boolean;
  linkError: string | null;
  initialChannelPreference: Channel | null;
  telegramConnected: boolean;
  trelloApiKeyConfigured: boolean;
}) {
  const [step, setStep] = useState<Step>(1);
  const [nome, setNome] = useState(props.initialNome);
  const [cargo, setCargo] = useState(props.initialCargo);
  const [frentes, setFrentes] = useState(props.initialFrentes);
  const [provider, setProvider] = useState<Provider>(props.initialProvider);
  const [token, setToken] = useState("");
  const [trelloApiKey, setTrelloApiKey] = useState("");
  const [listMap, setListMap] = useState("");
  const [remoteLists, setRemoteLists] = useState<RemoteList[] | null>(null);
  const [remoteListsLoading, setRemoteListsLoading] = useState(false);
  const [remoteListsError, setRemoteListsError] = useState<string | null>(null);
  const [frenteListMap, setFrenteListMap] = useState<Record<string, string>>({});
  const [channel, setChannel] = useState<Channel | null>(props.initialChannelPreference);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramWebhookStatus, setTelegramWebhookStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<OAuthProviderId | null>(null);
  const [showAdvancedProviders, setShowAdvancedProviders] = useState(props.initialProvider !== "google_tasks");

  const providerInfo = PROVIDER_OPTIONS.find((p) => p.value === provider)!;
  const channelInfo = CHANNEL_OPTIONS.find((c) => c.value === channel) ?? null;
  const wantsTelegram = channel === "telegram" || channel === "both";
  const wantsWhatsapp = channel === "whatsapp" || channel === "both";
  const frentesArr = frentes.split(",").map((f) => f.trim()).filter(Boolean);

  // Reseta a busca de listas sempre que troca de plataforma — a busca anterior
  // não vale mais. Ajuste de estado durante o render (em vez de useEffect) é o
  // padrão recomendado pra "resetar estado quando uma prop muda" — evita o
  // reflow extra de resetar depois do commit.
  const prevProviderRef = useRef(provider);
  if (prevProviderRef.current !== provider) {
    prevProviderRef.current = provider;
    setRemoteLists(null);
    setRemoteListsError(null);
    setFrenteListMap({});
  }

  // Pro Google Tasks já busca na hora, porque não depende de token (reusa o
  // login que já aconteceu) — isso é uma chamada de rede, então fica num efeito.
  useEffect(() => {
    if (provider === "google_tasks") {
      loadRemoteLists();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  async function loadRemoteLists() {
    setRemoteListsLoading(true);
    setRemoteListsError(null);
    try {
      const endpoints: Record<Exclude<Provider, "google_tasks">, string> = {
        clickup: "clickup-lists",
        notion: "notion-databases",
        trello: "trello-lists",
      };
      const res = provider === "google_tasks"
        ? await fetch("/api/onboarding/google-tasks-lists")
        : await fetch(`/api/onboarding/${endpoints[provider]}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              provider === "trello" ? { token, apiKey: trelloApiKey } : { token },
            ),
          });
      const data = await res.json();
      if (!res.ok) {
        setRemoteListsError(data.error ?? "Não conseguimos buscar suas listas.");
        return;
      }
      setRemoteLists(data.lists);
    } catch {
      setRemoteListsError("Falha de conexão ao buscar listas.");
    } finally {
      setRemoteListsLoading(false);
    }
  }

  async function submitJson(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Algo deu errado — tenta de novo?");
        return null;
      }
      return data;
    } catch {
      setError("Falha de conexão — tenta de novo?");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Redirect "duro" (não router.push) — precisa recarregar do zero pra
    // limpar qualquer estado de servidor que dependa da sessão antiga.
    window.location.href = "/login";
  }

  async function handleConnectProvider(provider: OAuthProviderId) {
    setConnectingProvider(provider);
    const supabase = createClient();
    const cfg = OAUTH_PROVIDERS[provider];
    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?provider=${provider}&intent=link`,
        scopes: cfg.scopes,
        queryParams: cfg.queryParams,
      },
    });
    if (error) {
      setConnectingProvider(null);
      setError("Não conseguimos iniciar a conexão — tenta de novo?");
    }
    // Sucesso: navegador é redirecionado pro provider, nada mais a fazer aqui.
  }

  async function handlePersonaSubmit() {
    const frentesArrTrim = frentes.split(",").map((f) => f.trim()).filter(Boolean);
    const result = await submitJson("/api/onboarding/persona", { nome, cargo, frentes: frentesArrTrim });
    if (result) setStep(2);
  }

  function buildListMapPayload(): string {
    if (providerInfo.pickerKind === "manual") return listMap;
    // Busca automática falhou (ex: TRELLO_API_KEY não configurada) e a pessoa
    // preencheu o textarea de fallback — usa isso em vez do picker.
    if (remoteListsError && listMap.trim()) return listMap;

    const chosen = Object.entries(frenteListMap).filter(([, listId]) => listId);
    if (providerInfo.pickerKind === "flat") {
      return JSON.stringify(Object.fromEntries(chosen));
    }
    // nested: frente → { nomeDaLista: id }
    const nested: Record<string, Record<string, string>> = {};
    for (const [frente, listId] of chosen) {
      const list = remoteLists?.find((l) => l.id === listId);
      if (list) nested[frente] = { [list.name]: list.id };
    }
    return JSON.stringify(nested);
  }

  async function handleProviderSubmit() {
    const result = await submitJson("/api/onboarding/task-provider", {
      provider,
      token,
      list_map: buildListMapPayload(),
      trello_api_key: provider === "trello" ? trelloApiKey : "",
    });
    if (result) setStep(3);
  }

  async function handleChannelSubmit() {
    if (!channel) return;
    const result = await submitJson("/api/onboarding/channel", {
      channel_preference: channel,
      telegram_bot_token: telegramToken,
    });
    if (result) {
      setTelegramWebhookStatus(typeof result.telegram_webhook === "string" ? result.telegram_webhook : null);
      setStep(4);
      setFinished(true);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <StepIndicator step={step} />
          <button
            type="button"
            onClick={handleSignOut}
            className="shrink-0 text-[12.5px] font-medium text-muted-2 underline underline-offset-2 hover:text-muted"
          >
            Sair
          </button>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {step === 1 && (
          <>
            <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-2">Contas conectadas</h2>
              {props.linkError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {LINK_ERROR_MESSAGES[props.linkError] ?? "Não conseguimos conectar essa conta agora. Tenta de novo?"}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {enabledOAuthProviders().map((cfg) => {
                  const connected = cfg.id === "google" ? props.googleConnected : props.outlookConnected;
                  return (
                    <div
                      key={cfg.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line-soft px-3 py-2 text-[13px]"
                    >
                      <span className="text-foreground">{cfg.label}</span>
                      {connected ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-cyan/10 px-2 py-0.5 text-[11.5px] font-bold text-cyan">
                          <CheckIcon /> Conectado
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleConnectProvider(cfg.id)}
                          disabled={connectingProvider !== null}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-2 disabled:opacity-60"
                        >
                          {connectingProvider === cfg.id ? "Redirecionando…" : "Conectar"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-7">
              <h1 className="text-xl font-semibold text-foreground">Quem é você?</h1>
              <p className="text-[13px] leading-relaxed text-muted">
                É o que a secretária usa pra falar com você. Só o nome é
                obrigatório — o resto dá pra ajustar depois.
              </p>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                Nome
                <input
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13.5px] font-normal text-foreground placeholder:text-muted-2 focus:border-cyan focus:outline-none"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Como quer ser chamado"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                Cargo (opcional)
                <input
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13.5px] font-normal text-foreground placeholder:text-muted-2 focus:border-cyan focus:outline-none"
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value)}
                  placeholder="Ex: sócio, gerente, freelancer…"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                Áreas da sua vida (opcional, separadas por vírgula)
                <input
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13.5px] font-normal text-foreground placeholder:text-muted-2 focus:border-cyan focus:outline-none"
                  value={frentes}
                  onChange={(e) => setFrentes(e.target.value)}
                  placeholder="Ex: trabalho, casa"
                />
                <span className="text-xs font-normal text-muted-2">
                  Não sabe o que colocar? Pode deixar em branco e ajustar depois.
                </span>
              </label>
              <button
                onClick={handlePersonaSubmit}
                disabled={saving || !nome.trim()}
                className="mt-2 rounded-lg bg-cyan px-6 py-3 font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                {saving ? "Salvando…" : "Continuar"}
              </button>
            </section>
          </>
        )}

        {step === 2 && (
          <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-7">
            <h1 className="text-xl font-semibold text-foreground">Onde ficam suas tarefas?</h1>
            <p className="text-[13px] leading-relaxed text-muted">
              Escolha onde a secretária vai ler e criar tarefas pra você.
            </p>
            <div className="flex flex-col gap-2">
              <ProviderOption
                opt={PROVIDER_OPTIONS.find((o) => o.value === "google_tasks")!}
                selected={provider === "google_tasks"}
                onSelect={() => setProvider("google_tasks")}
              />
              <details
                className="rounded-lg border border-line-soft"
                open={showAdvancedProviders}
                onToggle={(e) => setShowAdvancedProviders(e.currentTarget.open)}
              >
                <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-muted">
                  Já usa ClickUp, Notion ou Trello? Clique aqui.
                </summary>
                <div className="flex flex-col gap-2 border-t border-line-soft p-3">
                  {PROVIDER_OPTIONS.filter((o) => o.value !== "google_tasks").map((opt) => (
                    <ProviderOption
                      key={opt.value}
                      opt={opt}
                      selected={provider === opt.value}
                      onSelect={() => setProvider(opt.value)}
                    />
                  ))}
                </div>
              </details>
            </div>
            {provider !== "google_tasks" && (
              <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                Token de acesso
                <input
                  type="password"
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13.5px] font-normal text-foreground placeholder:text-muted-2 focus:border-cyan focus:outline-none"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Cole o token aqui"
                />
                {providerInfo.tokenSteps && (
                  <details className="rounded-lg border border-line px-3 py-2 text-xs font-normal text-muted">
                    <summary className="cursor-pointer text-[12.5px] font-semibold text-cyan">
                      Como conseguir esse token?
                    </summary>
                    <ol className="mt-2 list-decimal space-y-1 pl-4">
                      {providerInfo.tokenSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    {providerInfo.helpLink && (
                      <a
                        href={providerInfo.helpLink.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-cyan underline"
                      >
                        {providerInfo.helpLink.label} ↗
                      </a>
                    )}
                  </details>
                )}
              </label>
            )}
            {provider === "trello" && (
              <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                Sua própria API key do Trello (opcional)
                <input
                  type="password"
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13.5px] font-normal text-foreground placeholder:text-muted-2 focus:border-cyan focus:outline-none"
                  value={trelloApiKey}
                  onChange={(e) => setTrelloApiKey(e.target.value)}
                  placeholder={props.trelloApiKeyConfigured ? "Já recebemos uma key — cole outra pra trocar" : "Deixe em branco pra usar a key compartilhada da plataforma"}
                />
                <details className="rounded-lg border border-line px-3 py-2 text-xs font-normal text-muted">
                  <summary className="cursor-pointer text-[12.5px] font-semibold text-cyan">
                    Quando eu preciso disso?
                  </summary>
                  <p className="mt-2">
                    Sem preencher, sua conta usa a key compartilhada da plataforma (é o que o link de
                    autorização que você recebeu já usa por trás — não precisa fazer nada extra).
                    Só preencha se você quiser sua própria conta de aplicação no Trello, separada da
                    plataforma:
                  </p>
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    <li>Acessa trello.com/power-ups/admin (ou trello.com/app-key), logado com a conta certa.</li>
                    <li>Copia a &quot;API Key&quot; que aparece lá (não é o token — isso é outra coisa).</li>
                  </ol>
                </details>
              </label>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Mapa de frentes</span>
              <span className="text-xs font-normal text-muted-2">{providerInfo.mapHint}</span>

              {providerInfo.pickerKind === "manual" ? (
                <textarea
                  className="min-h-24 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs font-normal text-foreground placeholder:text-muted-2 focus:border-cyan focus:outline-none"
                  value={listMap}
                  onChange={(e) => setListMap(e.target.value)}
                  placeholder={providerInfo.placeholder}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {(provider === "notion" || provider === "clickup" || provider === "trello") && (
                    <button
                      type="button"
                      onClick={loadRemoteLists}
                      disabled={remoteListsLoading || !token.trim()}
                      className="self-start rounded-lg border border-line px-4 py-2 text-xs font-medium text-foreground transition hover:bg-surface-2 disabled:opacity-60"
                    >
                      {remoteListsLoading
                        ? "Buscando…"
                        : `Buscar minhas ${provider === "notion" ? "databases" : "listas"}`}
                    </button>
                  )}
                  {provider === "google_tasks" && remoteListsLoading && (
                    <p className="text-xs text-muted">Buscando suas listas…</p>
                  )}
                  {remoteListsError && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs text-red-600">{remoteListsError}</p>
                      <span className="text-xs text-muted-2">Enquanto isso, pode colar o mapa manualmente:</span>
                      <textarea
                        className="min-h-24 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs font-normal text-foreground placeholder:text-muted-2 focus:border-cyan focus:outline-none"
                        value={listMap}
                        onChange={(e) => setListMap(e.target.value)}
                        placeholder={providerInfo.placeholder}
                      />
                    </div>
                  )}
                  {remoteLists && remoteLists.length === 0 && (
                    <p className="text-xs text-muted-2">
                      {provider === "notion"
                        ? "Nenhum database compartilhado com essa integração ainda — compartilha um (Connections → Connect to) e clica em buscar de novo."
                        : "Nenhuma lista encontrada."}
                    </p>
                  )}
                  {remoteLists && remoteLists.length > 0 && frentesArr.length === 0 && (
                    <p className="text-xs text-muted-2">
                      Você não cadastrou nenhuma frente no passo 1 — pode voltar lá se quiser mapear alguma, ou seguir sem mapear.
                    </p>
                  )}
                  {remoteLists && remoteLists.length > 0 && frentesArr.map((frente) => (
                    <label key={frente} className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                      {frente}
                      <select
                        className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13.5px] font-normal text-foreground focus:border-cyan focus:outline-none"
                        value={frenteListMap[frente] ?? ""}
                        onChange={(e) =>
                          setFrenteListMap((prev) => ({ ...prev, [frente]: e.target.value }))
                        }
                      >
                        <option value="">— não mapear por enquanto —</option>
                        {remoteLists.map((l) => (
                          <option key={l.id} value={l.id}>{l.path}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <span className="text-xs font-normal text-muted-2">
                Não sabe montar isso ainda? Pode deixar em branco e ajustar depois.
              </span>
            </div>

            <div className="mt-2 flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="rounded-lg border border-line px-6 py-3 font-medium text-foreground transition hover:bg-surface-2"
              >
                Voltar
              </button>
              <button
                onClick={handleProviderSubmit}
                disabled={saving || (provider !== "google_tasks" && !token.trim())}
                className="flex-1 rounded-lg bg-cyan px-6 py-3 font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                {saving ? "Salvando…" : "Continuar"}
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-7">
            <h1 className="text-xl font-semibold text-foreground">Como você quer conversar com ela?</h1>
            <p className="text-[13px] leading-relaxed text-muted">
              Escolha onde a secretária vai te mandar mensagens e receber as suas.
            </p>
            <div className="flex flex-col gap-2">
              {CHANNEL_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-4 py-3 transition ${
                    channel === opt.value
                      ? "border-cyan bg-cyan/5"
                      : "border-line hover:border-line-soft"
                  }`}
                >
                  <span className="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
                    <input
                      type="radio"
                      name="channel"
                      checked={channel === opt.value}
                      onChange={() => setChannel(opt.value)}
                      className="accent-cyan"
                    />
                    {opt.label}
                    {opt.recommended && (
                      <span className="rounded-md bg-cyan/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan">
                        Recomendado
                      </span>
                    )}
                  </span>
                  <span className="pl-[21px] text-xs text-muted">{opt.hint}</span>
                </label>
              ))}
            </div>
            {channelInfo?.cost && (
              <div className="rounded-lg border border-violet/30 bg-violet/5 px-3 py-2.5 text-xs leading-relaxed text-muted">
                <span className="text-[11px] font-bold uppercase tracking-wide text-violet">Custo</span>
                <p className="mt-1">{channelInfo.cost}</p>
              </div>
            )}
            {channelInfo && (
              <p className="text-xs leading-relaxed text-muted-2">{channelInfo.setup}</p>
            )}
            {wantsTelegram && (
              <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
                Token do bot do Telegram
                <input
                  type="password"
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13.5px] font-normal text-foreground placeholder:text-muted-2 focus:border-cyan focus:outline-none"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  placeholder={props.telegramConnected ? "Já recebemos um token — cole outro pra trocar" : "Cole o token do @BotFather aqui"}
                />
                <details className="rounded-lg border border-line px-3 py-2 text-xs font-normal text-muted">
                  <summary className="cursor-pointer text-[12.5px] font-semibold text-cyan">
                    Como criar esse bot?
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    {TELEGRAM_BOT_STEPS.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </details>
                <span className="text-xs font-normal text-muted-2">
                  Não sabe montar isso ainda? Pode deixar em branco e ajustar depois.
                </span>
              </label>
            )}
            {wantsWhatsapp && (
              <p className="text-xs leading-relaxed text-muted-2">
                Não precisa preencher nada agora pro WhatsApp — quem administra a plataforma
                entra em contato pra combinar o número e finalizar essa parte.
              </p>
            )}
            <div className="mt-2 flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="rounded-lg border border-line px-6 py-3 font-medium text-foreground transition hover:bg-surface-2"
              >
                Voltar
              </button>
              <button
                onClick={handleChannelSubmit}
                disabled={saving || !channel}
                className="flex-1 rounded-lg bg-cyan px-6 py-3 font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                {saving ? "Salvando…" : "Concluir"}
              </button>
            </div>
          </section>
        )}

        {step === 4 && finished && (
          <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-7">
            <h1 className="text-xl font-semibold text-foreground">
              Tudo pronto, {nome.split(" ")[0] || ""}
            </h1>
            <p className="mb-2 text-[13px] leading-relaxed text-muted">
              Sua secretária foi configurada com os dados abaixo.
            </p>
            <dl className="flex flex-col">
              <ReceiptRow label="Nome" value={nome} />
              <ReceiptRow label="Cargo" value={cargo || "—"} />
              <ReceiptRow label="Frente" value={frentes || "—"} />
              <ReceiptRow label="Tarefas" value={providerInfo.label} />
              <ReceiptRow
                label="Google"
                value={props.googleConnected ? "Conectado" : "Não conectado"}
                ok={props.googleConnected}
              />
              {enabledOAuthProviders().some((p) => p.id === "azure") && (
                <ReceiptRow
                  label="Outlook"
                  value={props.outlookConnected ? "Conectado" : "Não conectado"}
                  ok={props.outlookConnected}
                />
              )}
              <ReceiptRow label="Canal" value={channelInfo?.label ?? "—"} />
              {wantsTelegram && (
                <ReceiptRow
                  label="Bot Telegram"
                  value={
                    telegramWebhookStatus === "registered"
                      ? "Ativo"
                      : props.telegramConnected || telegramToken
                      ? "Token recebido"
                      : "Pendente"
                  }
                  ok={telegramWebhookStatus === "registered" || props.telegramConnected || Boolean(telegramToken)}
                />
              )}
            </dl>
            <div
              className={`mt-5 flex items-center gap-2 rounded-lg px-3 py-2.5 text-[11.5px] font-bold tracking-wide ${
                telegramWebhookStatus === "registered"
                  ? "bg-cyan/10 text-cyan"
                  : telegramWebhookStatus === "failed"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-surface-2 text-muted"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  telegramWebhookStatus === "registered"
                    ? "bg-cyan"
                    : telegramWebhookStatus === "failed"
                    ? "bg-amber-600"
                    : "bg-muted-2"
                }`}
              />
              {telegramWebhookStatus === "registered"
                ? "Telegram ativo"
                : telegramWebhookStatus === "failed"
                ? "Telegram não ativou automaticamente"
                : wantsTelegram && !wantsWhatsapp
                ? "Telegram pronto pra ativar"
                : "Aguardando conexão de canal"}
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted">
              {telegramWebhookStatus === "registered"
                ? "Seu bot do Telegram já está ativo — pode mandar uma mensagem pra ele agora."
                : telegramWebhookStatus === "failed"
                ? "Salvamos o token, mas não conseguimos ativar o bot automaticamente agora (confere se colou certo) — quem administra a plataforma consegue finalizar manualmente."
                : wantsWhatsapp
                ? "A parte do WhatsApp ainda é configurada manualmente — você vai receber uma mensagem com as instruções."
                : "Assim que a ativação do Telegram estiver disponível, sua secretária já vai ter o token dela salvo — sem precisar repetir esse passo."}
            </p>
            <p className="mt-3 text-xs text-muted-2">Seu identificador: {props.slug}</p>
            <button
              onClick={() => {
                setFinished(false);
                setStep(1);
              }}
              className="mt-4 self-start text-xs text-cyan underline underline-offset-2"
            >
              Editar configuração
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

function ProviderOption({
  opt,
  selected,
  onSelect,
}: {
  opt: (typeof PROVIDER_OPTIONS)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-4 py-3 transition ${
        selected ? "border-cyan bg-cyan/5" : "border-line hover:border-line-soft"
      }`}
    >
      <span className="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
        <input type="radio" name="provider" checked={selected} onChange={onSelect} className="accent-cyan" />
        {opt.label}
      </span>
      <span className="pl-[21px] text-xs text-muted">{opt.hint}</span>
    </label>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3">
      <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReceiptRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line-soft py-2.5 text-[12.5px] last:border-none">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-muted-2">{label}</dt>
      <dd className={`font-medium ${ok ? "text-cyan" : "text-foreground"}`}>{value}</dd>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const labels = ["Você", "Tarefas", "Canal", "Pronto"];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-muted-2">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        return (
          <span key={label} className={`flex items-center gap-1.5 ${n === step ? "text-cyan" : ""}`}>
            {i > 0 && <span className="text-muted-2">·</span>}
            {n} {label}
          </span>
        );
      })}
    </div>
  );
}
