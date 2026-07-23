import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import OnboardingWizard from "./wizard";

// Server Component: carrega o tenant já criado no /auth/callback e entrega
// pro wizard (Client Component) como estado inicial. Não cria a linha aqui —
// isso é responsabilidade única do callback (ver lib/tenant-provisioning.ts).
export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createServiceClient();
  const { data: tenant, error } = await admin
    .from("tenants")
    .select("slug, nome, cargo, frentes, task_provider, task_provider_list_map, trello_api_key_secret_id, google_refresh_token_secret_id, channel_preference, telegram_bot_token_secret_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error || !tenant) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="font-display text-xl font-extrabold text-foreground">Não encontramos sua configuração ainda</h1>
        <p className="max-w-md text-muted">
          Isso pode acontecer se o login foi interrompido no meio. Tenta entrar de novo?
        </p>
        <a href="/login" className="text-cyan underline">Voltar pro login</a>
      </main>
    );
  }

  return (
    <OnboardingWizard
      slug={tenant.slug}
      email={user.email ?? ""}
      initialNome={tenant.nome ?? ""}
      initialCargo={tenant.cargo ?? ""}
      initialFrentes={(tenant.frentes ?? []).join(", ")}
      initialProvider={(tenant.task_provider ?? "google_tasks") as "clickup" | "notion" | "trello" | "google_tasks"}
      googleConnected={Boolean(tenant.google_refresh_token_secret_id)}
      initialChannelPreference={tenant.channel_preference as "whatsapp" | "telegram" | "both" | null}
      telegramConnected={Boolean(tenant.telegram_bot_token_secret_id)}
      trelloApiKeyConfigured={Boolean(tenant.trello_api_key_secret_id)}
    />
  );
}
