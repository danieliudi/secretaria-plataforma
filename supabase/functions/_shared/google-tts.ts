// Text-to-Speech via Google Cloud (REST, API key simples — sem service
// account/OAuth2). Usado pra resposta em áudio (WhatsApp/Telegram), ver
// _shared/audio-reply.ts.
//
// Secret (infra compartilhada — ver SHARED_INFRA_KEYS em _shared/tenant.ts,
// a plataforma paga essa conta, não é credencial de tenant):
//   GOOGLE_TTS_API_KEY

const TTS_API = "https://texttospeech.googleapis.com/v1/text:synthesize";

// Limite da própria API (SynthesizeSpeechRequest.input): 5000 bytes UTF-8.
const MAX_INPUT_BYTES = 5000;

export interface GoogleTtsDeps {
  fetch: typeof fetch;
  env: (k: string) => string | undefined;
}

/**
 * Sintetiza `texto` em áudio OGG/Opus (formato nativo de nota de voz do
 * WhatsApp/Telegram). Lança Error se faltar a API key ou a API recusar.
 *
 * Não fixamos `voice.name` (ex: "pt-BR-Neural2-A") — o catálogo de vozes do
 * Google muda com frequência e um nome errado quebra a chamada; deixamos só
 * languageCode + ssmlGender e a API escolhe a voz padrão da família.
 */
export async function synthesizeSpeech(
  texto: string,
  deps: GoogleTtsDeps,
): Promise<Uint8Array> {
  const apiKey = deps.env("GOOGLE_TTS_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_TTS_API_KEY não setada");

  const res = await deps.fetch(`${TTS_API}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text: truncateToBytes(texto, MAX_INPUT_BYTES) },
      voice: { languageCode: "pt-BR", ssmlGender: "FEMALE" },
      audioConfig: { audioEncoding: "OGG_OPUS" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google TTS ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) throw new Error("Google TTS: resposta sem audioContent");
  return base64ToBytes(data.audioContent);
}

// Corta pro limite de bytes da API sem quebrar um caractere multibyte no meio.
// TextDecoder (modo não-fatal) troca uma sequência UTF-8 incompleta no fim
// por um único U+FFFD — mais confiável que recuar byte a byte procurando um
// byte "não-continuação", que erra quando o corte deixa só o byte-líder de
// um par solto (ele passa no teste de "não é continuação" mesmo incompleto).
function truncateToBytes(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  const decoded = new TextDecoder("utf-8").decode(bytes.slice(0, maxBytes));
  return decoded.endsWith("�") ? decoded.slice(0, -1) : decoded;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
