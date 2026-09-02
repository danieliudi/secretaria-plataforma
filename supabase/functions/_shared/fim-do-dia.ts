// Monta a mensagem de fim de dia (a pergunta das 19h).
//
// Mora aqui, separado do cron, por um motivo só: é a única parte da mecânica
// que precisa estar EXATA, e função pura dá pra testar sem chamar API nenhuma.
// Nome de tarefa errado nessa lista vira complete_task no item errado dez
// minutos depois, quando o usuário responder "fiz a primeira".
//
// A lista é determinística de propósito — vem do gerenciador de tarefas, da
// agenda e dos lembretes que a própria secretária entregou, não de um modelo.
// Além de não errar nome, sai de graça: mandar a pergunta não custa nenhuma
// chamada de modelo.
//
// TRÊS FONTES, não duas (02/09/2026). Até aqui o fim do dia olhava só tarefa e
// agenda. A Erika não tem nenhuma das duas — então às 19h ouviu "Dia limpo",
// oito horas depois da própria Mia ter mandado "Lembra de procurar o bolo 🎂".
// A frase era tecnicamente verdadeira e por isso passou meses despercebida: a
// lista DE TAREFAS estava mesmo vazia. Lembrete entregue hoje é a terceira
// fonte, e pra quem não usa gerenciador de tarefas é a única que existe.
//
// SEM NEGRITO, de propósito. WhatsApp faz negrito com `*um asterisco*` e o
// Telegram (que recebe a mesma string, ver _shared/telegram.ts → toTelegramHtml)
// só converte `**dois**`. Qualquer um dos dois marcadores aparece cru no outro
// canal. Como esta mensagem é determinística e vai pros dois, ela não usa
// nenhum — cabeçalho de seção é uma linha solta, e funciona igual nos dois.

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

/** Lembrete que a secretária ENTREGOU hoje (scheduled_reminders com sent_at de hoje). */
export interface LembreteDoDia {
  texto: string;
  /** Hora de entrega já formatada em SP (ex: "11:00"). */
  hora: string;
}

/** Teto de linhas na mensagem — acima disso vira parede de texto e ninguém responde. */
export const RECAP_MAX_ITENS = 15;

/** Quantos nomes de tarefa concluída cabem na linha de fechamento antes de virar contagem. */
const MAX_CONCLUIDAS_NOMEADAS = 3;

// Só quando as TRÊS fontes estão vazias. Antes desta versão o texto dizia
// "Nada com prazo hoje na sua lista", que descrevia só a fonte de tarefas e
// mentia por omissão pra quem tinha lembrete no dia.
export const RECAP_DIA_LIMPO =
  "🌙 Fim do dia\n\nHoje não tinha tarefa com prazo, compromisso nem lembrete meu. Dia limpo.";

/** Corta texto de origem externa que entra numa linha da mensagem. */
function linhaCurta(t: string): string {
  const limpo = t.replace(/\s+/g, " ").trim();
  return limpo.length > 120 ? `${limpo.slice(0, 117)}…` : limpo;
}

/**
 * A mensagem inteira. Vazia nas três fontes devolve o texto de dia limpo —
 * silêncio total seria pior: some sem explicar por quê.
 *
 * `concluidas` não entra na contagem nem vira item de pergunta: é uma linha de
 * fechamento, pra devolver a sensação de progresso sem pedir confirmação de
 * uma coisa que já está resolvida.
 */
export function montaMensagemFimDoDia(
  tarefas: TarefaDoDia[],
  compromissos: CompromissoDoDia[],
  lembretes: LembreteDoDia[] = [],
  concluidas: string[] = [],
): string {
  const vazio = tarefas.length === 0 && compromissos.length === 0 && lembretes.length === 0;
  if (vazio && concluidas.length === 0) return RECAP_DIA_LIMPO;

  // Frente só aparece quando há mais de uma em jogo: com uma só, o rótulo é
  // ruído em toda linha; com várias, é o que deixa o modelo chamar
  // complete_task/remarcar_tarefa na frente certa em vez de adivinhar.
  const mostraFrente = new Set(tarefas.map((t) => t.frente)).size > 1;

  // Seção sem item é OMITIDA — nem o cabeçalho aparece. Três cabeçalhos com
  // "nenhum" embaixo é o resumo vazio que já incomodou no bloco de sinais.
  const secoes: Array<{ titulo: string; linhas: string[] }> = [];
  if (tarefas.length > 0) {
    secoes.push({
      titulo: "Tarefas com prazo hoje",
      linhas: tarefas.map((t) => {
        const rotulo = mostraFrente ? ` · ${t.list ? `${t.frente}/${t.list}` : t.frente}` : "";
        return `☐ ${linhaCurta(t.name)}${rotulo}`;
      }),
    });
  }
  if (compromissos.length > 0) {
    secoes.push({
      titulo: "Agenda",
      linhas: compromissos.map((c) => `• ${linhaCurta(c.titulo)}, ${c.hora}`),
    });
  }
  if (lembretes.length > 0) {
    secoes.push({
      titulo: "Lembretes que te mandei",
      linhas: lembretes.map((l) => `• ${linhaCurta(l.texto)} — ${l.hora}`),
    });
  }

  // O teto vale pro conjunto das três seções, cortando na ordem de exibição —
  // mesma regra de antes, agora com uma fonte a mais.
  const total = secoes.reduce((n, s) => n + s.linhas.length, 0);
  let restante = RECAP_MAX_ITENS;
  const blocos: string[] = [];
  for (const secao of secoes) {
    if (restante <= 0) break;
    const linhas = secao.linhas.slice(0, restante);
    restante -= linhas.length;
    blocos.push(`${secao.titulo}\n${linhas.join("\n")}`);
  }
  const rodape = total > RECAP_MAX_ITENS ? `\n\n(mostrei ${RECAP_MAX_ITENS} de ${total})` : "";

  const fechadas = linhaDeConcluidas(concluidas);

  // Sem nada em aberto mas com coisa concluída: não faz sentido perguntar "o
  // que andou?" — já se sabe. Vira só o reconhecimento do que fechou.
  if (blocos.length === 0) {
    return `🌙 Fim do dia\n\n${fechadas}\n\nFora isso, o dia estava limpo.`;
  }

  const partes = [
    "🌙 Fim do dia",
    "",
    "O que andou hoje?",
    "",
    blocos.join("\n\n") + rodape,
  ];
  if (fechadas) partes.push("", fechadas);
  partes.push("", "Me diz o que andou. O que ficou de fora eu passo pra amanhã.");
  return partes.join("\n");
}

/** "Já fechado hoje: A, B ✅" — vazio quando não fechou nada. */
function linhaDeConcluidas(concluidas: string[]): string {
  if (concluidas.length === 0) return "";
  const nomes = concluidas.slice(0, MAX_CONCLUIDAS_NOMEADAS).map(linhaCurta);
  const sobra = concluidas.length - nomes.length;
  const lista = sobra > 0 ? `${nomes.join(", ")} e mais ${sobra}` : nomes.join(", ");
  return `Já fechado hoje: ${lista} ✅`;
}
