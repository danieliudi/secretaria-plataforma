// O dia da semana de uma data, calculado por CÓDIGO — e anexado a todo
// retorno de tool antes de ele chegar no modelo.
//
// POR QUE ISSO EXISTE (02/09/2026). Às 20:40 a secretária escreveu:
//
//   "O relatório da AGCO eu passo pra quinta, plano de vendas → quinta,
//    skills Resibag → sexta"
//
// e gravou, respectivamente, 2026-09-04, 2026-09-04 e 2026-09-05 — que são
// sexta, sexta e SÁBADO. Três de três, sempre um dia à frente. A tool rodou e
// gravou certo o que recebeu; quem errou foi a conta data→dia-da-semana feita
// de cabeça. E não faltava informação: o prompt já dizia "Agora: quarta-feira,
// 02/09/2026". Ela leu e calculou errado assim mesmo.
//
// O QUE TORNAVA ISSO INVISÍVEL é a assimetria: a MENSAGEM carrega o nome do
// dia ("quinta"), o BANCO carrega a data ("2026-09-04"), e nenhum lugar do
// sistema comparava os dois. O chefe lê a palavra e nunca vê a data; o resumo
// da manhã lê a data e nunca vê a palavra. O erro só apareceu 10 horas depois,
// quando a tarefa não estava no brief do dia em que ele achava que estaria.
//
// A correção é fechar a assimetria na origem: a partir daqui o rótulo do dia
// SAI DO MESMO DADO que foi gravado. Se a data estiver errada, a palavra sai
// errada JUNTO — e aí dá pra ver na hora e corrigir na conversa, em vez de
// descobrir no dia seguinte. Não impede a escolha errada; impede que ela passe
// despercebida, que é o que fazia essa classe de erro ser cara.
//
// Anda junto com o CALENDÁRIO no bloco de contexto (ver calendarioProximosDias
// em _shared/fast.ts), que tira a conta da mão do modelo. Este módulo é a
// segunda camada: vale mesmo quando o erro vier de outro lugar.

/** Índice = getUTCDay(). pt-BR por extenso, como a pessoa fala. */
const NOMES_DOS_DIAS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

/**
 * Chaves de retorno de tool que carregam data. Lista fechada de propósito:
 * anexar dia da semana em qualquer string que PAREÇA data pegaria `created_at`
 * e afins, que ninguém vai citar numa resposta e só engordariam o retorno.
 *
 * `due_date` vem de TaskItem, `fire_at` de CreatedReminder, `start`/`end` de
 * CreatedEvent, `startISO` de CalendarEvent, e `date` é o eco do dia
 * consultado em get_events_by_date.
 */
const CHAVES_COM_DATA = new Set([
  "due_date",
  "fire_at",
  "start",
  "end",
  "date",
  "startISO",
]);

/** Retorno de tool é objeto nosso, raso. O teto é anti-patologia, não regra. */
const PROFUNDIDADE_MAX = 6;

/**
 * O dia da semana de uma data, SEMPRE no fuso de São Paulo.
 *
 * Aceita as três formas que circulam no sistema:
 *   "2026-09-04"                 → data pura (ancorada ao meio-dia UTC, mesmo
 *                                  truque de msDoPrazo: longe das duas bordas)
 *   "2026-09-04T22:00:00-03:00"  → ISO com offset
 *   "2026-09-05T01:00:00Z"       → ISO em UTC, que em SP ainda é dia 04
 *
 * A última é o motivo de não bastar `slice(0, 10)`: cortar a string daria
 * "2026-09-05" e devolveria sábado pra um evento que acontece na sexta à
 * noite. Devolve `null` pra qualquer coisa que não seja data.
 */
export function diaDaSemanaDe(valor: string): string | null {
  const t = valor.trim();
  if (t === "") return null;
  const soData = /^\d{4}-\d{2}-\d{2}$/.test(t);
  const ms = soData ? Date.parse(`${t}T12:00:00Z`) : Date.parse(t);
  if (Number.isNaN(ms)) return null;

  const emSP = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
  return NOMES_DOS_DIAS[new Date(`${emSP}T12:00:00Z`).getUTCDay()];
}

/** Sábado ou domingo — o caso que passou batido em 02/09 (tarefa pro dia 05). */
export function ehFimDeSemana(valor: string): boolean {
  const dia = diaDaSemanaDe(valor);
  return dia === "sábado" || dia === "domingo";
}

/**
 * Devolve uma CÓPIA do retorno da tool com um campo `<chave>_dia_semana` ao
 * lado de cada data. Genérico de propósito: roda no ponto único onde o
 * resultado vira tool_result, então tool nova que devolva `due_date` ou
 * `fire_at` já nasce coberta, sem ninguém lembrar de ligar.
 *
 * Não muta a entrada — o mesmo objeto pode estar sendo usado em outro lugar.
 */
export function comDiaDaSemana(valor: unknown, nivel = 0): unknown {
  if (nivel > PROFUNDIDADE_MAX || valor === null || typeof valor !== "object") {
    return valor;
  }
  if (Array.isArray(valor)) {
    return valor.map((item) => comDiaDaSemana(item, nivel + 1));
  }

  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = comDiaDaSemana(v, nivel + 1);
    if (CHAVES_COM_DATA.has(chave) && typeof v === "string") {
      const dia = diaDaSemanaDe(v);
      if (dia) saida[`${chave}_dia_semana`] = dia;
    }
  }
  return saida;
}
