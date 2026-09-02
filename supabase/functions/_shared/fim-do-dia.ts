// Monta a mensagem de fim de dia (a pergunta das 19h).
//
// Mora aqui, separado do cron, por um motivo só: é a única parte da mecânica
// que precisa estar EXATA, e função pura dá pra testar sem chamar API nenhuma.
// Nome de tarefa errado nessa lista vira complete_task no item errado dez
// minutos depois, quando o usuário responder "fiz a primeira".
//
// A lista é determinística de propósito — vem do gerenciador de tarefas e da
// agenda, não de um modelo. Além de não errar nome, sai de graça: mandar a
// pergunta não custa nenhuma chamada de modelo.
//
// MUDOU EM 02/09/2026, e o motivo importa. Até aqui a lista só trazia o que
// vencia EXATAMENTE hoje, e o dia 01/09 — que tinha quatro tarefas atrasadas e
// dois compromissos — saiu como "Tinha 1 coisa hoje". A pergunta virou mentira
// e, pior, virou uma mentira tranquilizadora. Agora entra tudo que está em
// aberto: atrasado e do dia. Numerado, porque o objetivo é o usuário ELIMINAR
// respondendo "fiz a 1 e a 3" — e número é a forma mais barata de apontar.

import type { ItemAgenda, Pendencia } from "./blocos-do-dia.ts";
import { listaDeFontes } from "./blocos-do-dia.ts";

/** Teto de linhas na mensagem — acima disso vira parede de texto e ninguém responde. */
export const RECAP_MAX_ITENS = 15;

export const RECAP_DIA_LIMPO = "🌙 Fim do dia\n\nNada pendente e nada na agenda. Dia limpo.";

/**
 * A mensagem inteira.
 *
 * `naoConsegui` são as fontes que falharam nesta execução (ex: ["agenda"]).
 * Enquanto houver uma, a mensagem NÃO afirma um total nem declara dia limpo:
 * uma lista incompleta com cara de completa é o mesmo erro do 01/09, só que
 * com outra causa.
 */
export function montaMensagemFimDoDia(
  pendencias: Pendencia[],
  compromissos: ItemAgenda[],
  naoConsegui: string[] = [],
): string {
  const fontes = listaDeFontes(naoConsegui);

  if (pendencias.length === 0 && compromissos.length === 0) {
    if (fontes) {
      return `🌙 Fim do dia\n\nNão consegui ler ${fontes} agora, então não sei dizer o que teve hoje. ` +
        `Me pergunta daqui a pouco que eu tento de novo.`;
    }
    return RECAP_DIA_LIMPO;
  }

  // Frente só aparece quando há mais de uma em jogo: com uma só, o rótulo é
  // ruído em toda linha; com várias, é o que deixa o modelo chamar
  // complete_task/remarcar_tarefa na frente certa em vez de adivinhar.
  const mostraFrente =
    new Set(pendencias.map((p) => p.frente).filter((f) => f.trim() !== "")).size > 1;

  const linhas = [
    // Atrasadas primeiro, na ordem em que vieram: é o que arrasta o dia
    // seguinte, e quem lê de cima pra baixo tem que topar com elas antes.
    ...pendencias.map((p) => {
      const frente = mostraFrente && p.frente.trim() !== "" ? ` · ${p.frente}` : "";
      return `${p.nome}${frente}${p.atrasada ? " (atrasada)" : ""}`;
    }),
    // "dia todo" em vez de um horário inventado — o evento de dia inteiro que
    // sumia em 01/09 não pode voltar como um 00:00 falso.
    ...compromissos.map((c) => `${c.titulo}, ${c.hora ?? "dia todo"}`),
  ];

  const total = linhas.length;
  const mostradas = linhas.slice(0, RECAP_MAX_ITENS);
  const numeradas = mostradas.map((l, i) => `${i + 1}. ☐ ${l}`).join("\n");
  const corte = total > RECAP_MAX_ITENS ? `\n\n(mostrei ${RECAP_MAX_ITENS} de ${total})` : "";

  const abertura = fontes
    ? `Isto é o que consegui ver — ${fontes} não respondeu agora. O que andou?`
    : `${total === 1 ? "Tinha 1 coisa hoje" : `Tinha ${total} coisas hoje`}. O que andou?`;

  // O exemplo acompanha a lista: "fiz a 1 e a 3" numa lista de um item só é
  // instrução pra uma coisa que não existe, e ensina errado logo no dia em que
  // o tenant é novo e a lista é curta.
  const mostrados = Math.min(total, RECAP_MAX_ITENS);
  const comoResponder = mostrados === 1
    ? 'Fechou? Só dizer "fiz".'
    : mostrados === 2
    ? 'Responde o que fechou — "fiz a 1" já resolve.'
    : 'Responde o que fechou — "fiz a 1 e a 3" já resolve.';

  return `🌙 Fim do dia\n\n${abertura}\n\n${numeradas}${corte}\n\n${comoResponder}`;
}
