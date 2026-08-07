// Envio e recepção de mídia no Telegram via Bot API oficial.
// Usado pela edge function `telegram` (webhook) e pelo delivery roteado
// (cron, planilha). Memória/perfil isolados via prefixo `tg:` no user_id.
//
// Secret:
//   TELEGRAM_BOT_TOKEN — token do bot criado via @BotFather

const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramDeps {
  fetch: typeof fetch;
  env: (k: string) => string | undefined;
}

export function defaultTelegramDeps(): TelegramDeps {
  return { fetch, env: (k) => Deno.env.get(k) };
}

function botToken(env: (k: string) => string | undefined): string {
  const t = env("TELEGRAM_BOT_TOKEN");
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN não setada");
  return t;
}

// ─── Markdown → HTML ──────────────────────────────────────────────────────────
// O modelo emite markdown estilo GitHub (**negrito**, `código`). Telegram não
// renderiza isso como texto puro; com parse_mode HTML, convertemos. Escapamos
// &<> primeiro (senão texto do usuário quebra o parse), depois aplicamos as tags.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toTelegramHtml(text: string): string {
  let s = escapeHtml(text);
  // **negrito** → <b>negrito</b>
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  // `código` → <code>código</code>
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // _itálico_ → <i>itálico</i> (underscore entre limites de palavra)
  s = s.replace(/(^|\s)_([^_\n]+)_(\s|$|[.,!?])/g, "$1<i>$2</i>$3");
  return s;
}

// ─── Envio ────────────────────────────────────────────────────────────────────

/**
 * Envia texto. Tenta com parse_mode HTML (renderiza markdown); se a API recusar
 * o HTML (texto que vira HTML inválido), refaz como texto puro — nunca perde a
 * mensagem por causa de formatação.
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  deps: TelegramDeps = defaultTelegramDeps(),
): Promise<void> {
  const url = `${TELEGRAM_API}/bot${botToken(deps.env)}/sendMessage`;
  const html = toTelegramHtml(text);

  const res = await deps.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML" }),
  });
  if (res.ok) return;

  // Fallback: HTML inválido (400) → manda texto puro, sem parse_mode.
  const body = await res.text();
  console.error(`[telegram] sendMessage HTML ${res.status}: ${body.slice(0, 150)} — retry plain`);
  const plain = await deps.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!plain.ok) {
    throw new Error(`Telegram sendMessage ${plain.status}: ${(await plain.text()).slice(0, 200)}`);
  }
}

/**
 * Sinaliza "digitando..." no chat. Best-effort. Auto-expira em ~5s no Telegram.
 */
export async function sendTelegramChatAction(
  chatId: number | string,
  deps: TelegramDeps = defaultTelegramDeps(),
): Promise<void> {
  try {
    const url = `${TELEGRAM_API}/bot${botToken(deps.env)}/sendChatAction`;
    await deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch (err) {
    console.error(`[telegram] sendChatAction falhou: ${String(err)}`);
  }
}

/**
 * Envia um documento (arquivo) via multipart/form-data. Diferente da Evolution
 * (que aceita base64 inline), o Telegram quer o arquivo no corpo do form.
 */
export async function sendTelegramDocument(
  chatId: number | string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
  deps: TelegramDeps = defaultTelegramDeps(),
  caption?: string,
): Promise<void> {
  const url = `${TELEGRAM_API}/bot${botToken(deps.env)}/sendDocument`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([bytes], { type: mimeType }), fileName);
  if (caption) form.append("caption", caption);

  const res = await deps.fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Telegram sendDocument ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// ─── Recepção de mídia (download) ──────────────────────────────────────────────

/**
 * Baixa os bytes de um arquivo do Telegram a partir do file_id.
 * Fluxo: getFile(file_id) → file_path → GET no endpoint de arquivos.
 * Devolve bytes + nome (basename do file_path, pra inferir formato).
 */
export async function getTelegramFileBytes(
  fileId: string,
  deps: TelegramDeps = defaultTelegramDeps(),
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const token = botToken(deps.env);

  const metaRes = await deps.fetch(
    `${TELEGRAM_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  if (!metaRes.ok) {
    throw new Error(`Telegram getFile ${metaRes.status}: ${(await metaRes.text()).slice(0, 150)}`);
  }
  const meta = (await metaRes.json()) as { result?: { file_path?: string } };
  const filePath = meta.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile sem file_path");

  const fileRes = await deps.fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  if (!fileRes.ok) {
    throw new Error(`Telegram download ${fileRes.status}`);
  }
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  const fileName = filePath.split("/").pop() || "file";
  return { bytes, fileName };
}

// ─── Bolhas múltiplas ──────────────────────────────────────────────────────────

export const MESSAGE_BREAK = "\n---\n";

export function splitMessages(text: string): string[] {
  return text.split(MESSAGE_BREAK).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function computeTypingDelay(nextBubbleLength: number): number {
  return Math.min(2500, Math.max(600, nextBubbleLength * 25));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function sendTelegramMessages(
  chatId: number | string,
  bubbles: string[],
  deps: TelegramDeps = defaultTelegramDeps(),
): Promise<void> {
  for (let i = 0; i < bubbles.length; i++) {
    if (i > 0) {
      const delay = computeTypingDelay(bubbles[i].length);
      await sendTelegramChatAction(chatId, deps);
      await sleep(delay);
    }
    await sendTelegramMessage(chatId, bubbles[i], deps);
  }
}
