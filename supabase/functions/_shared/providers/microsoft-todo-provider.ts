// Microsoft To Do — listar, criar e concluir tasks via Microsoft Graph API.
// Auth: OAuth2 (Bearer token), obtido via getMicrosoftAccessToken() em
// ../microsoft-oauth.ts — reusa a troca de refresh_token → access_token, não
// reimplementa OAuth aqui. Mesmo desenho do google-tasks-provider.ts.
//
// Configuração (Supabase secrets, além de MICROSOFT_CLIENT_ID/SECRET em
// microsoft-oauth.ts):
//   MICROSOFT_TODO_LIST_MAP — JSON simples (NÃO aninhado, igual ao Google
//                             Tasks): {frente: "listId"}
//
// Modelo de dados: Microsoft To Do também só tem UM nível — listas contendo
// tasks (sem pastas dentro de uma lista). "frente" mapeia DIRETO pra uma
// lista, e `list` (que faz sentido pra ClickUp/Trello) é sempre IGNORADO.
//
// Diferenças da Graph API em relação à Google Tasks API que valem registrar:
//   - Resposta de listagem vem em `value`, não `items`.
//   - Sem URL pública por task (mesma limitação do Google Tasks) — `url` fica
//     sempre vazio.
//   - Prazo é um objeto {dateTime, timeZone} (não uma string RFC3339 solta) —
//     igual ao Google Tasks, só a DATA é honrada aqui (hora zerada), pra
//     manter os dois provedores com o mesmo comportamento observável.
//   - Filtra tasks abertas com $filter=status ne 'completed' (Google Tasks
//     usa showCompleted=false — resultado equivalente).

import { defaultMicrosoftOAuthDeps, getMicrosoftAccessToken } from "../microsoft-oauth.ts";
import type { MicrosoftOAuthDeps } from "../microsoft-oauth.ts";
import type {
  CompleteTaskInput as PCompleteTaskInput,
  CompleteTaskResult as PCompleteTaskResult,
  CreateTaskInput as PCreateTaskInput,
  ListTasksInput as PListTasksInput,
  OpenTaskWithDue,
  TaskItem,
  TaskProvider,
} from "../task-provider.ts";
import { frentesDoEnv } from "../tenant.ts";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const DUE_TIME_ZONE = "UTC";

/** {frente: listId} — map plano, sem sub-nível (mesmo formato do Google Tasks). */
export type MicrosoftTodoListMap = Record<string, string>;

export interface MicrosoftTodoItem {
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  url: string;
}

export interface ListTasksInput {
  frente: string;
  /** Ignorado — Microsoft To Do não tem sub-listas dentro da frente. */
  list?: string;
  limit?: number;
}

export interface CreateTaskInput {
  frente: string;
  /** Ignorado — Microsoft To Do não tem sub-listas dentro da frente. */
  list?: string;
  title: string;
  description?: string;
  due_date?: string;
}

export interface CompleteTaskInput {
  frente: string;
  /** Trecho do nome da task (case-insensitive) pra identificar qual concluir. */
  query: string;
  /** Ignorado — Microsoft To Do não tem sub-listas dentro da frente. */
  list?: string;
}

export type CompleteTaskResult =
  | { matched: MicrosoftTodoItem }
  | { candidates: MicrosoftTodoItem[] };

export interface OpenMicrosoftTodoItemWithDue extends MicrosoftTodoItem {
  frente: string;
}

export interface MicrosoftTodoDeps {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  getAccessToken: (deps?: MicrosoftOAuthDeps) => Promise<string>;
}

