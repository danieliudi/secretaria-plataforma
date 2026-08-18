import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { upsertTenantSecret } from "@/lib/tenant-provisioning";
import { dispararTarefaCron } from "@/lib/cron-call";

const VALID_CHANNELS = new Set(["whatsapp", "telegram", "teams"]);
const TELEGRAM_API = "https://api.telegram.org";

// Mesmo alfabeto/tamanho/TTL de generateLinkCode em supabase/functions/_shared/tenant.ts
// — duplicado aqui porque o wizard (Next.js/Node) não importa código Deno das
// edge functions diretamente. Sem 0/O/1/I — evita confusão ao ler/digitar o
// código no WhatsApp/Teams. Usado tanto pro WhatsApp quanto pro Teams: os
// dois autorizam por "código de vínculo de 6 letras", mesmo esquema.
const LINK_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LINK_CODE_LENGTH = 6;
const LINK_CODE_TTL_MIN = 30;

// Gerador CRIPTOGRÁFICO (não Math.random): este código é o ÚNICO fator que
// autoriza um telefone/conta a assumir um tenant, e não há limite de tentativas.
// Mesma implementação de generateLinkCode em supabase/functions/_shared/tenant.ts
// — o módulo descarta a cauda incompleta do byte pra não enviesar as
// primeiras letras do alfabeto.
function generateLinkCode(): string {
  const limite = 256 - (256 % LINK_CODE_ALPHABET.length);
  let code = "";
  while (code.length < LINK_CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(LINK_CODE_LENGTH));
    for (const b of bytes) {
      if (b >= limite) continue;
      code += LINK_CODE_ALPHABET[b % LINK_CODE_ALPHABET.length];
      if (code.length === LINK_CODE_LENGTH) break;
    }
  }
  return code;
}

