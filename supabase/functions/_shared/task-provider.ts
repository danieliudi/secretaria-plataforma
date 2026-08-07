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

export interface OpenTaskWithDue extends TaskItem {
  frente: string;
}

export interface TaskProvider {
  /** Nome curto pra logs/erros — "clickup", "notion", "trello", "google_tasks". */
  readonly name: string;
  listTasks(input: ListTasksInput): Promise<TaskItem[]>;
  createTask(input: CreateTaskInput): Promise<TaskItem>;
  completeTask(input: CompleteTaskInput): Promise<CompleteTaskResult>;
  /** Agrega tasks com prazo de TODAS as frentes configuradas — usado por what_now. */
  listAllOpenTasksWithDue(): Promise<OpenTaskWithDue[]>;
  /** Bloco de texto pro system prompt do Sonnet, descrevendo frentes/lists disponíveis. */
  buildSystemBlock(): string;
}

export type TaskProviderKind = "clickup" | "notion" | "trello" | "google_tasks";

const VALID_KINDS: ReadonlySet<string> = new Set([
  "clickup",
  "notion",
  "trello",
  "google_tasks",
]);

export function resolveTaskProviderKind(
  env: (key: string) => string | undefined,
): TaskProviderKind {
  const raw = env("TASK_PROVIDER")?.trim().toLowerCase();
  if (raw && VALID_KINDS.has(raw)) return raw as TaskProviderKind;
  return "clickup"; // default — compatibilidade com configuração atual
}
