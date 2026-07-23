import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { upsertTenantSecret } from "@/lib/tenant-provisioning";

const VALID_CHANNELS = new Set(["whatsapp", "telegram", "both"]);

// Registra o webhook do bot direto na API do Telegram, apontando pra URL
// tenant-scoped que o secretaria-agentic já sabe rotear (telegram/index.ts
// extrai o slug do fim do path). Mesmo host das edge functions da mesma
// instância Supabase usada pro resto do app — sem env var nova.
async function registerTelegramWebhook(token: string, slug: string): Promise<boolean> {
  const functionsOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  const webhookUrl = `${functionsOrigin}/functions/v1/telegram/${slug}`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await res.json().catch(() => null);
    return res.ok && Boolean(data?.ok);
  } catch (err) {
    console.error("[onboarding/channel] setWebhook falhou:", String(err));
    return false;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: { channel_preference?: unknown; telegram_bot_token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const channelPreference = typeof body.channel_preference === "string" ? body.channel_preference : "";
  if (!VALID_CHANNELS.has(channelPreference)) {
    return NextResponse.json({ error: `canal inválido: '${channelPreference}'` }, { status: 400 });
  }

  const wantsTelegram = channelPreference === "telegram" || channelPreference === "both";
  const telegramToken = wantsTelegram && typeof body.telegram_bot_token === "string"
    ? body.telegram_bot_token.trim()
    : "";

  const admin = createServiceClient();
  const { data: tenant, error: loadErr } = await admin
    .from("tenants")
    .select("id, slug, telegram_bot_token_secret_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (loadErr || !tenant) {
    return NextResponse.json(
      { error: "tenant não encontrado — complete os passos anteriores primeiro" },
      { status: 404 },
    );
  }

  let telegramSecretId = tenant.telegram_bot_token_secret_id as string | null;
  try {
    if (telegramToken) {
      telegramSecretId = await upsertTenantSecret(admin, telegramSecretId, telegramToken, `telegram_bot_${tenant.id}`);
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const { error } = await admin
    .from("tenants")
    .update({
      channel_preference: channelPreference,
      telegram_bot_token_secret_id: telegramSecretId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Só tenta registrar quando um token NOVO foi colado agora — não temos o
  // valor em claro de um token já salvo antes (fica só no Vault), e não
  // precisa: o webhook de uma sessão anterior continua valendo.
  const telegramWebhook = telegramToken
    ? (await registerTelegramWebhook(telegramToken, tenant.slug) ? "registered" : "failed")
    : "skipped";

  return NextResponse.json({ ok: true, telegram_webhook: telegramWebhook });
}
