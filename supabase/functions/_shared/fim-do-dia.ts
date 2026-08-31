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

/** Tarefa aberta com prazo hoje, no formato que o cron já usa. */
export interface TarefaDoDia {
  name: string;
  frente: string;
  list?: string;
}

/** Compromisso de hoje que já começou. */
export interface CompromissoDoDia {
  titulo: string;
  /** Hora de início já formatada em SP (ex: "15:00"). */
  hora: string;
}

/** Teto de linhas na mensagem — acima disso vira parede de texto e ninguém responde. */
export const RECAP_MAX_ITENS = 15;

export const RECAP_DIA_LIMPO = "🌙 Fim do dia\n\nNada com prazo hoje na sua lista. Dia limpo.";

/**
 * A mensagem inteira. Vazia dos dois lados devolve o texto de dia limpo —
 * silêncio total seria pior: some sem explicar por quê.
 */
export function montaMensagemFimDoDia(
  tarefas: TarefaDoDia[],
  compromissos: CompromissoDoDia[],
): string {
  if (tarefas.length === 0 && compromissos.length === 0) return RECAP_DIA_LIMPO;

  // Frente só aparece quando há mais de uma em jogo: com uma só, o rótulo é
  // ruído em toda linha; com várias, é o que deixa o modelo chamar
  // complete_task/remarcar_tarefa na frente certa em vez de adivinhar.
  const mostraFrente = new Set(tarefas.map((t) => t.frente)).size > 1;

  const linhas = [
    ...tarefas.map((t) => {
      const rotulo = mostraFrente ? ` · ${t.list ? `${t.frente}/${t.list}` : t.frente}` : "";
      return `☐ ${t.name}${rotulo}`;
    }),
    ...compromissos.map((c) => `☐ ${c.titulo}, ${c.hora}`),
  ];

  const total = linhas.length;
  const mostradas = total > RECAP_MAX_ITENS ? linhas.slice(0, RECAP_MAX_ITENS) : linhas;
  const rodape = total > RECAP_MAX_ITENS ? `\n\n(mostrei ${RECAP_MAX_ITENS} de ${total})` : "";
  const quantas = total === 1 ? "Tinha 1 coisa hoje" : `Tinha ${total} coisas hoje`;

  return `🌙 Fim do dia\n\n${quantas}. O que andou?\n\n${mostradas.join("\n")}${rodape}`;
}
