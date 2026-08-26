// Envio de mensagem no WhatsApp via Evolution API.
// Usado pela entrega assíncrona: o reflex devolve um ack imediato e, em
// background, manda a resposta real do fast por aqui.
//
// Secrets (Supabase):
//   EVOLUTION_API_URL   base, ex: https://evolution-api-production-7ae7.up.railway.app
//   EVOLUTION_INSTANCE  nome da instância, ex: secretaria
//                       (aceita também EVOLUTION_INSTANCE_NAME — mesmo valor)
//   EVOLUTION_API_KEY   apikey da Evolution

import { semDadoPessoal } from "./log-seguro.ts";

export interface WhatsAppDeps {
  fetch: typeof fetch;
  env: (k: string) => string | undefined;
}

export function defaultWhatsAppDeps(): WhatsAppDeps {
  return { fetch, env: (k) => Deno.env.get(k) };
}

/**
 * Nome da instância. Aceita EVOLUTION_INSTANCE ou, na ausência, o legado
 * EVOLUTION_INSTANCE_NAME — são a mesma coisa (ex: "secretaria").
 */
function evolutionInstance(env: (k: string) => string | undefined): string | undefined {
  return env("EVOLUTION_INSTANCE") || env("EVOLUTION_INSTANCE_NAME");
}

/** True se as 3 secrets necessárias pra entrega via Evolution estão setadas. */
export function hasEvolutionConfig(
  env: (k: string) => string | undefined = (k) => Deno.env.get(k),
): boolean {
  return Boolean(
    env("EVOLUTION_API_URL") &&
      evolutionInstance(env) &&
      env("EVOLUTION_API_KEY"),
  );
}

function evolutionConfig(env: (k: string) => string | undefined): {
  base: string;
  instance: string;
  apikey: string;
} {
  const base = env("EVOLUTION_API_URL");
  const instance = evolutionInstance(env);
  const apikey = env("EVOLUTION_API_KEY");
  if (!base || !instance || !apikey) {
    throw new Error(
      "Evolution secrets ausentes: EVOLUTION_API_URL, EVOLUTION_INSTANCE (ou EVOLUTION_INSTANCE_NAME), EVOLUTION_API_KEY",
    );
  }
  return { base: base.replace(/\/$/, ""), instance, apikey };
}

/**
 * Envia uma mensagem de texto pelo WhatsApp via Evolution API.
 * Lança Error se faltar config ou a API retornar não-2xx.
 */
