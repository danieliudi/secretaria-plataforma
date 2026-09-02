// A mensagem das 13:00 — o checkpoint da manhã.
//
// POR QUE EXISTE (sugestão da Erika, 02/09/2026). Em 01/09 ela pediu um
// lembrete do bolo pras 11:00, recebeu, e não respondeu. Nada voltou nele: nem
// naquele dia, nem nunca — o fim do dia só olha lembretes com `sent_at` de
// HOJE, então o de ontem já não existe pra ele. O pedido dela foi "como uma
// secretária de verdade faria: perguntar depois, pra ver se você viu".
//
// A FORMA IMPORTA MAIS QUE A REGRA. A primeira versão que eu desenhei era uma
// cobrança POR LEMBRETE, disparada N horas depois de cada um: horário
// imprevisível e volume crescendo com o número de tenants, o que exigia teto,
// janela de vigília e dedup só pra não virar praga. Esta é uma mensagem FIXA,
// uma por dia, no mesmo horário — o teto vem do desenho, e o efeito é ritmo em
// vez de cobrança. É o mesmo motivo de ninguém chamar o resumo das 06:00 de
// cobrança.
//
// SILÊNCIO É O PADRÃO, diferente das outras duas. O resumo das 06:00 e o fim do
// dia são âncoras: existem todo dia e, num dia vazio, dizem que o dia está
// vazio. Esta não. Sem nada pra perguntar, ela não manda nada — uma terceira
// mensagem diária que às vezes só diz "nada por aqui" é exatamente o tipo de
// coisa que faz alguém silenciar a Mia.
//
// O QUE NÃO ENTRA: tarefa com prazo hoje. Às 13:00 ela ainda tem até as 23:59,
// então "andou?" é cobrança adiantada — e ela já aparece às 06:00 e às 19:00.
// Colocar aqui seria a terceira aparição do mesmo item no mesmo dia.
//
// Sem marcador de negrito, mesma razão do fim do dia: WhatsApp faz com `*um*`,
// Telegram só converte `**dois**`, e a mesma string vai pros dois canais.

import type { CompromissoDoDia, LembreteDoDia } from "./fim-do-dia.ts";
import { RECAP_MAX_ITENS } from "./fim-do-dia.ts";

/** Um item que já passou pela manhã e ninguém acusou. */
type ItemDaManha =
  | { tipo: "lembrete"; texto: string; hora: string }
  | { tipo: "compromisso"; texto: string; hora: string };

/** Corta texto de origem externa que entra numa linha da mensagem. */
function linhaCurta(t: string): string {
  const limpo = t.replace(/\s+/g, " ").trim();
  return limpo.length > 120 ? `${limpo.slice(0, 117)}…` : limpo;
}

/**
 * "duas", "três"… O contador aparece numa frase ("Duas coisas passaram"), e
 * numeral por extenso lê melhor que dígito nesse lugar. Acima de nove vira
 * dígito: a essa altura o número é informação, não prosa.
 */
function porExtensoFeminino(n: number): string {
  const nomes = ["", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
  return nomes[n] ?? String(n);
}

/**
 * A mensagem. `null` quando não há nada pra perguntar — e aí o cron NÃO manda
 * mensagem nenhuma, que é o comportamento normal da maioria dos dias.
 *
 * Quem filtra o que já foi acusado é o chamador (ver runMeioDoDia no cron): a
 * regra é uma só e vale pros dois tipos — item cujo momento é ANTERIOR à
 * última mensagem que a pessoa mandou hoje já foi conversado, e não se
 * pergunta de novo.
 */
export function montaMensagemMeioDoDia(
  lembretes: LembreteDoDia[],
  compromissos: CompromissoDoDia[],
): string | null {
  const itens: ItemDaManha[] = [
    ...lembretes.map((l) => ({ tipo: "lembrete" as const, texto: linhaCurta(l.texto), hora: l.hora })),
    // Compromisso de dia inteiro não entra: às 13:00 ele ainda tem o dia todo
    // pra acontecer. O fim do dia cuida dele.
    ...compromissos
      .filter((c) => c.hora !== null)
      .map((c) => ({ tipo: "compromisso" as const, texto: linhaCurta(c.titulo), hora: c.hora! })),
  ];

  if (itens.length === 0) return null;

  // Um item só vira frase, não lista: cabeçalho + marcador pra uma linha é
  // mais texto que a frase inteira. O verbo muda com a origem — "te mandei"
  // sobre uma reunião seria falso, a Mia não mandou reunião nenhuma.
  if (itens.length === 1) {
    const [i] = itens;
    if (i.tipo === "lembrete") {
      return `☕ Meio do dia\n\nTe mandei "${i.texto}" às ${i.hora} e não tive notícia. Andou?\n\n` +
        `Se não deu, eu passo pra amanhã — é só dizer.`;
    }
    return `☕ Meio do dia\n\n"${i.texto}", das ${i.hora}, já passou. Andou?`;
  }

  const total = itens.length;
  const mostrados = itens.slice(0, RECAP_MAX_ITENS);
  const linhas = mostrados
    .map((i, n) => `${n + 1}. ☐ ${i.texto} — ${i.hora}`)
    .join("\n");
  const corte = total > RECAP_MAX_ITENS ? `\n\n(mostrei ${RECAP_MAX_ITENS} de ${total})` : "";

  return `☕ Meio do dia\n\n${porExtensoFeminino(total).replace(/^./, (c) => c.toUpperCase())} ` +
    `coisas passaram pela sua manhã:\n\n${linhas}${corte}\n\n` +
    `Andou alguma? "fiz a 1" já resolve.`;
}
