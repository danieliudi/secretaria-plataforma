"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { OAUTH_PROVIDERS, enabledOAuthProviders, type OAuthProviderId } from "@/lib/oauth-providers";
import { PRESETS, type Personalidade } from "@/lib/personalidade";
import { garanteOrigemCanonica } from "@/lib/site-url";
import { AppHeader } from "@/components/AppHeader";

type Provider = "clickup" | "notion" | "trello" | "google_tasks" | "microsoft_todo";
type Channel = "whatsapp" | "telegram" | "teams";

const PROVIDER_OPTIONS: Array<{
  value: Provider;
  label: string;
  hint: string;
  tokenSteps: string[] | null;
  helpLink: { href: string; label: string } | null;
}> = [
  {
    value: "google_tasks",
    label: "Google Tasks",
    hint: "Grátis e já pronto — reusa o login que você acabou de fazer, sem token extra.",
    tokenSteps: null,
    helpLink: null,
  },
  {
    value: "microsoft_todo",
    label: "Microsoft To Do",
    hint: "Também grátis e sem token extra — reusa o login do Outlook.",
    tokenSteps: null,
    helpLink: null,
  },
  {
    value: "clickup",
    label: "ClickUp",
    hint: "Cole seu token pessoal (app.clickup.com/settings/apps).",
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
  },
  {
    value: "notion",
    label: "Notion",
    hint: "Token de uma integração do Notion (notion.so/my-integrations) — depois é preciso conectar pelo menos 1 página a ela.",
    // Passos revisados 21/08/2026 depois de alguém tentar seguir e travar: o
    // Notion tirou a escolha de tipo "Internal" na criação (agora toda
    // integração nova já nasce interna) e chama o vínculo com a página de
    // "Connection". Os textos abaixo descrevem o RESULTADO esperado em vez de
    // depender do rótulo exato do botão — o Notion mexe nisso com frequência.
    tokenSteps: [
      "Acessa notion.so/my-integrations (logado com a conta certa).",
      "Clica em \"New integration\", dá um nome e escolhe o workspace.",
      "Copia o token que aparece (começa com \"secret_\" ou \"ntn_\") — pode ser preciso clicar em \"Show\" antes.",
      "Importante: abre a página do Notion onde a Mia vai trabalhar, clica nos \"...\" do canto superior direito e procura \"Connections\" (ou \"Conexões\"). Escolhe ali a integração que você acabou de criar.",
      "Sem esse último passo o token não enxerga nada — é a conexão com a página que dá acesso, não o token sozinho.",
    ],
    helpLink: {
      href: "https://www.notion.com/help/create-integrations-with-the-notion-api",
      label: "Guia oficial do Notion (com imagens)",
    },
  },
  {
    value: "trello",
    label: "Trello",
    hint: "Token de acesso pessoal. (A API key do app fica combinada por enquanto — se precisar, fale com quem administra a plataforma.)",
    tokenSteps: [
      "Quem administra a plataforma já tem uma chave de API do Trello configurada — você não precisa criar uma.",
      "Peça pra essa pessoa o link de autorização pronto (usa a chave dela). Ao abrir e clicar em \"Allow\", o Trello mostra seu token pessoal.",
      "Se você já tiver uma API key própria do Trello, também pode gerar por conta própria — veja o guia oficial abaixo.",
    ],
    helpLink: {
      href: "https://support.atlassian.com/trello/docs/getting-started-with-trello-rest-api/",
      label: "Guia oficial do Trello (com imagens)",
    },
  },
];

const CHANNEL_OPTIONS: Array<{
  value: Channel;
  label: string;
  hint: string;
  info: string;
  recommended?: boolean;
}> = [
  {
    value: "whatsapp",
    label: "WhatsApp",
    hint: "Você já usa no dia a dia — ninguém precisa aprender um app novo.",
    info: "Grátis pra você — todo mundo conversa pelo mesmo número da plataforma. Ao concluir esse passo você recebe um código: é só mandar ele numa mensagem pro número oficial pra vincular seu WhatsApp à sua secretária.",
    recommended: true,
  },
  {
    value: "telegram",
    label: "Telegram",
    hint: "Grátis, e você mesmo consegue criar o bot agora — sem esperar ninguém configurar nada.",
    info: "Você cria seu próprio bot em poucos passos e cola o token abaixo.",
  },
  {
    value: "teams",
    label: "Microsoft Teams",
    hint: "Se seu trabalho já vive no Teams — mesma ideia do WhatsApp, um código de 6 letras vincula sua conta.",
    info: "Grátis pra você — todo mundo conversa pelo mesmo bot da plataforma. Ao concluir esse passo você recebe um código: é só mandar ele numa mensagem pro bot pra vincular sua conta do Teams.",
  },
];

const LINK_ERROR_MESSAGES: Record<string, string> = {
  missing_code: "Não recebemos a confirmação — tenta de novo?",
  auth_failed: "Não conseguimos confirmar essa conexão — tenta de novo?",
};

// Lido em tempo de BUILD (Next.js substitui a expressão literal no bundle), não
// em runtime: mudar essa variável no Netlify exige um novo deploy pra aparecer.
// Por isso a referência precisa ser `process.env.NEXT_PUBLIC_...` escrita por
// extenso — desestruturar ou indexar dinamicamente quebra a substituição.
const WHATSAPP_NUMERO = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";

// wa.me só aceita dígitos. Se a variável não estiver setada, não inventa link.
const WHATSAPP_LINK = WHATSAPP_NUMERO
  ? `https://wa.me/${WHATSAPP_NUMERO.replace(/\D/g, "")}`
  : null;

const TELEGRAM_BOT_STEPS = [
  "Abre o Telegram e procura por \"@BotFather\" (o bot oficial que cria outros bots).",
  "Manda o comando /newbot e segue as perguntas (nome e um @usuario terminado em \"bot\").",
  "O BotFather te devolve um token — algo como \"123456:ABC-DEF...\".",
  "Copia esse token e cola no campo abaixo.",
];

type Step = 1 | 2 | 3 | 4;

