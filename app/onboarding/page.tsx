import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import OnboardingWizard from "./wizard";
import { semDadoPessoal } from "@/lib/log-seguro";
import { normalizaPersonalidade } from "@/lib/personalidade";
import { carregaDonoDaPlataforma } from "@/lib/admin-guard";

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "";
}

// Server Component: carrega o tenant já criado no /auth/callback e entrega
// pro wizard (Client Component) como estado inicial. Não cria a linha aqui —
// isso é responsabilidade única do callback (ver lib/tenant-provisioning.ts).
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ link_error?: string; step?: string }>;
}) {
  const { link_error: linkError, step: stepParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceClient();
  const { data: tenant, error } = await admin
    .from("tenants")
    .select("slug, nome, cargo, frentes, is_platform_owner, usa_vocativo, tratamento, personalidade, envio_oficial, aprovado_em, recusado_em, task_provider, task_provider_list_map, trello_api_key_secret_id, google_refresh_token_secret_id, outlook_refresh_token_secret_id, channel_preference, telegram_bot_token_secret_id, whatsapp_authorized_number, whatsapp_link_code, whatsapp_link_code_expires_at, teams_authorized_user_id, teams_link_code, teams_link_code_expires_at, resposta_audio_sempre")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error || !tenant) {
    // Registra o motivo REAL. Sem isto, uma chave de service role inválida, uma
    // coluna faltando e um tenant inexistente produzem a mesma tela genérica —
    // foi o que fez o diagnóstico de 10/08/2026 demorar horas.
    console.error(
      `[onboarding] tenant não carregado (auth_user_id=${user.id}):`,
      error ? `${error.code ?? "sem código"} — ${semDadoPessoal(error.message)}` : "nenhuma linha encontrada",
    );
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Não encontramos sua configuração ainda</h1>
        <p className="max-w-md text-muted">
          Isso pode acontecer se o login foi interrompido no meio. Tenta entrar de novo?
        </p>
        <a href="/login" className="text-cyan underline">Voltar pro login</a>
      </main>
    );
  }

  // Quem já foi aprovado tem casa própria em /app — o wizard só reabre se for
  // pra editar algo específico (link com ?step=), não como destino padrão.
  if (tenant.aprovado_em && !stepParam) redirect("/app");

  const stepNumero = Number(stepParam);
  const initialStep = [1, 2, 3, 4].includes(stepNumero) ? (stepNumero as 1 | 2 | 3 | 4) : undefined;

  // Código pendente só é válido se ainda não venceu — mesma regra de
  // consumeWhatsAppLinkCode/consumeTeamsLinkCode no backend
  // (supabase/functions/_shared/tenant.ts).
  const pendingCodeValid = Boolean(
    tenant.whatsapp_link_code &&
    tenant.whatsapp_link_code_expires_at &&
    new Date(tenant.whatsapp_link_code_expires_at) > new Date(),
  );
  const pendingTeamsCodeValid = Boolean(
    tenant.teams_link_code &&
    tenant.teams_link_code_expires_at &&
    new Date(tenant.teams_link_code_expires_at) > new Date(),
  );

  // channel_preference virou texto livre ("whatsapp,teams") desde que o
  // passo 3 passou a ser múltipla escolha — sem enum fechado pra validar,
  // então filtra pros 3 valores que o wizard reconhece.
  const VALID_CHANNELS = new Set(["whatsapp", "telegram", "teams"]);
  const initialChannels = String(tenant.channel_preference ?? "")
    .split(",")
    .map((c: string) => c.trim())
    .filter((c: string) => VALID_CHANNELS.has(c));

  // Mesmo cálculo de app/app/page.tsx — o AppHeader é compartilhado entre as
  // duas telas, então o badge de pendentes precisa existir aqui também.
  const isPlatformOwner = Boolean(tenant.is_platform_owner);
  let pendentes = 0;
  if (isPlatformOwner) {
    const dono = await carregaDonoDaPlataforma();
    if (dono) {
      const { count } = await admin
        .from("tenants")
        .select("slug", { count: "exact", head: true })
        .eq("active", true)
        .is("aprovado_em", null)
        .is("recusado_em", null);
      pendentes = count ?? 0;
    }
  }

  return (
    <OnboardingWizard
      slug={tenant.slug}
      email={user.email ?? ""}
      userLabel={primeiroNome(tenant.nome ?? "") || user.email || ""}
      pendentes={pendentes}
      initialStep={initialStep}
      initialNome={tenant.nome ?? ""}
      initialCargo={tenant.cargo ?? ""}
      initialFrentes={(tenant.frentes ?? []).join(", ")}
      aprovado={Boolean(tenant.aprovado_em)}
      recusado={Boolean(tenant.recusado_em)}
      isPlatformOwner={isPlatformOwner}
      initialUsaVocativo={tenant.usa_vocativo ?? true}
      initialTratamento={tenant.tratamento ?? ""}
      initialPersonalidade={normalizaPersonalidade(tenant.personalidade)}
      initialEnvioOficial={Boolean(tenant.envio_oficial)}
      // Env var de RUNTIME, sem NEXT_PUBLIC_: liberar o envio depois da
      // verificação na Meta passa a ser mudar a variável no Netlify, sem
      // precisar de build novo (NEXT_PUBLIC_* é resolvida em tempo de build).
      envioOficialDisponivel={Boolean(process.env.ENVIO_OFICIAL_DISPONIVEL)}
      initialProvider={(tenant.task_provider ?? "google_tasks") as "clickup" | "notion" | "trello" | "google_tasks" | "microsoft_todo"}
      googleConnected={Boolean(tenant.google_refresh_token_secret_id)}
      outlookConnected={Boolean(tenant.outlook_refresh_token_secret_id)}
      linkError={linkError ?? null}
      initialChannels={initialChannels as ("whatsapp" | "telegram" | "teams")[]}
      telegramConnected={Boolean(tenant.telegram_bot_token_secret_id)}
      trelloApiKeyConfigured={Boolean(tenant.trello_api_key_secret_id)}
      whatsappConnected={Boolean(tenant.whatsapp_authorized_number)}
      initialWhatsappLinkCode={pendingCodeValid ? tenant.whatsapp_link_code : null}
      initialWhatsappLinkCodeExpiresAt={pendingCodeValid ? tenant.whatsapp_link_code_expires_at : null}
      teamsConnected={Boolean(tenant.teams_authorized_user_id)}
      initialTeamsLinkCode={pendingTeamsCodeValid ? tenant.teams_link_code : null}
      initialTeamsLinkCodeExpiresAt={pendingTeamsCodeValid ? tenant.teams_link_code_expires_at : null}
      initialRespostaAudioSempre={Boolean(tenant.resposta_audio_sempre)}
    />
  );
}