export function defaultMicrosoftTodoDeps(): MicrosoftTodoDeps {
  return {
    env: (k) => Deno.env.get(k),
    fetch,
    getAccessToken: getMicrosoftAccessToken,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadMap(env: MicrosoftTodoDeps["env"]): MicrosoftTodoListMap {
  const raw = env("MICROSOFT_TODO_LIST_MAP");
  if (!raw) throw new Error("MICROSOFT_TODO_LIST_MAP não setada");
  try {
    return JSON.parse(raw) as MicrosoftTodoListMap;
  } catch {
    throw new Error("MICROSOFT_TODO_LIST_MAP não é JSON válido");
  }
}

/** Carrega o map ou retorna null se não configurado/inválido (sem throw). */
export function tryLoadMicrosoftTodoMap(
  env: MicrosoftTodoDeps["env"],
): MicrosoftTodoListMap | null {
  try {
    return loadMap(env);
  } catch {
    return null;
  }
}

/** Resolve a lista configurada pra `frente` (lookup case-insensitive). */
function resolveListId(map: MicrosoftTodoListMap, frente: string): string {
  const target = frente.toLowerCase();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === target);
  if (!found) {
    const available = Object.keys(map).join(", ") || "(nenhuma)";
    throw new Error(
      `Frente '${frente}' não tem Microsoft To Do configurado. Configuradas: ${available}`,
    );
  }
  return found[1];
}

async function getAuthHeaders(
  deps: MicrosoftTodoDeps,
): Promise<Record<string, string>> {
  const token = await deps.getAccessToken({ env: deps.env, fetch: deps.fetch });
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/** Só a parte de DATA é honrada (hora zerada) — mesma regra do Google Tasks. */
function buildDueDateTime(dueDate: string): { dateTime: string; timeZone: string } {
  const datePart = dueDate.slice(0, 10); // "2026-08-20" de "2026-08-20T14:00:00Z" ou já solto
  return { dateTime: `${datePart}T00:00:00.0000000`, timeZone: DUE_TIME_ZONE };
}

// ─── tipos internos da API (Microsoft Graph To Do) ──────────────────────────

interface GraphTodoTask {
  id: string;
  title: string;
  status?: string; // "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred"
  dueDateTime?: { dateTime: string; timeZone: string };
}

interface GraphListResponse {
  value?: GraphTodoTask[];
  "@odata.nextLink"?: string;
}

function mapTask(t: GraphTodoTask): MicrosoftTodoItem {
  return {
    id: t.id,
    name: t.title,
    status: t.status ?? "notStarted",
    due_date: t.dueDateTime?.dateTime ?? null,
    // Graph não expõe uma URL web addressable pra uma task específica —
    // mesma limitação do Google Tasks.
    url: "",
  };
}

async function fetchListTasks(
  listId: string,
  deps: MicrosoftTodoDeps,
  { onlyOpen = true }: { onlyOpen?: boolean } = {},
): Promise<MicrosoftTodoItem[]> {
  const headers = await getAuthHeaders(deps);
  const tasks: MicrosoftTodoItem[] = [];

  const firstUrl = new URL(`${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks`);
  if (onlyOpen) firstUrl.searchParams.set("$filter", "status ne 'completed'");
  firstUrl.searchParams.set("$top", "100");

  // Microsoft Graph pagina via "@odata.nextLink" (URL completa pra próxima
  // página) — sem seguir isso, uma lista com mais de 100 tasks abertas perde
  // o excedente em silêncio.
  let nextUrl: string | undefined = firstUrl.toString();
  while (nextUrl) {
    const res = await deps.fetch(nextUrl, { headers });
    if (!res.ok) {
      throw new Error(`Microsoft To Do list failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as GraphListResponse;
    tasks.push(...(data.value ?? []).map(mapTask));
    nextUrl = data["@odata.nextLink"];
  }

  return tasks;
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lista tasks abertas de uma frente.
 * - `list` é ignorado — Microsoft To Do não tem sub-listas dentro da frente.
 * - `limit` corta lado-cliente.
 */
export async function listTasks(
  input: ListTasksInput,
  deps: MicrosoftTodoDeps = defaultMicrosoftTodoDeps(),
): Promise<MicrosoftTodoItem[]> {
  const map = loadMap(deps.env);
  const listId = resolveListId(map, input.frente);

  let tasks = await fetchListTasks(listId, deps);
  if (input.limit !== undefined && input.limit > 0) {
    tasks = tasks.slice(0, input.limit);
  }
  return tasks;
}

/**
 * Cria task na lista da frente. `list` é ignorado.
 * `due_date`, se enviado, só agenda a DATA — hora fica zerada (mesma regra
 * do Google Tasks, pra não ter comportamento diferente entre provedores).
 */
export async function createTask(
  input: CreateTaskInput,
  deps: MicrosoftTodoDeps = defaultMicrosoftTodoDeps(),
): Promise<MicrosoftTodoItem> {
  const map = loadMap(deps.env);
  const listId = resolveListId(map, input.frente);
  const headers = await getAuthHeaders(deps);

  const body: Record<string, unknown> = { title: input.title };
  if (input.description) body.body = { content: input.description, contentType: "text" };
  if (input.due_date) body.dueDateTime = buildDueDateTime(input.due_date);

  const res = await deps.fetch(
    `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    throw new Error(`Microsoft To Do create failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GraphTodoTask;
  return mapTask(data);
}

/**
 * Marca como concluída a task cujo nome contém `query` (case-insensitive).
 * `list` é ignorado.
 * - Nenhum match: throw (executeTool traduz em {error}).
 * - Mais de um match: devolve candidates pro modelo pedir pro usuário escolher.
 * - Exatamente um: PATCH status → "completed".
 */
export async function completeTask(
  input: CompleteTaskInput,
  deps: MicrosoftTodoDeps = defaultMicrosoftTodoDeps(),
): Promise<CompleteTaskResult> {
  const map = loadMap(deps.env);
  const listId = resolveListId(map, input.frente);
  const tasks = await listTasks({ frente: input.frente }, deps);

  const q = input.query.trim().toLowerCase();
  const matches = tasks.filter((t) => t.name.toLowerCase().includes(q));
  if (matches.length === 0) {
    throw new Error(
      `Nenhuma task aberta encontrada com '${input.query}' em '${input.frente}'`,
    );
  }
  if (matches.length > 1) return { candidates: matches };

  const [task] = matches;
  const headers = await getAuthHeaders(deps);
  const res = await deps.fetch(
    `${GRAPH_BASE}/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(task.id)}`,
    { method: "PATCH", headers, body: JSON.stringify({ status: "completed" }) },
  );
  if (!res.ok) {
    throw new Error(`Microsoft To Do update status failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GraphTodoTask;
  return { matched: mapTask(data) };
}

// ─── "O que eu faço agora": tasks com prazo, cross-frente ───────────────────

/** Agrega tasks abertas COM prazo de todas as frentes configuradas. */
export async function listAllOpenTasksWithDue(
  deps: MicrosoftTodoDeps = defaultMicrosoftTodoDeps(),
): Promise<OpenMicrosoftTodoItemWithDue[]> {
  const map = loadMap(deps.env);

  const batches = await Promise.all(
    Object.entries(map).map(async ([frente, listId]) => {
      const tasks = await fetchListTasks(listId, deps);
      return tasks
        .filter((task) => task.due_date)
        .map((task): OpenMicrosoftTodoItemWithDue => ({ ...task, frente }));
    }),
  );
  return batches.flat();
}

// ─── System prompt block builder ─────────────────────────────────────────────

/**
 * Gera o bloco do system prompt do Sonnet com base no map carregado.
 * Mesma estrutura de buildGoogleTasksSystemBlock — mantém o modelo agindo
 * igual entre os dois provedores "sem lista dentro da frente".
 */
export function buildMicrosoftTodoSystemBlock(map: MicrosoftTodoListMap | null, frentes: string[] = []): string {
  if (!map || Object.keys(map).length === 0) {
    return `ACESSO AO MICROSOFT TO DO (tarefas)
- Não configurado. Se pedirem tasks (listar ou criar), diga que Microsoft To Do ainda não está integrado.`;
  }

  const frentesList = Object.keys(map)
    .map((frente) => `  - ${frente}`)
    .join("\n");

  const knownFrentes = Object.keys(map).map((f) => f.toLowerCase());
  const missingFrentes = frentes.filter((f) => !knownFrentes.includes(f));

  const missingNote = missingFrentes.length === 0
    ? ""
    : `\n- Frentes SEM Microsoft To Do configurado: ${missingFrentes.join(", ")}. Se pedirem tasks de uma dessas, diga que essa frente ainda não está integrada — não chame a tool.`;

  return `ACESSO AO MICROSOFT TO DO (tarefas)
- 3 tools: list_tasks(frente, limit?), create_task(frente, title, ...), complete_task(frente, query).
- Frentes com Microsoft To Do configurado:
${frentesList}
- IMPORTANTE: igual ao Google Tasks, Microsoft To Do NÃO tem sub-listas dentro da frente — é só a frente inteira como uma lista única. Não existe parâmetro \`list\` aqui; não pergunte "em qual list" nem tente usá-lo.
- create_task: due_date, se enviado, só agenda a DATA — Microsoft To Do ignora o horário.
- complete_task: use quando o usuário disser que JÁ FEZ algo que soa como task existente (ex: "já apresentei o deck pro cliente", "terminei o X"). \`query\` é um trecho do nome da task pra identificar qual — se vier \`candidates\` (mais de uma task parecida), pergunte qual antes de marcar.${missingNote}`;
}

// ─── Adapter: encaixa na interface TaskProvider comum ───────────────────────

export function createMicrosoftTodoProvider(env?: (key: string) => string | undefined): TaskProvider {
  const deps = env ? { ...defaultMicrosoftTodoDeps(), env } : defaultMicrosoftTodoDeps();

  return {
    name: "microsoft_todo",

    listTasks: (input: PListTasksInput): Promise<TaskItem[]> =>
      listTasks({ frente: input.frente, limit: input.limit }, deps),

    createTask: (input: PCreateTaskInput): Promise<TaskItem> =>
      createTask(
        {
          frente: input.frente,
          title: input.title,
          description: input.description,
          due_date: input.due_date,
        },
        deps,
      ),

    completeTask: (input: PCompleteTaskInput): Promise<PCompleteTaskResult> =>
      completeTask({ frente: input.frente, query: input.query }, deps),

    listAllOpenTasksWithDue: (): Promise<OpenTaskWithDue[]> =>
      listAllOpenTasksWithDue(deps),

    buildSystemBlock: (): string => {
      const map = tryLoadMicrosoftTodoMap(deps.env);
      return buildMicrosoftTodoSystemBlock(map, frentesDoEnv(deps.env));
    },
  };
}