export async function sendWhatsAppText(
  to: string,
  text: string,
  deps: WhatsAppDeps = defaultWhatsAppDeps(),
): Promise<void> {
  const { base, instance, apikey } = evolutionConfig(deps.env);
  const url = `${base}/message/sendText/${instance}`;
  const res = await deps.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": apikey },
    body: JSON.stringify({ number: to, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution sendText ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Estados possíveis da instância na Evolution API. */
export type EvolutionConnectionState = "open" | "connecting" | "close";

/**
 * Consulta o estado da conexão da instância direto na Evolution API — usado
 * pelo watchdog (cron `whatsapp_watchdog`) pra detectar queda sem depender de
 * silêncio no tráfego (silêncio também é normal à noite/fim de semana).
 * Lança Error se faltar config ou a API retornar não-2xx/corpo inesperado.
 */
export async function getEvolutionConnectionState(
  deps: WhatsAppDeps = defaultWhatsAppDeps(),
): Promise<EvolutionConnectionState> {
  const { base, instance, apikey } = evolutionConfig(deps.env);
  const url = `${base}/instance/connectionState/${instance}`;
  const res = await deps.fetch(url, { headers: { "apikey": apikey } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution connectionState ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { instance?: { state?: string } };
  const state = data.instance?.state;
  if (state !== "open" && state !== "connecting" && state !== "close") {
    throw new Error(`Evolution connectionState devolveu estado inesperado: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return state;
}

/**
 * Pede pra Evolution API reiniciar a instância — recupera sozinho o caso mais
 * comum (sessão travada num estado ruim mas ainda válida). NÃO resolve sessão
 * deslogada de verdade (aí precisa de QR novo, humano tem que agir). Best-
 * effort por design: quem chama decide o que fazer se isto falhar ou não
 * resolver — nunca lança, só loga.
 */
export async function restartEvolutionInstance(
  deps: WhatsAppDeps = defaultWhatsAppDeps(),
): Promise<void> {
  try {
    const { base, instance, apikey } = evolutionConfig(deps.env);
    const url = `${base}/instance/restart/${instance}`;
    const res = await deps.fetch(url, { method: "PUT", headers: { "apikey": apikey } });
    if (!res.ok) {
      console.error(`[whatsapp] restart da instância falhou: ${res.status} ${(await res.text()).slice(0, 150)}`);
    }
  } catch (err) {
    console.error(`[whatsapp] restart da instância falhou: ${semDadoPessoal(err)}`);
  }
}

/**
 * Sinaliza "digitando" no WhatsApp por `durationMs` (Evolution chama de delay).
 * Best-effort: erro só loga e segue — typing falhar não justifica abortar o envio.
 */
export async function sendTypingPresence(
  to: string,
  durationMs: number,
  deps: WhatsAppDeps = defaultWhatsAppDeps(),
): Promise<void> {
  try {
    const { base, instance, apikey } = evolutionConfig(deps.env);
    const url = `${base}/chat/sendPresence/${instance}`;
    await deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": apikey },
      body: JSON.stringify({
        number: to,
        presence: "composing",
        delay: durationMs,
      }),
    });
  } catch (err) {
    console.error(`[whatsapp] sendPresence falhou: ${semDadoPessoal(err)}`);
  }
}

export interface WhatsAppMediaInput {
  fileName: string;
  /** MIME type. Ex: "text/csv", "application/pdf", "application/vnd.ms-excel". */
  mimeType: string;
  /** Conteúdo do arquivo em base64 (sem prefixo `data:`). */
  base64: string;
}

/**
 * Envia um arquivo (documento) pelo WhatsApp via Evolution `sendMedia`.
 * Documentos não suportam caption nativo — pra texto acompanhante mande
 * uma bolha de texto antes/depois.
 */
export async function sendWhatsAppDocument(
  to: string,
  doc: WhatsAppMediaInput,
  deps: WhatsAppDeps = defaultWhatsAppDeps(),
): Promise<void> {
  const { base, instance, apikey } = evolutionConfig(deps.env);
  const url = `${base}/message/sendMedia/${instance}`;
  const res = await deps.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": apikey },
    body: JSON.stringify({
      number: to,
      mediatype: "document",
      mimetype: doc.mimeType,
      fileName: doc.fileName,
      media: doc.base64,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution sendMedia ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Envia uma IMAGEM pelo WhatsApp. Mesmo endpoint do documento, mas
 * `mediatype: "image"` — o WhatsApp renderiza inline em vez de virar anexo
 * pra baixar, que é o ponto todo do card.
 *
 * `caption` é opcional e sai colada na imagem. Use com parcimônia: imagem
 * NÃO é buscável na conversa, então o essencial deve ir numa bolha de texto
 * separada (ver sendWhatsAppMessages), não só na legenda.
 */
export async function sendWhatsAppImage(
  to: string,
  image: { base64: string; fileName?: string; caption?: string },
  deps: WhatsAppDeps = defaultWhatsAppDeps(),
): Promise<void> {
  const { base, instance, apikey } = evolutionConfig(deps.env);
  const res = await deps.fetch(`${base}/message/sendMedia/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": apikey },
    body: JSON.stringify({
      number: to,
      mediatype: "image",
      mimetype: "image/png",
      fileName: image.fileName ?? "card.png",
      media: image.base64,
      ...(image.caption ? { caption: image.caption } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution sendMedia (image) ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Envia uma NOTA DE VOZ nativa (bubble com waveform, "ouvir") via Evolution
 * `sendWhatsAppAudio` — endpoint dedicado, diferente de sendMedia: o servidor
 * força `ptt:true` incondicionalmente pra toda chamada aqui.
 *
 * `encoding` fica no default (Evolution reconverte via ffmpeg pra OGG/Opus
 * antes de enviar) mesmo já mandando OGG/Opus — mais seguro que declarar
 * `encoding: false`, que pula a conversão e assume, sem checar, que o buffer
 * já é OGG/Opus válido.
 */
export async function sendWhatsAppAudio(
  to: string,
  audioBytes: Uint8Array,
  deps: WhatsAppDeps = defaultWhatsAppDeps(),
): Promise<void> {
  const { base, instance, apikey } = evolutionConfig(deps.env);
  const url = `${base}/message/sendWhatsAppAudio/${instance}`;
  const res = await deps.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": apikey },
    body: JSON.stringify({ number: to, audio: bytesToBase64(audioBytes) }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution sendWhatsAppAudio ${res.status}: ${body.slice(0, 200)}`);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Separador que o fast injeta entre bolhas. Triplo-traço numa linha sozinha é
// raro em texto natural BR e markdown horizontal-rule — improvável colidir.
export const MESSAGE_BREAK = "\n---\n";

/**
 * Quebra a resposta do fast em bolhas, descartando vazias e aparando espaços.
 * Sem o marcador, devolve [text] como antes.
 */
export function splitMessages(text: string): string[] {
  return text
    .split(MESSAGE_BREAK)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Delay proporcional ao tamanho da próxima bolha — simula "tempo de digitar".
// Clamp entre 600ms (cap inferior pra não ser instantâneo) e 2500ms (cap pra
// não atrasar demais o turno).
export function computeTypingDelay(nextBubbleLength: number): number {
  return Math.min(2500, Math.max(600, nextBubbleLength * 25));
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Envia múltiplas bolhas em sequência, com typing indicator entre elas.
 * Para apenas uma bolha, comporta-se igual a sendWhatsAppText.
 *
 * Falhas em mensagens intermediárias param o envio (mantém ordem visual) e
 * propagam — o reflex já loga via async_debug.
 */
export async function sendWhatsAppMessages(
  to: string,
  bubbles: string[],
  deps: WhatsAppDeps = defaultWhatsAppDeps(),
): Promise<void> {
  for (let i = 0; i < bubbles.length; i++) {
    if (i > 0) {
      const delay = computeTypingDelay(bubbles[i].length);
      await sendTypingPresence(to, delay, deps);
      await sleep(delay);
    }
    await sendWhatsAppText(to, bubbles[i], deps);
  }
}
