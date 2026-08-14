// Detecção de pedido de saída ("SAIR") nas respostas de quem recebeu mensagem.
//
// POR QUE É UM MÓDULO PRÓPRIO, E POR QUE TEM TANTO TESTE: aqui os dois erros
// são graves e opostos.
//
// FALSO NEGATIVO — a pessoa pede pra sair e a gente continua mandando. Deixa de
// ser incômodo e vira descumprimento do direito de oposição (LGPD art. 18), com
// prova documental: a mensagem dela pedindo está no nosso banco.
//
// FALSO POSITIVO — a pessoa escreve "vou sair do escritório às 18h" e nós a
// removemos pra sempre. Ela nunca é avisada, e o tenant perde um canal com um
// cliente sem nunca saber por quê. Um `texto.includes("sair")` ingênuo faz
// exatamente isso, e é a implementação que qualquer um escreveria primeiro.
//
// A regra que resolve os dois: palavra solta só conta quando é a MENSAGEM
// INTEIRA; frase composta conta em qualquer posição, porque não tem como ser
// dita por acaso.

/** Como o pedido chegou. Espelha o CHECK de `whatsapp_opt_out.motivo`. */
export type MotivoOptOut = "resposta_sair" | "pedido_manual";

/**
 * Palavras que valem SOZINHAS. A mensagem inteira precisa ser isto (fora
 * pontuação e espaço) — senão "vou sair" e "posso parar depois" removeriam
 * gente que só estava conversando.
 *
 * "nao" está fora de propósito: é a resposta natural pra "segue de pé?", e
 * tratá-la como saída removeria justamente quem respondeu a pergunta.
 */
const PALAVRAS_SOZINHAS = new Set([
  "sair",
  "sai",
  "saír",
  "parar",
  "pare",
  "para",
  "cancelar",
  "cancela",
  "descadastrar",
  "remover",
  "stop",
  "unsubscribe",
]);

/**
 * Frases que valem em qualquer posição. Todas são inequívocas — ninguém
 * escreve "não quero mais receber" sem querer dizer isso.
 */
const FRASES = [
  "nao quero mais receber",
  "nao quero receber mais",
  "nao quero receber",
  "para de me mandar",
  "pare de me mandar",
  "parem de me mandar",
  "nao me manda mais",
  "nao me mande mais",
  "nao me mandem mais",
  "me tira da lista",
  "me tire da lista",
  "me tirem da lista",
  "remover da lista",
  "sair da lista",
  "me descadastra",
  "nao me envie mais",
  "nao envie mais",
];

/** Teto de entrada: texto de terceiro é hostil, e ninguém pede pra sair em 4KB. */
const MAX_TEXTO = 2000;

/**
 * Normaliza pra comparação: minúsculas, sem acento, sem pontuação nem emoji,
 * espaços colapsados.
 */
function normaliza(texto: string): string {
  return texto
    .normalize("NFD")
    // Remove os diacríticos separados pelo NFD ("ã" → "a" + combining tilde).
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Mantém só letra, número e espaço. Emoji, pontuação e o resto viram espaço
    // — assim "SAIR!!!" e "sair 🙏" continuam sendo a mensagem inteira "sair".
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decide se a resposta de um destinatário é um pedido pra não receber mais.
 *
 * Conservador por desenho: na dúvida devolve `false`. Pedido não reconhecido
 * ainda pode ser tratado por uma pessoa; remoção equivocada é silenciosa e
 * ninguém descobre.
 */
export function detectaPedidoDeSaida(texto: unknown): boolean {
  if (typeof texto !== "string") return false;
  if (texto.length > MAX_TEXTO) return false;

  const n = normaliza(texto);
  if (n === "") return false;

  // Frase composta: em qualquer posição.
  for (const frase of FRASES) {
    if (n.includes(frase)) return true;
  }

  // Palavra solta: só quando é a mensagem inteira. "sair" sim; "vou sair" não.
  // Aceita também a forma educada de UMA palavra a mais ("sair por favor"),
  // porque continua não tendo outro sentido possível.
  const palavras = n.split(" ");
  if (palavras.length === 1) {
    return PALAVRAS_SOZINHAS.has(palavras[0]);
  }
  if (palavras.length <= 3 && PALAVRAS_SOZINHAS.has(palavras[0])) {
    const resto = palavras.slice(1).join(" ");
    return resto === "por favor" || resto === "pf" || resto === "obrigado" ||
      resto === "obrigada" || resto === "please";
  }

  return false;
}
