// Guarda de duplicata pra criação de tarefa.
//
// POR QUE ISSO EXISTE (02/09/2026, 10:34). O Daniel pediu uma tarefa, a
// secretária respondeu "Criei pra amanhã. 👍" E NA MESMA BOLHA perguntou "não
// entendi a segunda parte". Ele leu como se não tivesse passado e reenviou a
// mensagem idêntica 22 segundos depois. Ela criou a tarefa DE NOVO e respondeu
// "Criei pra amanhã. 👍" outra vez, sem notar que acabara de gravar a mesma
// coisa — com o histórico da conversa inteiro no próprio prompt.
//
// A ASSIMETRIA que deixou isso passar: `schedule_reminder` JÁ tinha essa
// guarda desde sempre (lembrete parecido em ±90min devolve `conflict` e ela
// pergunta antes), e `create_task` não tinha nenhuma. Duas escritas da mesma
// natureza, tratamento oposto. Este módulo é a versão de tarefa da guarda que
// o lembrete já tem — ver createScheduledReminder em scheduled-reminders.ts.
//
// O CRITÉRIO É O TÍTULO E A FRENTE, NÃO O PRAZO. Duas tarefas abertas com o
// mesmo nome na mesma frente são duplicata mesmo com prazos diferentes; e
// tarefa recorrente de verdade ("relatório semanal") só colide enquanto a
// anterior ainda está ABERTA — que é justamente quando vale perguntar, porque
// duas iguais em aberto não ajudam ninguém.
//
// Falso positivo aqui é barato: ela pergunta e o usuário diz "cria mesmo
// assim". Falso negativo é a lista dele com lixo que ninguém mandou criar.

/** Menor título que pode casar por conter o outro. Abaixo disso, só igualdade
 *  exata: "Ligar" dentro de "Ligar pro João sobre o contrato" acusaria tudo. */
const MIN_CHARS_PARA_CASAR_POR_TRECHO = 15;

/** Só o suficiente pra "Mandar pesquisa de satisfação" casar com "mandar
 *  pesquisa  de satisfacao!" — acento, caixa, pontuação e espaço sobrando. */
export function normalizaTitulo(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** O mínimo que a guarda precisa saber de uma tarefa já existente. */
export interface TarefaExistente {
  name: string;
  status: string;
  due_date?: string | null;
}

/**
 * As tarefas já abertas que colidem com `titulo`. Vazio = pode criar.
 *
 * Recebe a lista pronta em vez de buscar: quem chama já tem o provider na mão,
 * e função pura é o que dá pra testar sem API nenhuma — mesmo desenho do resto
 * de _shared.
 */
export function achaTarefasParecidas<T extends TarefaExistente>(
  titulo: string,
  existentes: T[],
): T[] {
  const alvo = normalizaTitulo(titulo);
  if (alvo === "") return [];

  return existentes.filter((t) => {
    if (concluida(t.status)) return false;
    const outro = normalizaTitulo(t.name);
    if (outro === "") return false;
    if (outro === alvo) return true;

    // Um contém o outro: "mandar pesquisa de satisfação pra clientes" vs
    // "...pra clientes da Resibag". É o caso real de 02/09, onde o pedido
    // tinha uma cauda que o título gravado não tinha.
    const [curto, longo] = alvo.length <= outro.length ? [alvo, outro] : [outro, alvo];
    return curto.length >= MIN_CHARS_PARA_CASAR_POR_TRECHO && longo.includes(curto);
  });
}

// Cada provider tem seu vocabulário de status (ClickUp usa o nome da coluna,
// o Sanwey Tasks usa a_fazer/fazendo/feito/concluido, o Notion um select). Em
// vez de listar o que é ABERTO — que muda por tenant — a lista fechada é a do
// que é FECHADO, e qualquer status desconhecido conta como aberto. Errar pro
// lado de perguntar é o lado certo.
function concluida(status: string): boolean {
  const s = normalizaTitulo(status);
  return ["concluido", "concluida", "feito", "feita", "done", "complete", "completed", "closed", "fechado", "cancelado", "canceled", "cancelled"]
    .includes(s);
}
