import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import OnboardingWizard from "./wizard";
import { semDadoPessoal } from "@/lib/log-seguro";
import { normalizaPersonalidade } from "@/lib/personalidade";

// Server Component: carrega o tenant já criado no /auth/callback e entrega
// pro wizard (Client Component) como estado inicial. Não cria a linha aqui —
// isso é responsabilidade única do callback (ver lib/tenant-provisioning.ts).
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ link_error?: string }>;
}) {
  const { link_error: linkError } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceClient();
  const { data: tenant, error } = await admin
    .from("tenants")
    .select("slug, nome, cargo, frentes, usa_vocativo, tratamento, personalidade, aprovado_em, recusado_em, task_provider, task_provider_list_map, trello_api_key_secret_id, google_refresh_token_secret_id, outlook_refresh_token_secret_id, channel_preference, telegram_bot_token_secret_id, whatsapp_authorized_number, whatsapp_link_code, whatsapp_link_code_expires_at")
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

  // Código pendente só é válido se ainda não venceu — mesma regra de
  // consumeWhatsAppLinkCode no backend (supabase/functions/_shared/tenant.ts).
  const pendingCodeValid = Boolean(
    tenant.whatsapp_link_code &&
    tenant.whatsapp_link_code_expires_at &&
    new Date(tenant.whatsapp_link_code_expires_at) > new Date(),
  );

  return (
    <OnboardingWizard
      slug={tenant.slug}
      email={user.email ?? ""}
      initialNome={tenant.nome ?? ""}
      initialCargo={tenant.cargo ?? ""}
      initialFrentes={(tenant.frentes ?? []).join(", ")}
      aprovado={Boolean(tenant.aprovado_em)}
      recusado={Boolean(tenant.recusado_em)}
      initialUsaVocativo={tenant.usa_vocativo ?? true}
      initialTratamento={tenant.tratamento ?? ""}
      initialPersonalidade={normalizaPersonalidade(tenant.personalidade)}
      initialProvider={(tenant.task_provider ?? "google_tasks") as "clickup" | "notion" | "trello" | "google_tasks"}
      googleConnected={Boolean(tenant.google_refresh_token_secret_id)}
      outlookConnected={Boolean(tenant.outlook_refresh_token_secret_id)}
      linkError={linkError ?? null}
      initialChannelPreference={tenant.channel_preference as "whatsapp" | "telegram" | "both" | null}
      telegramConnected={Boolean(tenant.telegram_bot_token_secret_id)}
      trelloApiKeyConfigured={Boolean(tenant.trello_api_key_secret_id)}
      whatsappConnected={Boolean(tenant.whatsapp_authorized_number)}
      initialWhatsappLinkCode={pendingCodeValid ? tenant.whatsapp_link_code : null}
      initialWhatsappLinkCodeExpiresAt={pendingCodeValid ? tenant.whatsapp_link_code_expires_at : null}
    />
  );
}
