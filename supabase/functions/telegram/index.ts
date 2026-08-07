import { getSupabaseClient } from "../_shared/supabase.ts";
import { callFastEndpoint } from "../_shared/fast-proxy.ts";
import {
  getTelegramFileBytes,
  sendTelegramChatAction,
  sendTelegramMessages,
  splitMessages,
  type TelegramDeps,
} from "../_shared/telegram.ts";
import { transcribeAudio } from "../_shared/transcribe.ts";
import { describeImage, imageMediaType } from "../_shared/vision.ts";
import type { Decision } from "../_shared/types.ts";
import { buildTenantEnv, DEFAULT_TENANT_SLUG, getTenantBySlug, type Tenant } from "../_shared/tenant.ts";

const FAST_BG_TIMEOUT_MS = 90_000;

const DEFAULT_DECISION: Decision = {
  tier: "fast",
  frente: "pessoal",
  domain: "outro",
  action_required: false,
  irreversible: false,
  confidence: 0.95,
};

interface TgPhotoSize { file_id: string; width: number; height: number; file_size?: number; }

function extractTenantSlug(reqUrl: string): string | null {
  const segments = new URL(reqUrl).pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last && last !== "telegram" ? last : null;
}

async function resolveTenant(slug: string | null): Promise<Tenant | null> {
  try {
    if (slug) {
      const tenant = await getTenantBySlug(slug);
      if (tenant) return tenant;
      console.error(`[telegram] tenant slug '${slug}' nao encontrado/inativo - usando fallback`);
    }
    return await getTenantBySlug(DEFAULT_TENANT_SLUG);
  } catch (err) {
    console.error(`[telegram] resolveTenant falhou, seguindo com env global: ${String(err)}`);
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
  };
}

async function deriveInput(
  message: NonNullable<TelegramUpdate["message"]>,
  telegramDeps?: TelegramDeps,
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
    const description = await describeImage(bytes, imageMediaType(fileName), message.caption);
    return message.caption
      ? `${message.caption}\n\n(imagem que enviei - ${description})`
      : `(imagem que enviei - ${description})`;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resp("Method Not Allowed", 405);

  let body: TelegramUpdate;
  try {
    body = await req.json();
  } catch {
    return resp({ error: "Invalid JSON" }, 400);
  }

  const message = body.message;
  if (!message?.chat?.id) return resp({ ok: true, ignored: "no_chat" }, 200);

  const chatId = message.chat.id;
  const userId = `tg:${chatId}`;
  const kind = message.text ? "text" : message.voice ? "voice" : message.photo ? "photo" : "other";

  const dbg = getSupabaseClient();
  const tenantSlug = extractTenantSlug(req.url);
  await dbg.from("async_debug").insert({
    step: "tg_ack",
    detail: `chat=${chatId} kind=${kind} tenant_slug=${tenantSlug ?? "(default)"}`,
  });

  if (kind === "other") return resp({ ok: true, ignored: "unsupported" }, 200);

  const deliver = (async () => {
    try {
      const tenant = await resolveTenant(tenantSlug);
      const telegramDeps: TelegramDeps | undefined = tenant
        ? { fetch, env: await buildTenantEnv(tenant) }
        : undefined;

      await sendTelegramChatAction(chatId, telegramDeps);

      let input: string | null;
      try {
        input = await deriveInput(message, telegramDeps);
      } catch (err) {
        await dbg.from("async_debug").insert({ step: "tg_media_err", detail: String(err) });
        const msg = String(err).includes("GROQ_API_KEY")
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
        tenantSlug: tenant?.slug,
      });
      const bubbles = splitMessages(result.message);
      await dbg.from("async_debug").insert({
        step: "tg_fast_done",
        detail: `kind=${kind} ok=${result.ok} bubbles=${bubbles.length}`,
      });
      await sendTelegramMessages(chatId, bubbles, telegramDeps);
      await dbg.from("async_debug").insert({ step: "tg_sent_ok", detail: "" });
    } catch (err) {
      await dbg.from("async_debug").insert({ step: "tg_bg_err", detail: String(err) });
      console.error("[telegram] background falhou:", String(err));
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
