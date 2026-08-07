import { getAnthropicClient } from "./anthropic.ts";

const VISION_MODEL = "claude-haiku-4-5-20251001";
const VISION_MAX_TOKENS = 512;

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function describeImage(bytes: Uint8Array, mediaType: ImageMediaType, caption?: string): Promise<string> {
  const client = getAnthropicClient();
  const instruction = caption
    ? `O Daniel mandou esta imagem com a legenda: "${caption}". Descreva o que ha nela de forma objetiva e util, focando no que se conecta a legenda.`
    : "Descreva esta imagem de forma objetiva e util, em portugues. Se for um print/documento/planilha, extraia o texto e os dados relevantes. Se for foto, descreva a cena em 1-2 frases.";

  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: VISION_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: toBase64(bytes) } },
          { type: "text", text: instruction },
        ],
      },
    ],
  });

  const block = response.content.find((c) => c.type === "text") as { type: "text"; text: string } | undefined;
  return (block?.text ?? "").trim();
}

export function imageMediaType(fileName: string): ImageMediaType {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
