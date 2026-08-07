import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { upsertTenantSecret } from "@/lib/tenant-provisioning";

const VALID_CHANNELS = new Set(["whatsapp", "telegram", "both"]);
const TELEGRAM_API = "https://api.telegram.org";

// Mesmo alfabeto/tamanho/TTL de createWhatsAppLinkCode em
// supabase/functions/_shared/tenant.ts — duplicado aqui porque o wizard
// (Next.js/Node) não importa código Deno das edge functions diretamente.
// Sem 0/O/1/I — evita confusão ao ler/digitar o código no WhatsApp.
const WHATSAPP_LINK_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const WHATSAPP_LINK_CODE_LENGTH = 6;
const WHATSAPP_LINK_CODE_TTL_MIN = 30;

function generateWhatsAppLinkCode(): string {
  let code = "";
  for (let i = 0; i < WHATSAPP_LINK_CODE_LENGTH; i++) {
    code += WHATSAPP_LINK_CODE_ALPHABET[Math.floor(Math.random() * WHATSAPP_LINK_CODE_ALPHABET.length)];
  }
  return code;
}

/** Confirma que o token é válido antes de salvar — evita persistir um token colado errado. */
async function validateTelegramToken(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/getMe`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description ?? "token rejeitado pelo Telegram" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "não conseguimos falar com a API do Telegram — tenta de novo?" };
  }
}

// Registra o webhook do bot direto na API do Telegram, apontando pra URL
// tenant-scoped que o secretaria-agentic já sabe rotear (telegram/index.ts
// extrai o slug do fim do path). Mesmo host das edge functions da mesma
// instância Supabase usada pro resto do app — sem env var nova.
async function registerTelegramWebhook(token: string, slug: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const functionsOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  const webhookUrl = `${functionsOrigin}/functions/v1/telegram/${slug}`;
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.description ?? "Telegram recusou o webhook" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
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
    .select("id, slug, telegram_bot_token_secret_id, whatsapp_authorized_number")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (loadErr || !tenant) {
    return NextResponse.json(
      { error: "tenant não encontrado — complete os passos anteriores primeiro" },
      { status: 404 },
    );
  }

  if (telegramToken) {
    const valid = await validateTelegramToken(telegramToken);
    if (!valid.ok) {
      return NextResponse.json({ error: `Token do Telegram inválido: ${valid.error}` }, { status: 400 });
    }
  }

  let telegramSecretId = tenant.telegram_bot_token_secret_id as string | null;
  try {
    if (telegramToken) {
      telegramSecretId = await upsertTenantSecret(admin, telegramSecretId, telegramToken, `telegram_bot_${tenant.id}`);
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const wantsWhatsapp = channelPreference === "whatsapp" || channelPreference === "both";
  const alreadyAuthorized = Boolean(tenant.whatsapp_authorized_number);

  // Gera um código novo (substituindo qualquer pendente) toda vez que o
  // passo é concluído pedindo WhatsApp e o número ainda não está vinculado —
  // mesma regra de createWhatsAppLinkCode no backend.
  let whatsappLinkCode: string | null = null;
  let whatsappLinkCodeExpiresAt: string | null = null;
  if (wantsWhatsapp && !alreadyAuthorized) {
    whatsappLinkCode = generateWhatsAppLinkCode();
    whatsappLinkCodeExpiresAt = new Date(Date.now() + WHATSAPP_LINK_CODE_TTL_MIN * 60_000).toISOString();
  }

  const { error } = await admin
    .from("tenants")
    .update({
      channel_preference: channelPreference,
      telegram_bot_token_secret_id: telegramSecretId,
      ...(wantsWhatsapp && !alreadyAuthorized
        ? { whatsapp_link_code: whatsappLinkCode, whatsapp_link_code_expires_at: whatsappLinkCodeExpiresAt }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Só tenta registrar quando um token NOVO foi colado agora — não temos o
  // valor em claro de um token já salvo antes (fica só no Vault), e não
  // precisa: o webhook de uma sessão anterior continua valendo.
  let telegramWebhook: "registered" | "failed" | "skipped" = "skipped";
  let telegramWebhookWarning: string | null = null;
  if (telegramToken) {
    const webhook = await registerTelegramWebhook(telegramToken, tenant.slug);
    if (webhook.ok) {
      telegramWebhook = "registered";
    } else {
      telegramWebhook = "failed";
      telegramWebhookWarning = webhook.error;
    }
  }

  return NextResponse.json({
    ok: true,
    telegram_webhook: telegramWebhook,
    telegram_webhook_warning: telegramWebhookWarning,
    whatsapp_already_linked: wantsWhatsapp && alreadyAuthorized,
    whatsapp_link_code: whatsappLinkCode,
    whatsapp_link_code_expires_at: whatsappLinkCodeExpiresAt,
  });
}