// Alfabeto do secret_token do webhook do Telegram (regra da própria API:
// só A-Z, a-z, 0-9, "_", "-", 1-256 chars). 64 símbolos == potência de 2 —
// byte % 64 é uniforme sem precisar descartar cauda, ao contrário do
// alfabeto de 33 símbolos do código de vínculo acima.
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

  let body: {
    channels?: unknown;
    telegram_bot_token?: unknown;
    envio_oficial?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Múltipla escolha (decisão de 18/08/2026: cada canal já vincula
  // independente no banco, não faz sentido mais um único enum "whatsapp
  // | telegram | both") — array com pelo menos 1 canal válido.
  const channelsRaw = Array.isArray(body.channels) ? body.channels : [];
  const channels = [...new Set(channelsRaw.filter((c): c is string => typeof c === "string" && VALID_CHANNELS.has(c)))];
  if (channels.length === 0) {
    return NextResponse.json({ error: "escolhe pelo menos 1 canal" }, { status: 400 });
  }

  // Envio automático pela API oficial. Só aceita `true` quando a plataforma
  // está de fato configurada com a Meta — sem isso o tenant ligaria uma opção
  // que nunca faria nada, e a tela mostraria um estado que o backend não honra.
  // O portão real continua em _shared/envio-decisao.ts, que verifica credencial
  // a cada mensagem; este aqui só evita gravar intenção impossível.
  const envioDisponivel = Boolean(process.env.ENVIO_OFICIAL_DISPONIVEL);
  const envioOficial = envioDisponivel && body.envio_oficial === true;

  const wantsTelegram = channels.includes("telegram");
  const wantsWhatsapp = channels.includes("whatsapp");
  const wantsTeams = channels.includes("teams");

  const telegramToken = wantsTelegram && typeof body.telegram_bot_token === "string"
    ? body.telegram_bot_token.trim()
    : "";

  const admin = createServiceClient();
  const { data: tenant, error: loadErr } = await admin
    .from("tenants")
    .select(
      "id, slug, telegram_bot_token_secret_id, telegram_webhook_secret_id, whatsapp_authorized_number, teams_authorized_user_id, aprovado_em, avisado_em",
    )
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

  // Gera um código novo (substituindo qualquer pendente) toda vez que o passo
  // é concluído pedindo um canal por-código que ainda não está vinculado —
  // mesma regra de createWhatsAppLinkCode/createTeamsLinkCode no backend.
  const whatsappAlreadyAuthorized = Boolean(tenant.whatsapp_authorized_number);
  const teamsAlreadyAuthorized = Boolean(tenant.teams_authorized_user_id);

  let whatsappLinkCode: string | null = null;
  let whatsappLinkCodeExpiresAt: string | null = null;
  if (wantsWhatsapp && !whatsappAlreadyAuthorized) {
    whatsappLinkCode = generateLinkCode();
    whatsappLinkCodeExpiresAt = new Date(Date.now() + LINK_CODE_TTL_MIN * 60_000).toISOString();
  }

  let teamsLinkCode: string | null = null;
  let teamsLinkCodeExpiresAt: string | null = null;
  if (wantsTeams && !teamsAlreadyAuthorized) {
    teamsLinkCode = generateLinkCode();
    teamsLinkCodeExpiresAt = new Date(Date.now() + LINK_CODE_TTL_MIN * 60_000).toISOString();
  }

  const { error } = await admin
    .from("tenants")
    .update({
      // Texto livre agora (sem CHECK de enum) — só pra exibição em
      // cron/index.ts e /admin. Quem autoriza de verdade é cada coluna
      // própria (whatsapp_authorized_number / telegram_authorized_chat_id /
      // teams_authorized_user_id).
      channel_preference: channels.join(","),
      envio_oficial: envioOficial,
      telegram_bot_token_secret_id: telegramSecretId,
      telegram_webhook_secret_id: telegramWebhookSecretId,
      ...(wantsWhatsapp && !whatsappAlreadyAuthorized
        ? { whatsapp_link_code: whatsappLinkCode, whatsapp_link_code_expires_at: whatsappLinkCodeExpiresAt }
        : {}),
      ...(wantsTeams && !teamsAlreadyAuthorized
        ? { teams_link_code: teamsLinkCode, teams_link_code_expires_at: teamsLinkCodeExpiresAt }
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

  // Este é o último passo do wizard — é aqui que "terminou o cadastro"
  // acontece de verdade, e não no primeiro login (onde só existe o e-mail).
  //
  // AGUARDADO de propósito, ao contrário do que o comentário antigo aqui
  // dizia: numa function serverless, uma promessa solta (`void`) corre risco
  // real de o container congelar antes do fetch sair, e o aviso simplesmente
  // não acontece — sem erro, sem log, sem retry. dispararTarefaCron já é
  // best-effort (nunca lança, tem timeout de 8s) — aguardar só troca "talvez
  // nunca saia" por "no pior caso, +8s neste POST".
  //
  // O guard abaixo (!avisado_em) não evita disparo duplicado por si só — o
  // corpo real do cadastro pode reenviar este passo em paralelo antes que
  // avisado_em seja gravado. A trava contra duplicata mora do lado do cron,
  // que reivindica cada tenant pendente com UPDATE condicional antes de
  // enviar (ver runNovosCadastros) — chamar a task de mais é seguro, ela só
  // encontra `avisado_em` já preenchido e não faz nada.
  if (!tenant.aprovado_em && !tenant.avisado_em) {
    await dispararTarefaCron("novos_cadastros");
  }

  return NextResponse.json({
    ok: true,
    telegram_webhook: telegramWebhook,
    telegram_webhook_warning: telegramWebhookWarning,
    whatsapp_already_linked: wantsWhatsapp && whatsappAlreadyAuthorized,
    whatsapp_link_code: whatsappLinkCode,
    whatsapp_link_code_expires_at: whatsappLinkCodeExpiresAt,
    teams_already_linked: wantsTeams && teamsAlreadyAuthorized,
    teams_link_code: teamsLinkCode,
    teams_link_code_expires_at: teamsLinkCodeExpiresAt,
  });
}
