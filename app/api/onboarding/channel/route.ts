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

// Gerador CRIPTOGRÁFICO (não Math.random): este código é o ÚNICO fator que
// autoriza um telefone a assumir uma conta, e não há limite de tentativas.
// Mesma implementação de generateWhatsAppLinkCode em
// supabase/functions/_shared/tenant.ts — o módulo descarta a cauda incompleta
// do byte pra não enviesar as primeiras letras do alfabeto.
function generateWhatsAppLinkCode(): string {
  const limite = 256 - (256 % WHATSAPP_LINK_CODE_ALPHABET.length);
  let code = "";
  while (code.length < WHATSAPP_LINK_CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(WHATSAPP_LINK_CODE_LENGTH));
    for (const b of bytes) {
      if (b >= limite) continue;
      code += WHATSAPP_LINK_CODE_ALPHABET[b % WHATSAPP_LINK_CODE_ALPHABET.length];
      if (code.length === WHATSAPP_LINK_CODE_LENGTH) break;
    }
  }
  return code;
}

// Alfabeto do secret_token do webhook do Telegram (regra da própria API:
// só A-Z, a-z, 0-9, "_", "-", 1-256 chars). 64 símbolos == potência de 2 —
// byte % 64 é uniforme sem precisar descartar cauda, ao contrário do
// alfabeto de 33 símbolos do código de vínculo do WhatsApp acima.
const TELEGRAM_SECRET_TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const TELEGRAM_SECRET_TOKEN_LENGTH = 32;

// Segredo que o Telegram devolve em toda chamada de webhook (header
// X-Telegram-Bot-Api-Secret-Token) — é o que permite ao telegram/index.ts
// distinguir uma chamada real do Telegram de qualquer um que descubra a URL.
function generateTelegramWebhookSecret(): string {
  let secret = "";
  while (secret.length < TELEGRAM_SECRET_TOKEN_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(TELEGRAM_SECRET_TOKEN_LENGTH));
    for (const b of bytes) {
      secret += TELEGRAM_SECRET_TOKEN_ALPHABET[b % TELEGRAM_SECRET_TOKEN_ALPHABET.length];
      if (secret.length === TELEGRAM_SECRET_TOKEN_LENGTH) break;
    }
  }
  return secret;
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
async function registerTelegramWebhook(
  token: string,
  slug: string,
  secretToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const functionsOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  const webhookUrl = `${functionsOrigin}/functions/v1/telegram/${slug}`;
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, secret_token: secretToken }),
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
    .select("id, slug, telegram_bot_token_secret_id, telegram_webhook_secret_id, whatsapp_authorized_number")
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
  let telegramWebhookSecretId = tenant.telegram_webhook_secret_id as string | null;
  // O valor em claro só existe aqui, no momento de gerar — depois disso vive
  // só no Vault e no cabeçalho que o Telegram devolve. Gerado de novo a cada
  // vez que um token é (re)salvo, junto com o novo registro do webhook —
  // não precisa persistir entre sessões, e rotacionar é de graça. O chat_id
  // autorizado (telegram_authorized_chat_id) não é afetado por isso: chat_id
  // identifica a PESSOA, é o mesmo em qualquer bot que ela use.
  let telegramWebhookSecretValue: string | null = null;
  try {
    if (telegramToken) {
      telegramSecretId = await upsertTenantSecret(admin, telegramSecretId, telegramToken, `telegram_bot_${tenant.id}`);
      telegramWebhookSecretValue = generateTelegramWebhookSecret();
      telegramWebhookSecretId = await upsertTenantSecret(
        admin,
        telegramWebhookSecretId,
        telegramWebhookSecretValue,
        `telegram_webhook_${tenant.id}`,
      );
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
      telegram_webhook_secret_id: telegramWebhookSecretId,
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
  if (telegramToken && telegramWebhookSecretValue) {
    const webhook = await registerTelegramWebhook(telegramToken, tenant.slug, telegramWebhookSecretValue);
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
