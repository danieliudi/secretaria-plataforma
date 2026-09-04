// Interface comum de gerenciador de tarefas. Cada plataforma suportada
// (ClickUp, Notion, Trello, Google Tasks) implementa este contrato — o fast
// chama sempre os mesmos métodos, sem saber qual plataforma está por trás.
//
// Modelo de dados comum, o menor denominador entre as 4 plataformas:
//   - "frente" = agrupador de topo (frente de negócio: Resibag, Sanwey, ...).
//     ClickUp/Trello mapeiam frente → board/space com múltiplas lists.
//     Notion/Google Tasks mapeiam frente → 1 database/tasklist (sem sub-nível
//     — a granularidade de "list" dentro da frente não existe nessas duas).
//   - "list" (opcional) = sub-agrupador dentro da frente. Só ClickUp e Trello
//     suportam de verdade; Notion e Google Tasks ignoram esse parâmetro.
//
// Seleção do provider: variável de ambiente TASK_PROVIDER
// ("clickup" | "notion" | "trello" | "google_tasks"), default "clickup"
// (compatibilidade com a configuração atual). Quando o produto ganhar tabela
// de tenants, essa escolha migra de env var pra coluna por tenant — a
// interface já fica pronta, só troca a fonte de configuração.

export interface TaskItem {
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  url: string;
  /** Nome da list/sub-agrupador, quando a plataforma suporta. */
  list?: string;
  /**
   * Por que o prazo pedido não pôde ser gravado. Só aparece quando a tarefa
   * FOI criada mas o prazo ficou de fora — e existe pra que a secretária diga
   * isso em vez de repetir de volta o que o usuário acabou de pedir.
   *
   * Achado em 04/09/2026: a Erika pediu "Procurar bolo para hj às 8:30", a
   * tarefa nasceu no Notion sem data nenhuma, e a resposta foi "Criado! prazo
   * hoje 8h30". O banco dela não tem coluna de data, e o provider descartava
   * o prazo em silêncio — enquanto o remarcar, no mesmo arquivo, já recusava
   * alto e bom som pelo mesmo motivo.
   */
  avisoPrazo?: string;
}

export interface ListTasksInput {
  frente: string;
  list?: string;
  limit?: number;
}

export interface CreateTaskInput {
  frente: string;
  /** Obrigatório só faz sentido pra ClickUp/Trello; Notion/Google Tasks ignoram. */
  list?: string;
  title: string;
  description?: string;
  due_date?: string;
}

export interface CompleteTaskInput {
  frente: string;
  query: string;
  list?: string;
}

export type CompleteTaskResult =
  | { matched: TaskItem }
  | { candidates: TaskItem[] };

export interface RescheduleTaskInput {
  frente: string;
  /** Trecho do nome da task, do jeito que o usuário descreveu. */
  query: string;
  /** Novo prazo, YYYY-MM-DD (dia no fuso de SP). */
  due_date: string;
  /** Só ClickUp/Trello usam; os outros ignoram. */
  list?: string;
}

/** Mesma forma do complete: ou casou uma, ou tem ambiguidade pra resolver. */
export type RescheduleTaskResult =
  | { matched: TaskItem }
  | { candidates: TaskItem[] };

/** Quanto pra frente um prazo pode ser remarcado. Além disso é erro do modelo. */
const REMARCAR_MAX_ANOS = 5;

/**
 * Converte o `due_date` que veio do provider em epoch ms, ANCORADO AO MEIO-DIA
 * UTC quando ele é só data (sem hora).
 *
 * Por que isso não é detalhe (achado de 02/09/2026): `new Date("2026-09-01")`
 * é lido pelo JavaScript como MEIA-NOITE UTC. Convertido pra São Paulo (UTC−3)
 * vira 31/08 às 21:00 — ou seja, o dia do prazo anda um dia PRA TRÁS. Como
 * praticamente todo provider devolve prazo só como data (sanwey_tasks, Google
 * Tasks, Notion), isso desviava o sistema proativo inteiro em um dia:
 *
 *   - o fim do dia descartava as tarefas que venciam HOJE (elas "eram" ontem),
 *     e foi por isso que a mensagem das 19h de 01/09 disse "Tinha 1 coisa hoje"
 *     quando tinha três;
 *   - `atrasadas_check` e `runAlerts` davam a tarefa como vencida um dia antes.
 *
 * Meio-dia UTC é o mesmo truque que `validaDueDate` logo abaixo e o `hojeEmSP`
 * do cron já usam: fica longe das duas bordas do dia em qualquer fuso do
 * Brasil, então nunca vira de dia na conversão. Prazo que JÁ vem com hora
 * (ClickUp manda epoch, Outlook manda ISO completo) passa direto — ali a hora
 * é informação de verdade, não artefato de formato.
 */
export function msDoPrazo(due: string): number {
  return new Date(prazoSoTemData(due) ? `${due.trim()}T12:00:00Z` : due).getTime();
}