// Como a secretária chama a pessoa. Não tem "Sr./Sra." como preset de
// propósito: escolher entre os dois exigiria adivinhar o gênero de quem se
// cadastrou — o campo livre resolve isso sem errar com ninguém.
type TratamentoOpcao = "chefe" | "nome" | "outro" | "nenhum";

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "";
}

export default function OnboardingWizard(props: {
  slug: string;
  email: string;
  userLabel: string;
  pendentes: number;
  /** Vem de `?step=` — link de "editar" no /app pousando no passo certo. */
  initialStep?: Step;
  initialNome: string;
  initialCargo: string;
  initialFrentes: string;
  aprovado: boolean;
  recusado: boolean;
  /** `tenants.is_platform_owner` — só quem é dono vê o link pro /admin. */
  isPlatformOwner: boolean;
  initialUsaVocativo: boolean;
  initialTratamento: string;
  initialPersonalidade: Personalidade;
  initialEnvioOficial: boolean;
  /**
   * A plataforma já concluiu a verificação na Meta? Vem de env var de RUNTIME
   * lida no server component — nunca `NEXT_PUBLIC_*`, que é resolvida em tempo
   * de BUILD e exigiria um deploy novo pra liberar a opção.
   */
  envioOficialDisponivel: boolean;
  initialProvider: Provider;
  googleConnected: boolean;
  outlookConnected: boolean;
  linkError: string | null;
  initialChannels: Channel[];
  telegramConnected: boolean;
  trelloApiKeyConfigured: boolean;
  whatsappConnected: boolean;
  initialWhatsappLinkCode: string | null;
  initialWhatsappLinkCodeExpiresAt: string | null;
  teamsConnected: boolean;
  initialTeamsLinkCode: string | null;
  initialTeamsLinkCodeExpiresAt: string | null;
  initialRespostaAudioSempre: boolean;
}) {
  const [step, setStep] = useState<Step>(props.initialStep ?? 1);
  const [nome, setNome] = useState(props.initialNome);
  const [cargo, setCargo] = useState(props.initialCargo);
  const [frentes, setFrentes] = useState(props.initialFrentes);
  // Deriva a opção a partir do que está salvo: sem vocativo → "nenhum";
  // tratamento vazio → padrão; igual ao primeiro nome → "nome"; resto → livre.
  const [tratamentoOpcao, setTratamentoOpcao] = useState<TratamentoOpcao>(() => {
    if (!props.initialUsaVocativo) return "nenhum";
    const t = props.initialTratamento.trim();
    if (!t) return "chefe";
    if (t.toLowerCase() === primeiroNome(props.initialNome).toLowerCase()) return "nome";
    return "outro";
  });
  const [tratamentoLivre, setTratamentoLivre] = useState(
    props.initialUsaVocativo ? props.initialTratamento : "",
  );
  const [personalidade, setPersonalidade] = useState<Personalidade>(props.initialPersonalidade);
  const [envioOficial, setEnvioOficial] = useState(props.initialEnvioOficial);
  const [provider, setProvider] = useState<Provider>(props.initialProvider);
  const [token, setToken] = useState("");
  const [trelloApiKey, setTrelloApiKey] = useState("");
  const [showAdvancedProviders, setShowAdvancedProviders] = useState(
    !["google_tasks", "microsoft_todo"].includes(props.initialProvider),
  );
  const [listasCriadas, setListasCriadas] = useState<string[] | null>(null);
  const [listasFalhas, setListasFalhas] = useState<Array<{ frente: string; erro: string }>>([]);
  const [channels, setChannels] = useState<Set<Channel>>(new Set(props.initialChannels));
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramWebhookStatus, setTelegramWebhookStatus] = useState<string | null>(null);
  const [telegramWebhookWarning, setTelegramWebhookWarning] = useState<string | null>(null);
  const [whatsappLinkCode, setWhatsappLinkCode] = useState<string | null>(props.initialWhatsappLinkCode);
  const [whatsappLinkCodeExpiresAt, setWhatsappLinkCodeExpiresAt] = useState<string | null>(props.initialWhatsappLinkCodeExpiresAt);
  const [whatsappConnected, setWhatsappConnected] = useState(props.whatsappConnected);
  const [teamsLinkCode, setTeamsLinkCode] = useState<string | null>(props.initialTeamsLinkCode);
  const [teamsLinkCodeExpiresAt, setTeamsLinkCodeExpiresAt] = useState<string | null>(props.initialTeamsLinkCodeExpiresAt);
  const [teamsConnected, setTeamsConnected] = useState(props.teamsConnected);
  const [respostaAudioSempre, setRespostaAudioSempre] = useState(props.initialRespostaAudioSempre);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<OAuthProviderId | null>(null);

  const providerInfo = PROVIDER_OPTIONS.find((p) => p.value === provider)!;
  const wantsTelegram = channels.has("telegram");
  const wantsWhatsapp = channels.has("whatsapp");
  const wantsTeams = channels.has("teams");
  const telegramActive = telegramWebhookStatus === "registered";
  const telegramFailed = telegramWebhookStatus === "failed";
  const frentesArr = frentes.split(",").map((f) => f.trim()).filter(Boolean);
  // Google Tasks/Microsoft To Do reaproveitam o login — o selo de recomendado
  // segue qual conta a pessoa já conectou, não uma escolha fixa.
  const googleTasksRecommended = props.googleConnected;
  const microsoftTodoRecommended = props.outlookConnected;

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

  // Conectar agenda/e-mail de um provider. São DOIS caminhos, e usar o errado
  // foi o bug de 14/08/2026:
  //
  // - Provider que a pessoa AINDA NÃO tem como identidade (entrou com Google e
  //   quer somar o Outlook) → `linkIdentity`, que adiciona a identidade.
  //
  // - Provider que JÁ é a identidade dela (entrou com Google e precisa conectar
  //   o Google Calendar) → `signInWithOAuth`. O Supabase RECUSA `linkIdentity`
  //   pra uma identidade que o usuário já tem, e o erro chegava na tela como
  //   "Não conseguimos iniciar a conexão" — mensagem que não ajudava ninguém a
  //   entender que a operação é que estava errada.
  //
  // O que se quer nos dois casos é o mesmo: um `provider_refresh_token` novo,
  // que só vem com `prompt=consent` (ver lib/oauth-providers.ts) e que o
  // callback grava no Vault. Reautenticar entrega isso; vincular de novo, não.
  async function handleConnectProvider(provider: OAuthProviderId) {
    setConnectingProvider(provider);
    // Mesmo motivo do /login: o cookie do code verifier do PKCE é host-only, e
    // precisa nascer no mesmo host que vai receber o `code` de volta. Ver
    // lib/site-url.ts.
    if (garanteOrigemCanonica("/onboarding")) return;

    const supabase = createClient();
    const cfg = OAUTH_PROVIDERS[provider];
    const opcoes = {
      redirectTo: `${window.location.origin}/auth/callback?provider=${provider}&intent=link`,
      scopes: cfg.scopes,
      queryParams: cfg.queryParams,
    };

    let jaEhIdentidade = false;
    try {
      const { data } = await supabase.auth.getUserIdentities();
      jaEhIdentidade = (data?.identities ?? []).some((i) => i.provider === provider);
    } catch {
      // Não conseguir listar identidades não pode travar a conexão. Seguir por
      // `signInWithOAuth` é o lado seguro: ele funciona nos dois casos, só
      // reautentica quem já estava logado.
      jaEhIdentidade = true;
    }

    const { error } = jaEhIdentidade
      ? await supabase.auth.signInWithOAuth({ provider, options: opcoes })
      : await supabase.auth.linkIdentity({ provider, options: opcoes });

    if (error) {
      setConnectingProvider(null);
      console.error(`[onboarding] conectar ${provider} falhou:`, error.message);
      setError(
        `Não conseguimos abrir a autorização do ${cfg.label} — tenta de novo? ` +
          `Se persistir, o motivo aparece no console do navegador.`,
      );
    }
    // Sucesso: navegador é redirecionado pro provider, nada mais a fazer aqui.
  }

  async function handlePersonaSubmit() {
    const frentesArrTrim = frentes.split(",").map((f) => f.trim()).filter(Boolean);
    // "chefe" é o padrão do backend, então vai como null em vez de literal —
    // assim mudar o padrão depois não exige migrar quem já se cadastrou.
    const tratamento = tratamentoOpcao === "nome"
      ? primeiroNome(nome)
      : tratamentoOpcao === "outro"
      ? tratamentoLivre.trim()
      : null;
    const result = await submitJson("/api/onboarding/persona", {
      nome,
      cargo,
      frentes: frentesArrTrim,
      usa_vocativo: tratamentoOpcao !== "nenhum",
      tratamento: tratamento || null,
      personalidade,
    });
    if (result) setStep(2);
  }

  async function handleProviderSubmit() {
    const result = await submitJson("/api/onboarding/task-provider", {
      provider,
      token,
      trello_api_key: provider === "trello" ? trelloApiKey : "",
    });
    if (result) {
      setListasCriadas(Array.isArray(result.criadas) ? (result.criadas as string[]) : []);
      setListasFalhas(Array.isArray(result.falhas) ? (result.falhas as Array<{ frente: string; erro: string }>) : []);
      setStep(3);
    }
  }

  function toggleChannel(value: Channel) {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function handleChannelSubmit() {
    if (channels.size === 0) return;
    const result = await submitJson("/api/onboarding/channel", {
      channels: [...channels],
      telegram_bot_token: telegramToken,
      envio_oficial: envioOficial,
      resposta_audio_sempre: respostaAudioSempre,
    });
    if (result) {
      setTelegramWebhookStatus(typeof result.telegram_webhook === "string" ? result.telegram_webhook : null);
      setTelegramWebhookWarning(typeof result.telegram_webhook_warning === "string" ? result.telegram_webhook_warning : null);
      setWhatsappLinkCode(typeof result.whatsapp_link_code === "string" ? result.whatsapp_link_code : null);
      setWhatsappLinkCodeExpiresAt(typeof result.whatsapp_link_code_expires_at === "string" ? result.whatsapp_link_code_expires_at : null);
      if (result.whatsapp_already_linked === true) setWhatsappConnected(true);
      setTeamsLinkCode(typeof result.teams_link_code === "string" ? result.teams_link_code : null);
      setTeamsLinkCodeExpiresAt(typeof result.teams_link_code_expires_at === "string" ? result.teams_link_code_expires_at : null);
      if (result.teams_already_linked === true) setTeamsConnected(true);
      setStep(4);
      setFinished(true);
    }
  }

  return (
    <main className="aurora-bg min-h-screen">
      <AppHeader
        active="app"
        isPlatformOwner={props.isPlatformOwner}
        pendentes={props.pendentes}
        userLabel={props.userLabel}
      />

      <div className="mx-auto flex w-full max-w-[720px] flex-col px-8 py-9 sm:py-14">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <StepTabs step={step} onSelect={setStep} />
          <button
            type="button"
            onClick={handleSignOut}
            className="shrink-0 text-[12.5px] font-medium text-aurora-muted-2 underline underline-offset-2 hover:text-aurora-muted"
          >
            Sair
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13.5px] text-red-300">
            {error}
          </p>
        )}

        {!props.aprovado && <AvisoAprovacao recusado={props.recusado} />}

        {step === 1 && (
          <div className="mt-4 flex flex-col gap-4">
            <section className="flex flex-col gap-3 rounded-[16px] border border-aurora-line bg-aurora-surface p-5">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-aurora-muted-2">Contas conectadas</h2>
              {props.linkError && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {LINK_ERROR_MESSAGES[props.linkError] ?? "Não conseguimos conectar essa conta agora. Tenta de novo?"}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {enabledOAuthProviders().map((cfg) => {
                  const connected = cfg.id === "google" ? props.googleConnected : props.outlookConnected;
                  return (
                    <div
                      key={cfg.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-aurora-line-soft px-3 py-2 text-[13px]"
                    >
                      <span className="text-aurora-fg">{cfg.label}</span>
                      {connected ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-aurora-ok/15 px-2 py-0.5 text-[11.5px] font-bold text-aurora-ok">
                          <CheckIcon /> Conectado
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleConnectProvider(cfg.id)}
                          disabled={connectingProvider !== null}
                          className="rounded-lg border border-aurora-line px-3 py-1.5 text-xs font-medium text-aurora-fg transition hover:bg-aurora-surface-2 disabled:opacity-60"
                        >
                          {connectingProvider === cfg.id ? "Redirecionando…" : "Conectar"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="flex flex-col gap-4 rounded-[16px] border border-aurora-line bg-aurora-surface p-7">
              <h1 className="text-[21px] font-semibold tracking-tight text-aurora-fg">Quem é você?</h1>
              <p className="-mt-2 text-[13px] leading-relaxed text-aurora-muted">
                É o que a secretária usa pra falar com você. Só o nome é
                obrigatório — o resto dá pra ajustar depois.
              </p>
              <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold text-aurora-fg">
                Nome
                <input
                  className="rounded-lg border border-aurora-line bg-aurora-surface-2 px-3 py-2 text-[13.5px] font-normal text-aurora-fg placeholder:text-aurora-muted-2 focus:border-aurora-accent focus:outline-none"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Como quer ser chamado"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold text-aurora-fg">
                Cargo (opcional)
                <input
                  className="rounded-lg border border-aurora-line bg-aurora-surface-2 px-3 py-2 text-[13.5px] font-normal text-aurora-fg placeholder:text-aurora-muted-2 focus:border-aurora-accent focus:outline-none"
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value)}
                  placeholder="Ex: sócio, gerente, freelancer…"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold text-aurora-fg">
                Áreas da sua vida (opcional, separadas por vírgula)
                <input
                  className="rounded-lg border border-aurora-line bg-aurora-surface-2 px-3 py-2 text-[13.5px] font-normal text-aurora-fg placeholder:text-aurora-muted-2 focus:border-aurora-accent focus:outline-none"
                  value={frentes}
                  onChange={(e) => setFrentes(e.target.value)}
                  placeholder="Ex: trabalho, casa"
                />
                <span className="text-[11.5px] font-normal text-aurora-muted-2">
                  Não sabe o que colocar? Pode deixar em branco e ajustar depois.
                </span>
              </label>

              <fieldset className="flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 text-[13.5px] font-semibold text-aurora-fg">
                  Como ela deve te chamar?
                </legend>
                <span className="mb-1 text-[11.5px] font-normal text-aurora-muted-2">
                  Ela usa com parcimônia — não em toda mensagem.
                </span>
                {([
                  { id: "chefe", label: "Chefe", ex: "“Chefe, sua reunião das 14h…”" },
                  {
                    id: "nome",
                    label: "Meu primeiro nome",
                    ex: `“${primeiroNome(nome) || "Seu nome"}, sua reunião das 14h…”`,
                  },
                  { id: "outro", label: "Do meu jeito", ex: "Sr. Yano, Dra. Marina, Capitã…" },
                  { id: "nenhum", label: "Não me chame de nada", ex: "“Sua reunião das 14h…”" },
                ] as const).map((opt) => {
                  const ativo = tratamentoOpcao === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 transition ${
                        ativo ? "border-aurora-accent bg-aurora-surface-2" : "border-aurora-line hover:border-aurora-muted-2"
                      }`}
                    >
                      <input
                        type="radio"
                        name="tratamento"
                        className="mt-1 accent-aurora-accent"
                        checked={ativo}
                        onChange={() => setTratamentoOpcao(opt.id)}
                      />
                      <span className="flex flex-col">
                        <span className="text-[13.5px] font-medium text-aurora-fg">{opt.label}</span>
                        <span className="text-xs font-normal text-aurora-muted">{opt.ex}</span>
                      </span>
                    </label>
                  );
                })}
                {tratamentoOpcao === "outro" && (
                  <input
                    className="mt-1 rounded-lg border border-aurora-line bg-aurora-surface-2 px-3 py-2 text-[13.5px] text-aurora-fg placeholder:text-aurora-muted-2 focus:border-aurora-accent focus:outline-none"
                    value={tratamentoLivre}
                    onChange={(e) => setTratamentoLivre(e.target.value)}
                    maxLength={24}
                    placeholder="Ex: Capitã"
                    aria-label="Como você quer ser chamado"
                  />
                )}
              </fieldset>

              <fieldset className="flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 text-[13.5px] font-semibold text-aurora-fg">
                  Como ela deve falar com você?
                </legend>
                <span className="mb-1 text-[11.5px] font-normal text-aurora-muted-2">
                  Quando ela escrever uma mensagem pra você mandar a outra pessoa, o tom sobe
                  um degrau sozinho — ninguém fala com cliente igual fala com a própria
                  secretária.
                </span>
                {PRESETS.map((preset) => {
                  const ativo = personalidade === preset.id;
                  return (
                    <label
                      key={preset.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 transition ${
                        ativo ? "border-aurora-accent bg-aurora-surface-2" : "border-aurora-line hover:border-aurora-muted-2"
                      }`}
                    >
                      <input
                        type="radio"
                        name="personalidade"
                        className="mt-1 accent-aurora-accent"
                        checked={ativo}
                        onChange={() => setPersonalidade(preset.id)}
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[13.5px] font-medium text-aurora-fg">
                          {preset.label}
                        </span>
                        <span className="text-xs font-normal text-aurora-muted-2">{preset.resumo}</span>
                        {/* Prévia só do selecionado: quatro exemplos abertos ao
                            mesmo tempo viram parede de texto e ninguém lê. */}
                        {ativo && (
                          <span className="mt-1.5 rounded-md bg-aurora-surface px-2.5 py-2 text-xs font-normal italic text-aurora-muted">
                            “{preset.exemplo}”
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
                <span className="text-[11.5px] font-normal text-aurora-muted-2">
                  Dá pra trocar depois a qualquer momento.
                </span>
              </fieldset>

              <button
                onClick={handlePersonaSubmit}
                disabled={saving || !nome.trim()}
                className="mt-2 rounded-lg bg-aurora-fg px-6 py-3 font-semibold text-aurora-bg transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                {saving ? "Salvando…" : "Continuar"}
              </button>
            </section>
          </div>
        )}

        {step === 2 && (
          <section className="mt-4 flex flex-col gap-4 rounded-[16px] border border-aurora-line bg-aurora-surface p-7">
            <h1 className="text-[21px] font-semibold tracking-tight text-aurora-fg">Onde ficam suas tarefas?</h1>
            <p className="-mt-2 text-[13px] leading-relaxed text-aurora-muted">
              Escolha onde a secretária vai ler e criar tarefas pra você.
            </p>
            <div className="flex flex-col gap-2">
              <ProviderOption
                opt={PROVIDER_OPTIONS.find((o) => o.value === "google_tasks")!}
                selected={provider === "google_tasks"}
                recommended={googleTasksRecommended}
                recommendedLabel="Recomendado — você entrou com Google"
                onSelect={() => setProvider("google_tasks")}
              />
              <ProviderOption
                opt={PROVIDER_OPTIONS.find((o) => o.value === "microsoft_todo")!}
                selected={provider === "microsoft_todo"}
                recommended={microsoftTodoRecommended}
                recommendedLabel="Recomendado — você entrou com Outlook"
                onSelect={() => setProvider("microsoft_todo")}
              />
              <details
                className="rounded-lg border border-aurora-line-soft"
                open={showAdvancedProviders}
                onToggle={(e) => setShowAdvancedProviders(e.currentTarget.open)}
              >
                <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-aurora-muted">
                  Já usa ClickUp, Notion ou Trello? Clique aqui.
                </summary>
                <div className="flex flex-col gap-2 border-t border-aurora-line-soft p-3">
                  {PROVIDER_OPTIONS.filter((o) => o.value !== "google_tasks" && o.value !== "microsoft_todo").map((opt) => (
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
            {provider !== "google_tasks" && provider !== "microsoft_todo" && (
              <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold text-aurora-fg">
                Token de acesso
                <input
                  type="password"
                  className="rounded-lg border border-aurora-line bg-aurora-surface-2 px-3 py-2 text-[13.5px] font-normal text-aurora-fg placeholder:text-aurora-muted-2 focus:border-aurora-accent focus:outline-none"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Cole o token aqui"
                />
                {providerInfo.tokenSteps && (
                  <details className="rounded-lg border border-aurora-line px-3 py-2 text-xs font-normal text-aurora-muted">
                    <summary className="cursor-pointer text-[12.5px] font-semibold text-aurora-accent-text">
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
                        className="mt-2 inline-block text-aurora-accent-text underline"
                      >
                        {providerInfo.helpLink.label} ↗
                      </a>
                    )}
                  </details>
                )}
              </label>
            )}
            {provider === "trello" && (
              <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold text-aurora-fg">
                Sua própria API key do Trello (opcional)
                <input
                  type="password"
                  className="rounded-lg border border-aurora-line bg-aurora-surface-2 px-3 py-2 text-[13.5px] font-normal text-aurora-fg placeholder:text-aurora-muted-2 focus:border-aurora-accent focus:outline-none"
                  value={trelloApiKey}
                  onChange={(e) => setTrelloApiKey(e.target.value)}
                  placeholder={props.trelloApiKeyConfigured ? "Já recebemos uma key — cole outra pra trocar" : "Deixe em branco pra usar a key compartilhada da plataforma"}
                />
                <details className="rounded-lg border border-aurora-line px-3 py-2 text-xs font-normal text-aurora-muted">
                  <summary className="cursor-pointer text-[12.5px] font-semibold text-aurora-accent-text">
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

            <div className="rounded-lg border border-aurora-accent/35 bg-aurora-accent/[0.06] px-3.5 py-3 text-xs leading-relaxed text-aurora-muted">
              <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-accent-text">Listas das suas áreas</span>
              <p className="mt-1">
                Ao concluir, a Mia cria uma lista nova em {providerInfo.label} pra cada área que você
                indicou no passo 1 — não precisa ir lá criar nada antes.
              </p>
              {frentesArr.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {frentesArr.map((f) => (
                    <span key={f} className="rounded-full border border-aurora-line bg-aurora-surface-2 px-2.5 py-1 text-[11.5px] font-semibold text-aurora-fg">
                      {f}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5">Sem áreas cadastradas ainda — ela cria uma lista única chamada &quot;Geral&quot;.</p>
              )}
            </div>

            {(listasCriadas !== null && (listasCriadas.length > 0 || listasFalhas.length > 0)) && (
              <div className="rounded-lg border border-aurora-line-soft bg-aurora-surface-2 px-3.5 py-3 text-xs leading-relaxed">
                {listasCriadas.length > 0 && (
                  <p className="text-aurora-ok">✓ Criadas: {listasCriadas.join(", ")}</p>
                )}
                {listasFalhas.length > 0 && (
                  <div className="mt-1.5 text-aurora-warn">
                    {listasFalhas.map((f) => (
                      <p key={f.frente}>⚠ {f.frente}: {f.erro}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-2 flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="rounded-lg border border-aurora-line px-6 py-3 font-medium text-aurora-fg transition hover:bg-aurora-surface-2"
              >
                Voltar
              </button>
              <button
                onClick={handleProviderSubmit}
                disabled={saving || (provider !== "google_tasks" && provider !== "microsoft_todo" && !token.trim())}
                className="flex-1 rounded-lg bg-aurora-fg px-6 py-3 font-semibold text-aurora-bg transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                {saving ? "Salvando…" : "Continuar"}
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="mt-4 flex flex-col gap-4 rounded-[16px] border border-aurora-line bg-aurora-surface p-7">
            <h1 className="text-[21px] font-semibold tracking-tight text-aurora-fg">Como você quer conversar com ela?</h1>
            <p className="-mt-2 text-[13px] leading-relaxed text-aurora-muted">
              Escolha um ou mais canais onde a secretária vai te mandar mensagens e receber as suas.
            </p>
            <div className="flex flex-col gap-2">
              {CHANNEL_OPTIONS.map((opt) => {
                const ativo = channels.has(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-4 py-3 transition ${
                      ativo ? "border-aurora-accent bg-aurora-surface-2" : "border-aurora-line hover:border-aurora-line-soft"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[13.5px] font-medium text-aurora-fg">
                      <input
                        type="checkbox"
                        checked={ativo}
                        onChange={() => toggleChannel(opt.value)}
                        className="h-[15px] w-[15px] accent-aurora-accent"
                      />
                      {opt.label}
                      {opt.recommended && (
                        <span className="rounded-md bg-aurora-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-aurora-accent-text">
                          Recomendado
                        </span>
                      )}
                    </span>
                    <span className="pl-[23px] text-xs text-aurora-muted">{opt.hint}</span>
                    {ativo && (
                      <div className="ml-[23px] mt-1.5 rounded-lg border border-aurora-accent/35 bg-aurora-accent/[0.06] px-3 py-2.5 text-xs leading-relaxed text-aurora-muted">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-accent-text">Como funciona</span>
                        <p className="mt-1">{opt.info}</p>
                      </div>
                    )}
                  </label>
                );
              })}
            </div>

            {wantsTelegram && (
              <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold text-aurora-fg">
                Token do bot do Telegram
                <input
                  type="password"
                  className="rounded-lg border border-aurora-line bg-aurora-surface-2 px-3 py-2 text-[13.5px] font-normal text-aurora-fg placeholder:text-aurora-muted-2 focus:border-aurora-accent focus:outline-none"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  placeholder={props.telegramConnected ? "Já recebemos um token — cole outro pra trocar" : "Cole o token do @BotFather aqui"}
                />
                <details className="rounded-lg border border-aurora-line px-3 py-2 text-xs font-normal text-aurora-muted">
                  <summary className="cursor-pointer text-[12.5px] font-semibold text-aurora-accent-text">
                    Como criar esse bot?
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    {TELEGRAM_BOT_STEPS.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </details>
                <span className="text-[11.5px] font-normal text-aurora-muted-2">
                  Não sabe montar isso ainda? Pode deixar em branco e ajustar depois.
                </span>
              </label>
            )}
            {wantsWhatsapp && (
              <p className="text-xs leading-relaxed text-aurora-muted-2">
                {whatsappConnected
                  ? "Seu WhatsApp já está vinculado — não precisa fazer nada aqui."
                  : "Não precisa preencher nada agora — ao concluir esse passo você recebe um código de 6 letras pra colar numa mensagem pro WhatsApp oficial e vincular o seu número."}
              </p>
            )}
            {wantsTeams && (
              <p className="text-xs leading-relaxed text-aurora-muted-2">
                {teamsConnected
                  ? "Sua conta do Teams já está vinculada — não precisa fazer nada aqui."
                  : "Não precisa preencher nada agora — ao concluir esse passo você recebe um código de 6 letras pra colar numa mensagem pro bot da Mia no Teams e vincular sua conta."}
              </p>
            )}

            <fieldset className="mt-1 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-[13.5px] font-semibold text-aurora-fg">
                Ela pode confirmar compromissos sozinha?
              </legend>
              <span className="mb-1 text-[11.5px] font-normal text-aurora-muted-2">
                Por padrão ela escreve a mensagem e você envia, do seu WhatsApp. Se preferir,
                ela mesma manda a confirmação e o lembrete, pelo número oficial da plataforma.
              </span>

              {([
                {
                  v: false,
                  nm: "Ela escreve, eu envio",
                  rz: "Sai do seu WhatsApp, com seu nome. Sem custo.",
                },
                {
                  v: true,
                  nm: "Ela envia confirmação e lembrete",
                  rz: "Sai do número da plataforma. Cerca de R$ 0,05 por mensagem.",
                },
              ] as const).map((opt) => {
                const ativo = envioOficial === opt.v;
                return (
                  <label
                    key={String(opt.v)}
                    className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 transition ${
                      // Sem verificação concluída na Meta, a segunda opção não é
                      // clicável: ligar algo que o backend vai recusar a cada
                      // mensagem seria mentir na tela.
                      !props.envioOficialDisponivel && opt.v
                        ? "cursor-not-allowed border-aurora-line opacity-50"
                        : ativo
                        ? "cursor-pointer border-aurora-accent bg-aurora-surface-2"
                        : "cursor-pointer border-aurora-line hover:border-aurora-muted-2"
                    }`}
                  >
                    <input
                      type="radio"
                      name="envio_oficial"
                      className="mt-1 accent-aurora-accent"
                      checked={ativo}
                      disabled={!props.envioOficialDisponivel && opt.v}
                      onChange={() => setEnvioOficial(opt.v)}
                    />
                    <span className="flex flex-col">
                      <span className="text-[13.5px] font-medium text-aurora-fg">{opt.nm}</span>
                      <span className="text-xs font-normal text-aurora-muted-2">{opt.rz}</span>
                    </span>
                  </label>
                );
              })}

              {!props.envioOficialDisponivel && (
                <p className="rounded-lg border border-dashed border-aurora-line bg-aurora-surface-2 px-3.5 py-2.5 text-xs leading-relaxed text-aurora-muted">
                  O envio automático abre quando a verificação da nossa empresa junto ao
                  WhatsApp for concluída. Até lá ela escreve e você envia — que continua
                  valendo pra tudo que não é confirmação ou lembrete.
                </p>
              )}

              <span className="text-[11.5px] font-normal text-aurora-muted-2">
                Quem receber pode responder SAIR a qualquer momento, e ela para de enviar.
              </span>
            </fieldset>

            <fieldset className="mt-1 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-[13.5px] font-semibold text-aurora-fg">
                Ela responde em áudio?
              </legend>
              <span className="mb-1 text-[11.5px] font-normal text-aurora-muted-2">
                Por padrão, ela espelha o que você manda — áudio pra áudio, texto pra texto. Dá
                pra forçar sempre áudio, bom pra quem tá dirigindo ou andando.
              </span>
              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5 transition ${
                  respostaAudioSempre ? "border-aurora-accent bg-aurora-surface-2" : "border-aurora-line hover:border-aurora-muted-2"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-[15px] w-[15px] accent-aurora-accent"
                  checked={respostaAudioSempre}
                  onChange={(e) => setRespostaAudioSempre(e.target.checked)}
                />
                <span className="flex flex-col">
                  <span className="text-[13.5px] font-medium text-aurora-fg">Sempre responder em áudio</span>
                  <span className="text-xs font-normal text-aurora-muted-2">Mesmo quando você escreve em texto, ela responde falando.</span>
                </span>
              </label>
            </fieldset>

            <div className="mt-2 flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="rounded-lg border border-aurora-line px-6 py-3 font-medium text-aurora-fg transition hover:bg-aurora-surface-2"
              >
                Voltar
              </button>
              <button
                onClick={handleChannelSubmit}
                disabled={saving || channels.size === 0}
                className="flex-1 rounded-lg bg-aurora-fg px-6 py-3 font-semibold text-aurora-bg transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              >
                {saving ? "Salvando…" : "Concluir"}
              </button>
            </div>
          </section>
        )}

        {step === 4 && finished && (
          <section className="mt-4 flex flex-col gap-2 rounded-[16px] border border-aurora-line bg-aurora-surface p-7">
            <h1 className="text-[21px] font-semibold tracking-tight text-aurora-fg">
              Tudo pronto, {nome.split(" ")[0] || ""}
            </h1>
            <p className="mb-2 text-[13px] leading-relaxed text-aurora-muted">
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
              <ReceiptRow
                label="Canal"
                value={[...channels].length > 0
                  ? [...channels].map((c) => CHANNEL_OPTIONS.find((o) => o.value === c)?.label ?? c).join(", ")
                  : "—"}
              />
              {wantsTelegram && (
                <ReceiptRow
                  label="Bot Telegram"
                  value={
                    telegramActive
                      ? "Ativo"
                      : props.telegramConnected || telegramToken
                      ? "Token recebido"
                      : "Pendente"
                  }
                  ok={telegramActive || props.telegramConnected || Boolean(telegramToken)}
                />
              )}
              {wantsWhatsapp && (
                <ReceiptRow
                  label="WhatsApp"
                  value={whatsappConnected ? "Vinculado" : "Aguardando código"}
                  ok={whatsappConnected}
                />
              )}
              {wantsTeams && (
                <ReceiptRow
                  label="Teams"
                  value={teamsConnected ? "Vinculado" : "Aguardando código"}
                  ok={teamsConnected}
                />
              )}
            </dl>
            <div
              className={`mt-5 flex items-center gap-2 rounded-lg px-3 py-2.5 text-[11.5px] font-bold tracking-wide ${
                telegramActive
                  ? "bg-aurora-ok/15 text-aurora-ok"
                  : telegramFailed
                  ? "bg-aurora-warn/15 text-aurora-warn"
                  : "bg-aurora-surface-2 text-aurora-muted"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  telegramActive
                    ? "bg-aurora-ok"
                    : telegramFailed
                    ? "bg-aurora-warn"
                    : "bg-aurora-muted-2"
                }`}
              />
              {telegramActive && (!wantsWhatsapp || whatsappConnected) && (!wantsTeams || teamsConnected)
                ? "Tudo ativo"
                : telegramActive
                ? "Telegram ativo"
                : telegramFailed
                ? "Telegram não ativou automaticamente"
                : wantsTelegram && !wantsWhatsapp && !wantsTeams
                ? "Telegram pronto pra ativar"
                : "Aguardando conexão de canal"}
            </div>
            {wantsTelegram && (
              <p className="text-[12.5px] leading-relaxed text-aurora-muted">
                {telegramActive
                  ? "Seu bot do Telegram já está ativo — pode mandar uma mensagem pra ele agora."
                  : telegramFailed
                  ? `Salvamos o token, mas não conseguimos ativar o bot automaticamente agora${telegramWebhookWarning ? ` (${telegramWebhookWarning})` : " (confere se colou certo)"} — quem administra a plataforma consegue finalizar manualmente.`
                  : "Falta colar o token do bot — volta aqui e conclui esse passo de novo com ele preenchido pra ativar."}
              </p>
            )}
            {wantsWhatsapp && (
              whatsappConnected ? (
                <div className="flex flex-col gap-1 rounded-lg border border-aurora-accent/35 bg-aurora-accent/[0.06] px-4 py-3">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-accent-text">
                    O número dela
                  </span>
                  <NumeroDaSecretaria />
                  <span className="text-[12.5px] leading-relaxed text-aurora-muted">
                    Seu WhatsApp já está vinculado — salva esse contato e manda
                    uma mensagem pra ela agora.
                  </span>
                </div>
              ) : !props.aprovado ? (
                // Sem aprovação o código não vincula (consumeWhatsAppLinkCode
                // recusa), então mostrar o código só faria a pessoa mandar
                // mensagem e ficar no vácuo.
                <p className="text-[12.5px] leading-relaxed text-aurora-muted">
                  O passo de conectar o WhatsApp abre assim que seu acesso for
                  liberado — a gente te avisa por e-mail.
                </p>
              ) : whatsappLinkCode ? (
                <div className="rounded-lg border border-aurora-accent/35 bg-aurora-accent/[0.06] px-4 py-3">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-accent-text">
                    Código de vínculo do WhatsApp
                  </span>
                  <p className="mt-1.5 font-mono text-2xl font-bold tracking-[0.2em] text-aurora-fg">
                    {whatsappLinkCode}
                  </p>
                  <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-aurora-accent-text">
                    Manda pra este número
                  </p>
                  <NumeroDaSecretaria />
                  <p className="mt-2 text-[12.5px] leading-relaxed text-aurora-muted">
                    O código vale por 30 minutos
                    {whatsappLinkCodeExpiresAt && (
                      <> (até {new Date(whatsappLinkCodeExpiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})</>
                    )}
                    . Se vencer, é só voltar aqui e concluir esse passo de novo pra gerar outro.
                  </p>
                </div>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-aurora-muted">
                  Não conseguimos gerar seu código de vínculo agora — volta aqui e conclui esse passo de novo.
                </p>
              )
            )}
            {wantsTeams && (
              teamsConnected ? (
                <p className="text-[12.5px] leading-relaxed text-aurora-muted">
                  Sua conta do Teams já está vinculada — pode chamar a Mia por lá agora.
                </p>
              ) : !props.aprovado ? (
                // Mesmo motivo do bloco do WhatsApp acima: sem aprovação o
                // código não vincula (consumeTeamsLinkCode recusa), então
                // mostrar o código só faria a pessoa mandar mensagem e ficar
                // no vácuo.
                <p className="text-[12.5px] leading-relaxed text-aurora-muted">
                  O passo de conectar o Teams abre assim que seu acesso for
                  liberado — a gente te avisa por e-mail.
                </p>
              ) : teamsLinkCode ? (
                <div className="rounded-lg border border-aurora-accent/35 bg-aurora-accent/[0.06] px-4 py-3">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-aurora-accent-text">
                    Código de vínculo do Teams
                  </span>
                  <p className="mt-1.5 font-mono text-2xl font-bold tracking-[0.2em] text-aurora-fg">
                    {teamsLinkCode}
                  </p>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-aurora-muted">
                    Manda esse código numa mensagem pro bot da Mia no Teams. O código vale por 30 minutos
                    {teamsLinkCodeExpiresAt && (
                      <> (até {new Date(teamsLinkCodeExpiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})</>
                    )}
                    . Se vencer, é só voltar aqui e concluir esse passo de novo pra gerar outro.
                  </p>
                </div>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-aurora-muted">
                  Não conseguimos gerar seu código de vínculo do Teams agora — volta aqui e conclui esse passo de novo.
                </p>
              )
            )}
            <p className="mt-3 text-xs text-aurora-muted-2">Seu identificador: {props.slug}</p>
            {props.isPlatformOwner && (
              // Único caminho na interface pra chegar no /admin — sem isto, a
              // URL só era alcançável de cor. É onde quem administra a
              // plataforma aprova (ou recusa) todo cadastro novo.
              <a
                href="/admin"
                className="mt-2 self-start text-xs text-aurora-accent-text underline underline-offset-2"
              >
                Painel de administração
              </a>
            )}
            <button
              onClick={() => {
                setFinished(false);
                setStep(1);
              }}
              className="mt-4 self-start text-xs text-aurora-accent-text underline underline-offset-2"
            >
              Editar configuração
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

// O portão de aprovação existe porque, enquanto não há cobrança, qualquer um
// que descobrisse o link se cadastrava e passava a consumir API paga no número
// compartilhado. O bloqueio real mora no backend (_shared/tenant.ts e
// telegram/index.ts) — este aviso só explica pra pessoa o que está havendo, em
// vez de deixá-la mandando mensagem pra uma secretária que nunca responde.
// Número compartilhado da plataforma. Se a env var não estiver setada no build,
// não mostra número nenhum em vez de mostrar um placeholder — texto genérico
// confunde menos do que um número errado.
function NumeroDaSecretaria() {
  if (!WHATSAPP_NUMERO) {
    return (
      <span className="text-[12.5px] leading-relaxed text-aurora-muted">
        O número oficial da plataforma foi enviado no seu e-mail de boas-vindas.
      </span>
    );
  }
  return (
    <a
      href={WHATSAPP_LINK ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[19px] font-bold tracking-tight text-aurora-fg underline decoration-aurora-accent/40 underline-offset-4"
    >
      {WHATSAPP_NUMERO}
    </a>
  );
}

function AvisoAprovacao({ recusado }: { recusado: boolean }) {
  if (recusado) {
    return (
      <section className="mt-4 flex flex-col gap-1.5 rounded-[16px] border border-aurora-line bg-aurora-surface-2 px-5 py-4">
        <span className="text-[13.5px] font-semibold text-aurora-fg">
          Seu acesso não foi liberado
        </span>
        <span className="text-[12.5px] leading-relaxed text-aurora-muted">
          A secretária está em beta fechado e não conseguimos abrir uma vaga pra
          você agora. Sua configuração fica salva — se abrir espaço, a gente
          avisa por e-mail.
        </span>
      </section>
    );
  }
  return (
    <section className="mt-4 flex flex-col gap-1.5 rounded-[16px] border border-aurora-warn/30 bg-aurora-warn/[0.06] px-5 py-4">
      <span className="text-[13.5px] font-semibold text-aurora-fg">
        Seu acesso está em análise
      </span>
      <span className="text-[12.5px] leading-relaxed text-aurora-muted">
        A secretária está em beta fechado, com vagas limitadas. Pode configurar
        tudo por aqui normalmente — assim que liberarmos seu acesso, o passo de
        conectar o WhatsApp aparece e ela começa a responder.
      </span>
    </section>
  );
}

function ProviderOption({
  opt,
  selected,
  recommended,
  recommendedLabel,
  onSelect,
}: {
  opt: (typeof PROVIDER_OPTIONS)[number];
  selected: boolean;
  recommended?: boolean;
  recommendedLabel?: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-4 py-3 transition ${
        selected ? "border-aurora-accent bg-aurora-surface-2" : "border-aurora-line hover:border-aurora-line-soft"
      }`}
    >
      <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-aurora-fg">
        <input type="radio" name="provider" checked={selected} onChange={onSelect} className="accent-aurora-accent" />
        {opt.label}
        {recommended && recommendedLabel && (
          <span className="rounded-md bg-aurora-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-aurora-accent-text">
            {recommendedLabel}
          </span>
        )}
      </span>
      <span className="pl-[23px] text-xs text-aurora-muted">{opt.hint}</span>
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
    <div className="flex items-baseline justify-between border-b border-aurora-line-soft py-2.5 text-[12.5px] last:border-none">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-aurora-muted-2">{label}</dt>
      <dd className={`font-medium ${ok ? "text-aurora-ok" : "text-aurora-fg"}`}>{value}</dd>
    </div>
  );
}

function StepTabs({ step, onSelect }: { step: Step; onSelect: (s: Step) => void }) {
  const labels: Array<[Step, string]> = [[1, "Você"], [2, "Tarefas"], [3, "Canal"], [4, "Pronto"]];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map(([n, label]) => {
        const current = n === step;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onSelect(n)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition ${
              current
                ? "border-aurora-line bg-aurora-surface-2 text-aurora-accent-text"
                : "border-transparent text-aurora-muted-2 hover:text-aurora-muted"
            }`}
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-[5px] text-[10px] ${
                current ? "bg-aurora-accent text-aurora-accent-ink" : "bg-aurora-surface-2 text-aurora-muted-2"
              }`}
            >
              {n}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
