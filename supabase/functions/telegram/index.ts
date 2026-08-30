import { getSupabaseClient } from "../_shared/supabase.ts";
import { callFastEndpoint } from "../_shared/fast-proxy.ts";
import {
  getTelegramFileBytes,
  sendTelegramChatAction,
  sendTelegramMessages,
  sendTelegramVoice,
  splitMessages,
  type TelegramDeps,
} from "../_shared/telegram.ts";
import { deveResponderEmAudio } from "../_shared/audio-reply.ts";
import { synthesizeSpeech } from "../_shared/google-tts.ts";
import { transcribeAudio } from "../_shared/transcribe.ts";
import { describeImage, imageMediaType } from "../_shared/vision.ts";
import { describePdf, PdfInvalidoError, PdfLimiteExcedidoError, verificaTamanhoDeclarado } from "../_shared/pdf.ts";
import {
  ImportLimiteExcedidoError,
  registrarImportacao,
  verificaTamanhoDeclaradoImportacao,
} from "../fast/tools/importacao.ts";
import type { Decision } from "../_shared/types.ts";
import { apelidoDeUsuario, semDadoPessoal } from "../_shared/log-seguro.ts";
import {
  authorizeTelegramChatId,
  buildTenantEnv,
  getTelegramWebhookSecret,
  getTenantBySlug,
  type Tenant,
} from "../_shared/tenant.ts";

const FAST_BG_TIMEOUT_MS = 90_000;

/** Teto do corpo. Update do Telegram é pequeno (texto cabe em 4096 chars);
 * o excedente é ruído ou abuso. Ver _shared/corpo-limitado.ts. */
const MAX_CORPO = 256 * 1024;

// Comparação em tempo constante — mesmo padrão de comparaSeguro em
// _shared/internal-auth.ts, duplicado aqui pra não acoplar os dois módulos
// por uma função de 8 linhas.
function compareTimingSafe(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

const DEFAULT_DECISION: Decision = {
  tier: "fast",
  frente: "pessoal",
  domain: "outro",
  action_required: false,
  irreversible: false,
  confidence: 0.95,
};

interface TgPhotoSize { file_id: string; width: number; height: number; file_size?: number; }
interface TgDocument { file_id: string; file_name?: string; mime_type?: string; file_size?: number; }

function isPdfDocument(doc?: TgDocument): boolean {
  if (!doc) return false;
  if (doc.mime_type === "application/pdf") return true;
  return (doc.file_name ?? "").toLowerCase().endsWith(".pdf");
}

function isCsvDocument(doc?: TgDocument): boolean {
  if (!doc) return false;
  if (doc.mime_type === "text/csv") return true;
  return (doc.file_name ?? "").toLowerCase().endsWith(".csv");
}

/**
 * Manda a resposta em áudio (se decidido) ou texto (padrão) — se a síntese ou
 * o envio de áudio falhar por qualquer motivo, cai pra texto em vez de
 * deixar a pessoa sem resposta nenhuma. Mesmo padrão de
 * reflex/index.ts:entregarRespostaWhatsApp.
 */
async function entregarRespostaTelegram(
  chatId: number,
  mensagem: string,
  emAudio: boolean,
  deps: TelegramDeps,
): Promise<void> {
  if (emAudio) {
    try {
      const audio = await synthesizeSpeech(mensagem, deps);
      await sendTelegramVoice(chatId, audio, deps);
      return;
    } catch (err) {
      console.error(`[telegram] resposta em áudio falhou, caindo pra texto: ${semDadoPessoal(err)}`);
    }
  }
  await sendTelegramMessages(chatId, splitMessages(mensagem), deps);
}

function extractTenantSlug(reqUrl: string): string | null {
  const segments = new URL(reqUrl).pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last && last !== "telegram" ? last : null;
}

// SEM fallback pro tenant padrão: um POST sem slug (ou com slug que não bate
// com tenant nenhum) na URL não pode virar "trata como se fosse o dono da
// plataforma" — era exatamente esse fallback que deixava qualquer POST pra
// `/telegram` (sem slug) processar como se fosse mensagem do Daniel, com as
// credenciais dele. Sem tenant resolvido, a chamada é recusada mais abaixo.
async function resolveTenant(slug: string | null): Promise<Tenant | null> {
  if (!slug) return null;
  try {
    const tenant = await getTenantBySlug(slug);
    // Mesmo portão do WhatsApp: sem aprovação manual, não atende. O
    // getTenantBySlug é usado também pelo cron (dono, sempre aprovado), então
    // o filtro fica aqui, no caminho de usuário, e não dentro do resolvedor.
    if (tenant && !tenant.aprovado_em) {
      console.error(`[telegram] tenant '${slug}' ainda não aprovado — recusando`);
      return null;
    }
    return tenant;
  } catch (err) {
    console.error(`[telegram] resolveTenant('${slug}') falhou: ${semDadoPessoal(err)}`);
    return null;
  }
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    date: number;
    text?: string;
    caption?: string;
    voice?: { file_id: string; duration: number; mime_type?: string };
    photo?: TgPhotoSize[];
    document?: TgDocument;
  };
}

