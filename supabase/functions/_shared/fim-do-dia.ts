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
// TUDO QUE ESTÁ PENDENTE, não só o que vence hoje (02/09/2026). O corte antigo
// deixava atrasada de fora "porque ela tem canal próprio" — e o resultado, no
// dia 01/09, foi uma pergunta que dizia "Tinha 1 coisa hoje" sobre um dia com
// quatro tarefas em aberto. Atrasada não deixa de ser pendência por ter passado
// da data; é justamente a que mais precisa ser encarada antes de virar amanhã.
//
// LISTA NUMERADA E CONTÍNUA entre as seções. O objetivo da mensagem é o usuário
// ELIMINAR respondendo "fiz a 1 e a 3", e número é a forma mais barata de
// apontar. Contínua porque numeração que reinicia a cada seção torna "fiz a 2"
// ambíguo — e ambiguidade aqui vira complete_task no item errado.
//
// SEM NEGRITO, de propósito. WhatsApp faz negrito com `*um asterisco*` e o
// Telegram (que recebe a mesma string, ver _shared/telegram.ts → toTelegramHtml)
// só converte `**dois**`. Qualquer um dos dois marcadores aparece cru no outro
// canal. Como esta mensagem é determinística e vai pros dois, ela não usa
// nenhum — cabeçalho de seção é uma linha solta, e funciona igual nos dois.

/** Uma tarefa em aberto que o dia de hoje precisa encarar. */
export interface TarefaDoDia {
  name: string;
  frente: string;
  list?: string;
  /** Venceu ANTES de hoje. Aparece na linha, porque muda a urgência. */
  atrasada: boolean;
}

