// Verificação e leitura do webhook da Meta (WhatsApp Cloud API).
//
// POR QUE ESTE MÓDULO EXISTE SEPARADO DO ENDPOINT: ele é a fronteira de
// confiança. Tudo que entra por aqui vem da internet aberta — qualquer um
// consegue fazer POST no nosso endpoint. Sem a verificação de assinatura,
// um terceiro conseguiria forjar "a Ana respondeu SAIR" e remover contatos
// alheios da lista, ou forjar respostas que a Yuka trataria como reais.
//
// A ASSINATURA: a Meta manda `X-Hub-Signature-256: sha256=<hex>`, que é o
// HMAC-SHA256 do CORPO CRU com o App Secret. Dois detalhes que quebram em
// silêncio se forem ignorados:
//
// 1. Tem que ser o corpo CRU, byte a byte. `JSON.parse` seguido de
//    `JSON.stringify` NORMALIZA o espaçamento (a Meta manda indentado; o
//    stringify devolve compacto) e reordena chaves numéricas. A assinatura
//    passa a nunca bater, e o sintoma é "o webhook nunca funciona" sem erro
//    nenhum em lugar nenhum.
//
// 2. A comparação tem que ser em TEMPO CONSTANTE. Com `===`, o tempo de
//    resposta vaza quantos caracteres iniciais estão certos, e a assinatura
//    vira adivinhável byte a byte. Mesmo motivo do internal-auth.ts.

/** Comparação em tempo constante — não vaza o prefixo correto pelo tempo. */
function igualTempoConstante(a: string, b: string): boolean {
  // Comprimento diferente já é diferença, mas ainda percorremos o maior dos
  // dois pra que o tempo não denuncie o tamanho esperado.
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function paraHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Confere o `X-Hub-Signature-256` contra o corpo cru.
 *
 * `corpoCru` precisa ser exatamente a string recebida (use `await req.text()`,
 * nunca `JSON.stringify(await req.json())`).
 */
export async function assinaturaValida(
  corpoCru: string,
  cabecalho: string | null,
  appSecret: string | undefined,
): Promise<boolean> {
  // Sem segredo configurado NÃO se aceita nada. Tratar ausência de segredo como
  // "modo aberto" transformaria uma configuração incompleta num endpoint
  // público de escrita.
  if (!appSecret) return false;
  if (!cabecalho || !cabecalho.startsWith("sha256=")) return false;

  const esperado = cabecalho.slice("sha256=".length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(esperado)) return false;

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpoCru));

  return igualTempoConstante(paraHex(assinado), esperado);
}

/**
 * Confere o handshake de verificação (GET) que a Meta faz ao cadastrar a URL.
 * Devolve o desafio a ecoar, ou null.
 */
export function respostaDeVerificacao(
  url: URL,
  verifyToken: string | undefined,
): string | null {
  if (!verifyToken) return null;
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const desafio = url.searchParams.get("hub.challenge");
  if (modo !== "subscribe" || !desafio) return null;
  if (!token || !igualTempoConstante(token, verifyToken)) return null;
  return desafio;
}

/** Uma mensagem recebida, no que nos interessa. */
export interface MensagemRecebida {
  /** Telefone de quem escreveu, em E.164 sem "+" — formato que a Meta já usa. */
  de: string;
  /** Texto puro. Vazio pra tipos que não são texto (áudio, imagem, botão). */
  texto: string;
  /** ID da mensagem na Meta, pra idempotência. */
  id: string;
}

/**
 * Extrai as mensagens de texto de um payload de webhook.
 *
 * Tolerante por desenho: a Meta manda muitos eventos que não são mensagem
 * (status de entrega, leitura, mudança de perfil). Formato inesperado devolve
 * lista vazia em vez de explodir — webhook que dá 500 é webhook que a Meta
 * desativa depois de algumas tentativas.
 */
export function extraiMensagens(payload: unknown): MensagemRecebida[] {
  const saida: MensagemRecebida[] = [];
  if (typeof payload !== "object" || payload === null) return saida;

  const entradas = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entradas)) return saida;

  for (const entrada of entradas) {
    const mudancas = (entrada as { changes?: unknown })?.changes;
    if (!Array.isArray(mudancas)) continue;

    for (const mudanca of mudancas) {
      const valor = (mudanca as { value?: unknown })?.value;
      const mensagens = (valor as { messages?: unknown })?.messages;
      if (!Array.isArray(mensagens)) continue;

      for (const m of mensagens) {
        const msg = m as { from?: unknown; id?: unknown; type?: unknown; text?: { body?: unknown } };
        if (typeof msg.from !== "string" || typeof msg.id !== "string") continue;
        // Só nos interessa texto: é onde cabe "SAIR". Áudio e imagem de um
        // terceiro que nunca nos escreveu não são processados de propósito.
        const corpo = msg.type === "text" && typeof msg.text?.body === "string" ? msg.text.body : "";
        saida.push({ de: msg.from, texto: corpo, id: msg.id });
      }
    }
  }
  return saida;
}