async function deriveInput(
  message: NonNullable<TelegramUpdate["message"]>,
  telegramDeps?: TelegramDeps,
  tenantId?: string | null,
): Promise<string | null> {
  if (message.text) return message.text;

  if (message.voice) {
    const { bytes, fileName } = await getTelegramFileBytes(message.voice.file_id, telegramDeps);
    const text = await transcribeAudio(bytes, fileName.endsWith(".oga") ? "audio.ogg" : fileName);
    return text || "(audio sem fala reconhecivel)";
  }

  if (message.photo && message.photo.length > 0) {
    const largest = message.photo.reduce((a, b) => (b.file_size ?? b.width * b.height) > (a.file_size ?? a.width * a.height) ? b : a);
    const { bytes, fileName } = await getTelegramFileBytes(largest.file_id, telegramDeps);
    const description = await describeImage(bytes, imageMediaType(fileName), message.caption, tenantId);
    return message.caption
      ? `${message.caption}\n\n(imagem que enviei - ${description})`
      : `(imagem que enviei - ${description})`;
  }

  if (message.document && isPdfDocument(message.document)) {
    // Checa o tamanho que o Telegram já informou antes de baixar — evita
    // gastar banda com um arquivo que vai ser recusado de qualquer forma.
    verificaTamanhoDeclarado(message.document.file_size);
    const { bytes } = await getTelegramFileBytes(message.document.file_id, telegramDeps);
    const resumo = await describePdf(bytes, message.caption, tenantId);
    return message.caption
      ? `${message.caption}\n\n(PDF que enviei - ${resumo})`
      : `(PDF que enviei - ${resumo})`;
  }

  if (message.document && isCsvDocument(message.document)) {
    if (!tenantId) throw new Error("importação de CSV indisponível: tenant não resolvido");
    verificaTamanhoDeclaradoImportacao(message.document.file_size);
    const { bytes, fileName } = await getTelegramFileBytes(message.document.file_id, telegramDeps);
    const nomeArquivo = message.document.file_name || fileName || "importacao.csv";
    const csvTexto = new TextDecoder("utf-8").decode(bytes);
    const resultado = await registrarImportacao(tenantId, nomeArquivo, csvTexto);
    const aviso = resultado.truncado
      ? ` (o arquivo tinha mais linhas — guardei só as primeiras ${resultado.total_linhas})`
      : "";
    const resumo =
      `importei "${resultado.nome_arquivo}" como "${resultado.origem}": ${resultado.total_linhas} linha(s), ` +
      `colunas: ${resultado.colunas.join(", ")}${aviso}`;
    return message.caption
      ? `${message.caption}\n\n(CSV que enviei - ${resumo})`
      : `(CSV que enviei - ${resumo})`;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resp("Method Not Allowed", 405);

  const corpo = await leCorpoJsonLimitado<TelegramUpdate>(req, MAX_CORPO);
  if (!corpo.ok) {
    return corpo.motivo === "grande_demais"
      ? resp({ error: "payload too large" }, 413)
      : resp({ error: "Invalid JSON" }, 400);
  }
  const body = corpo.valor;

  const message = body.message;
  if (!message?.chat?.id) return resp({ ok: true, ignored: "no_chat" }, 200);

  const chatId = message.chat.id;
  const userId = `tg:${chatId}`;
  const kind = message.text
    ? "text"
    : message.voice
    ? "voice"
    : message.photo
    ? "photo"
    : isPdfDocument(message.document) || isCsvDocument(message.document)
    ? "document"
    : "other";

  const dbg = getSupabaseClient();
  const tenantSlug = extractTenantSlug(req.url);

  const tenant = await resolveTenant(tenantSlug);
  if (!tenant) {
    return resp({ ok: true, ignored: "tenant_nao_resolvido" }, 200);
  }

  // Confirma que a chamada veio do Telegram de verdade (secret_token
  // configurado no setWebhook — ver app/api/onboarding/channel/route.ts),
  // não de qualquer um que tenha descoberto/adivinhado a URL do webhook.
  const webhookSecret = await getTelegramWebhookSecret(tenant);
  if (!webhookSecret) {
    console.error(`[telegram] tenant '${tenant.slug}' sem secret_token configurado — recusando`);
    return resp({ ok: true, ignored: "sem_secret_token" }, 200);
  }
  const headerSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!compareTimingSafe(headerSecret, webhookSecret)) {
    return resp({ ok: true, ignored: "secret_token_invalido" }, 200);
  }

  // Chat autorizado: trust-on-first-use — a primeira mensagem que passar na
  // checagem acima vincula o chat_id; qualquer outro depois disso é recusado.
  const chatAutorizado = await authorizeTelegramChatId(tenant, chatId);
  if (!chatAutorizado) {
    // chat_id não é dado técnico solto: identifica a conta de Telegram de uma
    // pessoa real, então passa pelo mesmo saneamento que telefone.
    console.error(`[telegram] tenant '${tenant.slug}': ${apelidoDeUsuario(`tg:${chatId}`)} não autorizado`);
    return resp({ ok: true, ignored: "chat_nao_autorizado" }, 200);
  }

  await dbg.from("async_debug").insert({
    step: "tg_ack",
    // Sem `chat_id`: identifica uma pessoa real e esta tabela não tem dono por
    // linha nem expurgo. O slug já basta pra diagnosticar roteamento.
    detail: `kind=${kind} tenant_slug=${tenant.slug}`,
  });

  if (kind === "other") return resp({ ok: true, ignored: "unsupported" }, 200);

  const deliver = (async () => {
    try {
      const telegramDeps: TelegramDeps = { fetch, env: await buildTenantEnv(tenant) };

      await sendTelegramChatAction(chatId, telegramDeps);

      let input: string | null;
      try {
        input = await deriveInput(message, telegramDeps, tenant.id);
      } catch (err) {
        await dbg.from("async_debug").insert({ step: "tg_media_err", detail: semDadoPessoal(err) });
        const msg = err instanceof PdfLimiteExcedidoError || err instanceof PdfInvalidoError ||
            err instanceof ImportLimiteExcedidoError
          ? err.message
          : semDadoPessoal(err).includes("GROQ_API_KEY")
          ? "Chefe, ainda nao consigo ouvir audio por aqui - me manda por texto que eu resolvo? 🙏"
          : "Chefe, nao consegui processar esse arquivo. Tenta de novo ou me manda por texto? 😅";
        await sendTelegramMessages(chatId, [msg], telegramDeps);
        return;
      }
      if (!input) return;

      const result = await callFastEndpoint({
        text: input,
        decision: DEFAULT_DECISION,
        from: userId,
        timeoutMs: FAST_BG_TIMEOUT_MS,
        tenantSlug: tenant.slug,
      });
      const bubbles = splitMessages(result.message);
      await dbg.from("async_debug").insert({
        step: "tg_fast_done",
        detail: `kind=${kind} ok=${result.ok} bubbles=${bubbles.length}`,
      });
      await entregarRespostaTelegram(
        chatId,
        result.message,
        deveResponderEmAudio(kind === "voice", tenant.resposta_audio_sempre),
        telegramDeps,
      );
      await dbg.from("async_debug").insert({ step: "tg_sent_ok", detail: "" });
    } catch (err) {
      await dbg.from("async_debug").insert({ step: "tg_bg_err", detail: semDadoPessoal(err) });
      console.error("[telegram] background falhou:", semDadoPessoal(err));
    }
  })();

  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil?.(deliver);

  return resp({ ok: true }, 200);
});

function resp(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