/** Compromisso de hoje que já começou. */
export interface CompromissoDoDia {
  titulo: string;
  /** Hora de início já formatada em SP ("15:00"). `null` = evento de dia inteiro. */
  hora: string | null;
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
  "🌙 Fim do dia\n\nHoje não tinha tarefa pendente, compromisso nem lembrete meu. Dia limpo.";

/** Corta texto de origem externa que entra numa linha da mensagem. */
function linhaCurta(t: string): string {
  const limpo = t.replace(/\s+/g, " ").trim();
  return limpo.length > 120 ? `${limpo.slice(0, 117)}…` : limpo;
}

/**
 * Fontes que não responderam, escritas pra entrar no meio de uma frase:
 * ["agenda"] vira "a agenda", ["agenda","lista de tarefas"] vira "a agenda e a
 * lista de tarefas". Lista vazia devolve "".
 */
export function listaDeFontes(fontes: string[]): string {
  const fs = fontes.filter((f) => f.trim() !== "").map((f) => `a ${f.trim()}`);
  if (fs.length === 0) return "";
  if (fs.length === 1) return fs[0];
  return `${fs.slice(0, -1).join(", ")} e ${fs[fs.length - 1]}`;
}

/**
 * A mensagem inteira. Vazia nas três fontes devolve o texto de dia limpo —
 * silêncio total seria pior: some sem explicar por quê.
 *
 * `concluidas` não entra na contagem nem vira item de pergunta: é uma linha de
 * fechamento, pra devolver a sensação de progresso sem pedir confirmação de
 * uma coisa que já está resolvida.
 *
 * `naoConsegui` são as fontes que falharam nesta execução. Enquanto houver uma,
 * a mensagem NÃO declara dia limpo: uma lista incompleta com cara de completa é
 * o mesmo erro do 01/09 com outra causa, e afirmar tranquilidade sobre um dia
 * que ninguém conseguiu ler é a pior versão dele — soa igualzinho ao caso bom.
 */
export function montaMensagemFimDoDia(
  tarefas: TarefaDoDia[],
  compromissos: CompromissoDoDia[],
  lembretes: LembreteDoDia[] = [],
  concluidas: string[] = [],
  naoConsegui: string[] = [],
): string {
  const fontes = listaDeFontes(naoConsegui);
  const vazio = tarefas.length === 0 && compromissos.length === 0 && lembretes.length === 0;

  if (vazio && concluidas.length === 0) {
    if (fontes) {
      return `🌙 Fim do dia\n\nNão consegui ler ${fontes} agora, então não sei dizer o que teve hoje. ` +
        `Me pergunta daqui a pouco que eu tento de novo.`;
    }
    return RECAP_DIA_LIMPO;
  }

  // Frente só aparece quando há mais de uma em jogo: com uma só, o rótulo é
  // ruído em toda linha; com várias, é o que deixa o modelo chamar
  // complete_task/remarcar_tarefa na frente certa em vez de adivinhar.
  const mostraFrente = new Set(tarefas.map((t) => t.frente)).size > 1;

  // Seção sem item é OMITIDA — nem o cabeçalho aparece. Três cabeçalhos com
  // "nenhum" embaixo é o resumo vazio que já incomodou no bloco de sinais.
  const secoes: Array<{ titulo: string; linhas: string[] }> = [];
  if (tarefas.length > 0) {
    secoes.push({
      titulo: "Pendências",
      linhas: tarefas.map((t) => {
        const rotulo = mostraFrente ? ` · ${t.list ? `${t.frente}/${t.list}` : t.frente}` : "";
        return `${linhaCurta(t.name)}${rotulo}${t.atrasada ? " (atrasada)" : ""}`;
      }),
    });
  }
  if (compromissos.length > 0) {
    secoes.push({
      titulo: "Agenda",
      // "dia todo" em vez de um horário inventado: o evento sem hora sumia
      // daqui, e voltar como um "00:00" falso seria pior — parece certo.
      linhas: compromissos.map((c) => `${linhaCurta(c.titulo)}, ${c.hora ?? "dia todo"}`),
    });
  }
  if (lembretes.length > 0) {
    secoes.push({
      titulo: "Lembretes que te mandei",
      linhas: lembretes.map((l) => `${linhaCurta(l.texto)} — ${l.hora}`),
    });
  }

  // O teto vale pro conjunto das três seções, cortando na ordem de exibição.
  // A numeração é contínua e segue o corte: o item 8 é o oitavo da mensagem,
  // não o oitavo da sua seção.
  const total = secoes.reduce((n, s) => n + s.linhas.length, 0);
  let n = 0;
  const blocos: string[] = [];
  for (const secao of secoes) {
    if (n >= RECAP_MAX_ITENS) break;
    const linhas = secao.linhas.slice(0, RECAP_MAX_ITENS - n);
    blocos.push(`${secao.titulo}\n${linhas.map((l) => `${++n}. ☐ ${l}`).join("\n")}`);
  }
  const corte = total > RECAP_MAX_ITENS ? `\n\n(mostrei ${RECAP_MAX_ITENS} de ${total})` : "";

  const fechadas = linhaDeConcluidas(concluidas);

  // Sem nada em aberto mas com coisa concluída: não faz sentido perguntar "o
  // que andou?" — já se sabe. Vira só o reconhecimento do que fechou.
  if (blocos.length === 0) {
    return `🌙 Fim do dia\n\n${fechadas}\n\nFora isso, o dia estava limpo.`;
  }

  const abertura = fontes
    ? `Isto é o que consegui ver — ${fontes} não respondeu agora. O que andou hoje?`
    : "O que andou hoje?";

  // O exemplo acompanha a lista: "fiz a 1 e a 3" numa lista de um item só
  // manda apontar pra uma coisa que não existe — e lista curta é o normal de
  // todo tenant novo.
  const comoResponder = n === 1
    ? 'Me diz se andou — "fiz" já resolve.'
    : n === 2
    ? 'Me diz o que andou — "fiz a 1" já resolve.'
    : 'Me diz o que andou — "fiz a 1 e a 3" já resolve.';

  const partes = ["🌙 Fim do dia", "", abertura, "", blocos.join("\n\n") + corte];
  if (fechadas) partes.push("", fechadas);
  partes.push("", `${comoResponder}\nO que ficar eu passo pra amanhã.`);
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
