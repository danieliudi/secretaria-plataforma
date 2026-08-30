// "Despejo": a pessoa manda várias coisas soltas de uma vez — normalmente num
// áudio — e recebe UMA lista pra aprovar, em vez de uma conversa item a item.
//
// POR QUE ISTO É UMA TOOL SÓ, e não N chamadas de create_task: quem despeja
// está despejando justamente PORQUE não quer organizar agora. Criar seis
// tarefas em seis idas e voltas derrota o propósito inteiro — a pessoa desiste
// no terceiro item. Uma lista, uma resposta.
//
// A REGRA MAIS IMPORTANTE AQUI: item sem data NÃO vira tarefa com prazo
// inventado — vai pro inbox de capturas. Prazo falso é pior que nenhum: some
// no meio das tarefas de verdade e envenena o `atrasadas_check`, que hoje
// funciona bem.

import type { CreateTaskInput, TaskItem } from "../../_shared/task-provider.ts";

/** Teto de itens por lote. Um despejo real tem 5-10 coisas; acima disso é ruído
 *  (ou transcrição degenerada de um áudio longo demais), e cada item vira
 *  chamada de API no gerenciador de tarefas. */
export const MAX_ITENS_LOTE = 20;
const MAX_TITULO = 200;
const MAX_TEXTO_NOTA = 2000;

export interface ItemDoLote {
  titulo: string;
  /** Sem frente OU sem data, o item vai pro inbox em vez de virar tarefa. */
  frente?: string;
  lista?: string;
  /** ISO 8601 com offset. Só quando dá pra derivar da fala. */
  due_date?: string;
}

export interface CriarLoteInput {
  itens: ItemDoLote[];
}

export interface CriarLoteResult {
  criadas: Array<{ titulo: string; frente: string; due_date?: string; url?: string }>;
  anotadas: Array<{ texto: string }>;
  falharam: Array<{ titulo: string; motivo: string }>;
  /** true quando a lista veio acima do teto e foi cortada — o modelo precisa contar isso. */
  truncado: boolean;
}

export interface CriarLoteDeps {
  createTask: (input: CreateTaskInput) => Promise<TaskItem>;
  saveQuickCapture: (input: { text: string }) => Promise<unknown>;
}

/** Corta sem partir um par substituto (emoji) ao meio. */
function cortaSeguro(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const cortado = texto.slice(0, max);
  const ultimo = cortado.charCodeAt(cortado.length - 1);
  return ultimo >= 0xd800 && ultimo <= 0xdbff ? cortado.slice(0, -1) : cortado;
}

export async function criarLote(
  input: CriarLoteInput,
  deps: CriarLoteDeps,
): Promise<CriarLoteResult> {
  const brutos = Array.isArray(input.itens) ? input.itens : [];
  const itens = brutos.slice(0, MAX_ITENS_LOTE);

  const out: CriarLoteResult = {
    criadas: [],
    anotadas: [],
    falharam: [],
    truncado: brutos.length > MAX_ITENS_LOTE,
  };

  for (const item of itens) {
    const titulo = cortaSeguro(String(item.titulo ?? "").trim(), MAX_TITULO);
    if (!titulo) continue;

    // Sem frente OU sem data → inbox. Ver o comentário do topo: é aqui que a
    // recusa a inventar prazo acontece de verdade, não só no prompt.
    const temDestino = Boolean(item.frente && String(item.frente).trim());
    const temPrazo = Boolean(item.due_date && String(item.due_date).trim());

    if (!temDestino || !temPrazo) {
      try {
        await deps.saveQuickCapture({ text: cortaSeguro(titulo, MAX_TEXTO_NOTA) });
        out.anotadas.push({ texto: titulo });
      } catch (err) {
        out.falharam.push({ titulo, motivo: motivoCurto(err) });
      }
      continue;
    }

    try {
      // Best-effort POR ITEM, de propósito: um item falhando (frente que não
      // existe, API do gerenciador fora do ar) não pode derrubar os outros
      // cinco. A pessoa já falou tudo uma vez — não vai falar de novo.
      const task = await deps.createTask({
        frente: String(item.frente).trim(),
        list: item.lista ? String(item.lista).trim() : undefined,
        title: titulo,
        due_date: String(item.due_date).trim(),
      });
      out.criadas.push({
        titulo,
        frente: String(item.frente).trim(),
        due_date: String(item.due_date).trim(),
        url: task.url,
      });
    } catch (err) {
      out.falharam.push({ titulo, motivo: motivoCurto(err) });
    }
  }

  return out;
}

/** Motivo curto pro modelo contar o que deu errado, sem despejar stack. */
function motivoCurto(err: unknown): string {
  const texto = err instanceof Error ? err.message : String(err);
  return texto.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 160);
}