/**
 * O prazo veio SEM hora ("2026-09-03")?
 *
 * Existe porque a âncora do meio-dia de `msDoPrazo` acerta o DIA e, justamente
 * por isso, produz uma HORA que ninguém marcou — meio-dia UTC é 09:00 em São
 * Paulo. Em 03/09/2026 isso apareceu duas vezes no mesmo minuto:
 *
 *   - a mensagem exibia "vence 03/09, 09:00" pra um prazo que era só a data;
 *   - e o alerta declarou três tarefas VENCIDAS às 14:00, quando elas ainda
 *     tinham 10 horas — porque comparou `agora` com a âncora.
 *
 * Quem sabe se há hora consegue fazer as duas coisas certas: não imprimir hora
 * inventada, e medir o vencimento pelo FIM do dia (ver fimDoPrazoMs).
 */
export function prazoSoTemData(due: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(due.trim());
}

/**
 * O instante em que o prazo REALMENTE acaba, em ms.
 *
 * Prazo com hora acaba na hora marcada. Prazo só com data acaba às 23:59:59,9
 * daquele dia em São Paulo — é o que qualquer pessoa entende por "vence dia 3",
 * e é a diferença entre avisar que algo venceu e avisar que ainda dá tempo.
 */
export function fimDoPrazoMs(due: string): number {
  if (!prazoSoTemData(due)) return new Date(due).getTime();
  // 00:00 do dia SEGUINTE em SP (= 03:00Z), menos 1 ms.
  const dia = new Date(`${due.trim()}T03:00:00.000Z`);
  return dia.getTime() + 24 * 3600_000 - 1;
}

/**
 * Valida o `due_date` que o MODELO produziu, antes de ele chegar em qualquer
 * provider. Devolve a data normalizada (YYYY-MM-DD) ou lança com um texto que
 * o modelo consegue ler e corrigir.
 *
 * Existe porque cada provider trata lixo de um jeito diferente, e o pior deles
 * é silencioso: o ClickUp recebe epoch ms, e `new Date("quinta").getTime()` é
 * NaN, que vira `null` no JSON e APAGA o prazo da tarefa. O usuário pediu pra
 * empurrar pra quinta e a tarefa sairia do radar sem erro nenhum. Um único
 * portão aqui vale mais que seis tratamentos parecidos lá dentro.
 *
 * `hojeISO` (YYYY-MM-DD no fuso do usuário) entra por parâmetro pra não
 * depender do relógio do processo em teste.
 */
export function validaDueDate(bruto: string, hojeISO: string): string {
  const data = bruto.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error(
      `Prazo inválido: '${bruto}'. Mande a data resolvida no formato AAAA-MM-DD (ex: 2026-09-07), não "quinta" nem "semana que vem".`,
    );
  }

  // Date aceita 2026-02-31 e rola pra março sozinho — comparar de volta é o
  // que pega dia que não existe.
  const d = new Date(`${data}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== data) {
    throw new Error(`Prazo inválido: '${bruto}' não é uma data que existe no calendário.`);
  }

  // Ontem ainda passa (borda de fuso na virada do dia); anteontem não.
  const hoje = new Date(`${hojeISO}T12:00:00Z`);
  const minimo = new Date(hoje.getTime() - 24 * 3600_000);
  if (d.getTime() < minimo.getTime()) {
    throw new Error(`Prazo no passado: '${data}'. Remarcar é pra frente — escolha hoje ou depois.`);
  }

  const maximo = new Date(hoje);
  maximo.setUTCFullYear(maximo.getUTCFullYear() + REMARCAR_MAX_ANOS);
  if (d.getTime() > maximo.getTime()) {
    throw new Error(`Prazo longe demais: '${data}'. Confira o ano.`);
  }

  return data;
}

export interface OpenTaskWithDue extends TaskItem {
  frente: string;
}

export interface TaskProvider {
  /** Nome curto pra logs/erros — "clickup", "notion", "trello", "google_tasks". */
  readonly name: string;
  listTasks(input: ListTasksInput): Promise<TaskItem[]>;
  createTask(input: CreateTaskInput): Promise<TaskItem>;
  completeTask(input: CompleteTaskInput): Promise<CompleteTaskResult>;
  /**
   * Muda o PRAZO de uma task que já existe (não cria outra, não mexe no
   * status). OPCIONAL de propósito: é o único método que nem toda plataforma
   * suportada expõe de forma inequívoca, e um provider que não consegue deve
   * poder dizer "não sei fazer isso" — quem chama checa `if
   * (provider.rescheduleTask)` e avisa, em vez de estourar em runtime.
   */
  rescheduleTask?(input: RescheduleTaskInput): Promise<RescheduleTaskResult>;
  /** Agrega tasks com prazo de TODAS as frentes configuradas — usado por what_now. */
  listAllOpenTasksWithDue(): Promise<OpenTaskWithDue[]>;
  /** Bloco de texto pro system prompt do Sonnet, descrevendo frentes/lists disponíveis. */
  buildSystemBlock(): string;
}

export type TaskProviderKind = "clickup" | "notion" | "trello" | "google_tasks" | "microsoft_todo" | "sanwey_tasks";

const VALID_KINDS: ReadonlySet<string> = new Set([
  "clickup",
  "notion",
  "trello",
  "google_tasks",
  "microsoft_todo",
  "sanwey_tasks",
]);

export function resolveTaskProviderKind(
  env: (key: string) => string | undefined,
): TaskProviderKind {
  const raw = env("TASK_PROVIDER")?.trim().toLowerCase();
  if (raw && VALID_KINDS.has(raw)) return raw as TaskProviderKind;
  return "clickup"; // default — compatibilidade com configuração atual
}
