// Trello — listar, criar e concluir cards (tasks). REST API v1 direto via fetch.
// Auth: `key` + `token` como query params em TODA chamada (não é Bearer header
// — convenção da API do Trello).
//
// Configuração (Supabase secrets):
//   TRELLO_API_KEY   — API key da aplicação (trello.com/power-ups/admin)
//   TRELLO_API_TOKEN — token de acesso pessoal (gerado a partir da API key)
//   TRELLO_LIST_MAP  — JSON aninhado: {frente: {listName: listId}}
//                      ex: {"resibag": {"Pauta & Reuniões": "60a1b2c3d4e5f6..."}}
//
// Mesmo modelo de dois níveis do ClickUp (fast/tools/clickup.ts): frente →
// várias lists, cada list tem vários cards. listTasks pode agregar (sem
// `list` no input) ou filtrar uma list específica (com `list`). createTask
// exige `list` obrigatório.
//
// Trello não tem "status" nativo tipo ClickUp (aberto/fechado configurável
// por list) — a convenção usada aqui é o campo `dueComplete` do card:
// dueComplete=true vira status "done", senão "open". Concluir task = PUT
// dueComplete=true no card, sem precisar mover ele entre lists tipo "Done".

import type {
  RescheduleTaskInput as PRescheduleTaskInput,
  RescheduleTaskResult as PRescheduleTaskResult,
  CompleteTaskInput as PCompleteTaskInput,
  CompleteTaskResult as PCompleteTaskResult,
  CreateTaskInput as PCreateTaskInput,
  ListTasksInput as PListTasksInput,
  OpenTaskWithDue,
  TaskItem,
  TaskProvider,
} from "../task-provider.ts";
import { frentesDoEnv } from "../tenant.ts";
import { fetchComRetry } from "../http-retry.ts";

const TRELLO_BASE = "https://api.trello.com/1";

/** {frente: {listName: listId}} — case-insensitive lookup nos dois níveis. */
export type TrelloListMap = Record<string, Record<string, string>>;

export interface TrelloDeps {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
}

export function defaultTrelloDeps(): TrelloDeps {
  return {
    env: (k) => Deno.env.get(k),
    fetch,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function getAuth(env: TrelloDeps["env"]): { key: string; token: string } {
  const key = env("TRELLO_API_KEY");
  const token = env("TRELLO_API_TOKEN");
  if (!key) throw new Error("TRELLO_API_KEY não setada");
  if (!token) throw new Error("TRELLO_API_TOKEN não setada");
  return { key, token };
}

function loadMap(env: TrelloDeps["env"]): TrelloListMap {
  const raw = env("TRELLO_LIST_MAP");
  if (!raw) throw new Error("TRELLO_LIST_MAP não setada");
  try {
    return JSON.parse(raw) as TrelloListMap;
  } catch {
    throw new Error("TRELLO_LIST_MAP não é JSON válido");
  }
}

/** Carrega o map ou retorna null se não configurado/inválido (sem throw). */
export function tryLoadTrelloMap(env: TrelloDeps["env"]): TrelloListMap | null {
  try {
    return loadMap(env);
  } catch {
    return null;
  }
}

function getFrenteMap(
  map: TrelloListMap,
  frente: string,
): Record<string, string> {
  // Case-insensitive frente lookup
  const target = frente.toLowerCase();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === target);
  if (!found) {
    const available = Object.keys(map).join(", ") || "(nenhuma)";
    throw new Error(
      `Frente '${frente}' não tem Trello configurado. Configuradas: ${available}`,
    );
  }
  return found[1];
}

function resolveListId(
  map: TrelloListMap,
  frente: string,
  list: string,
): string {
  const frenteMap = getFrenteMap(map, frente);
  const target = list.toLowerCase();
  const entry = Object.entries(frenteMap).find(
    ([n]) => n.toLowerCase() === target,
  );
  if (!entry) {
    const available = Object.keys(frenteMap).map((n) => `"${n}"`).join(", ");
    throw new Error(
      `List '${list}' não encontrada em '${frente}'. Disponíveis: ${available}`,
    );
  }
  return entry[1];
}

function authParams(url: URL, key: string, token: string): void {
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
}

// ─── tipos internos da API ───────────────────────────────────────────────────

interface TCard {
  id: string;
  name: string;
  due?: string | null;
  dueComplete?: boolean;
  url?: string;
}

function mapCard(c: TCard, listName?: string): TaskItem {
  const base: TaskItem = {
    id: c.id,
    name: c.name,
    status: c.dueComplete ? "done" : "open",
    due_date: c.due ?? null,
    url: c.url ?? "",
  };
  return listName ? { ...base, list: listName } : base;
}

async function fetchListCards(
  listId: string,
  listName: string,
  key: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<TaskItem[]> {
  const url = new URL(`${TRELLO_BASE}/lists/${listId}/cards`);
  url.searchParams.set("fields", "name,due,dueComplete,url,idList");
  authParams(url, key, token);

  const res = await fetchComRetry(url.toString(), {}, fetchFn);
  if (!res.ok) {
    throw new Error(`Trello list cards failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TCard[];
  return data.map((c) => mapCard(c, listName));
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lista cards (tasks) de uma frente.
 * - `list` ausente: agrega TODAS as lists configuradas da frente (paralelo).
 * - `list` presente: filtra àquela list específica.
 * - `limit` corta lado-cliente.
 */
export async function listTasks(
  input: PListTasksInput,
  deps: TrelloDeps = defaultTrelloDeps(),
): Promise<TaskItem[]> {
  const { key, token } = getAuth(deps.env);
  const map = loadMap(deps.env);
  const frenteMap = getFrenteMap(map, input.frente);

  let targets: Array<[string, string]>; // [listName, listId]
  if (input.list) {
    const id = resolveListId(map, input.frente, input.list);
    targets = [[input.list, id]];
  } else {
    targets = Object.entries(frenteMap);
  }

  const batches = await Promise.all(
    targets.map(([name, id]) => fetchListCards(id, name, key, token, deps.fetch)),
  );
  let tasks = batches.flat();
  if (input.limit !== undefined && input.limit > 0) {
    tasks = tasks.slice(0, input.limit);
  }
  return tasks;
}

/** Cria card na list especificada. `list` é obrigatório pro Trello. */
export async function createTask(
  input: PCreateTaskInput & { list: string },
  deps: TrelloDeps = defaultTrelloDeps(),
): Promise<TaskItem> {
  const { key, token } = getAuth(deps.env);
  const map = loadMap(deps.env);
  const listId = resolveListId(map, input.frente, input.list);

  const url = new URL(`${TRELLO_BASE}/cards`);
  url.searchParams.set("idList", listId);
  url.searchParams.set("name", input.title);
  if (input.description) url.searchParams.set("desc", input.description);
  if (input.due_date) {
    url.searchParams.set("due", new Date(input.due_date).toISOString());
  }
  authParams(url, key, token);

  const res = await fetchComRetry(url.toString(), { method: "POST" }, deps.fetch);
  if (!res.ok) {
    throw new Error(`Trello create card failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TCard;
  return mapCard(data, input.list);
}

// ─── Concluir task (marcar dueComplete=true a partir do chat) ───────────────

/**
 * Marca como concluído (dueComplete=true) o card cujo nome contém `query`
 * (case-insensitive), procurando só entre cards ainda ABERTOS (dueComplete
 * falso) na frente (ou só na list, se vier).
 * - Nenhum match: throw (executeTool traduz em {error}).
 * - Mais de um match: devolve candidates pro modelo pedir pro usuário escolher.
 * - Exatamente um: faz o PUT dueComplete=true.
 */
export async function completeTask(
  input: PCompleteTaskInput,
  deps: TrelloDeps = defaultTrelloDeps(),
): Promise<PCompleteTaskResult> {
  const { key, token } = getAuth(deps.env);
  const tasks = await listTasks({ frente: input.frente, list: input.list }, deps);
  const openTasks = tasks.filter((t) => t.status === "open");

  const q = input.query.trim().toLowerCase();
  const matches = openTasks.filter((t) => t.name.toLowerCase().includes(q));
  if (matches.length === 0) {
    throw new Error(`Nenhuma task aberta encontrada com '${input.query}' em '${input.frente}'`);
  }
  if (matches.length > 1) return { candidates: matches };

  const [task] = matches;
  const url = new URL(`${TRELLO_BASE}/cards/${task.id}`);
  url.searchParams.set("dueComplete", "true");
  authParams(url, key, token);

  const res = await fetchComRetry(url.toString(), { method: "PUT" }, deps.fetch);
  if (!res.ok) {
    throw new Error(`Trello update card failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TCard;
  return { matched: mapCard(data, task.list) };
}

/**
 * Muda só o `due` do card que casa com `query` — `dueComplete` intocado.
 * A data chega como YYYY-MM-DD; o Trello guarda instante, então vira o fim do
 * dia em SP (mesma leitura de "prazo é até o fim daquele dia" que o resto
 * da plataforma usa).
 */
export async function rescheduleTask(
  input: PRescheduleTaskInput,
  deps: TrelloDeps = defaultTrelloDeps(),
): Promise<PRescheduleTaskResult> {
  const { key, token } = getAuth(deps.env);
  const tasks = await listTasks({ frente: input.frente, list: input.list }, deps);
  const openTasks = tasks.filter((t) => t.status === "open");

  const q = input.query.trim().toLowerCase();
  const matches = openTasks.filter((t) => t.name.toLowerCase().includes(q));
  if (matches.length === 0) {
    throw new Error(`Nenhuma task aberta encontrada com '${input.query}' em '${input.frente}'`);
  }
  if (matches.length > 1) return { candidates: matches };

  const [task] = matches;
  const url = new URL(`${TRELLO_BASE}/cards/${task.id}`);
  url.searchParams.set("due", `${input.due_date}T23:59:00-03:00`);
  authParams(url, key, token);

  const res = await fetchComRetry(url.toString(), { method: "PUT" }, deps.fetch);
  if (!res.ok) {
    throw new Error(`Trello update due failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TCard;
  return { matched: mapCard(data, task.list) };
}

// ─── "O que eu faço agora": tasks com prazo, cross-frente ───────────────────

/** Agrega cards abertos COM prazo de todas as frentes/lists configuradas. */
export async function listAllOpenTasksWithDue(
  deps: TrelloDeps = defaultTrelloDeps(),
): Promise<OpenTaskWithDue[]> {
  const { key, token } = getAuth(deps.env);
  const map = loadMap(deps.env);

  const targets: Array<{ frente: string; list: string; id: string }> = [];
  for (const [frente, lists] of Object.entries(map)) {
    for (const [list, id] of Object.entries(lists)) targets.push({ frente, list, id });
  }

  const batches = await Promise.all(
    targets.map(async (t) => {
      const tasks = await fetchListCards(t.id, t.list, key, token, deps.fetch);
      return tasks
        .filter((task) => task.due_date && task.status === "open")
        .map((task): OpenTaskWithDue => ({ ...task, frente: t.frente }));
    }),
  );
  return batches.flat();
}

// ─── System prompt block builder ─────────────────────────────────────────────

/**
 * Gera o bloco do system prompt do Sonnet com base no map carregado.
 * - Sem map ou vazio: bloco curto "não configurado".
 * - Com map: lista frentes/lists configuradas + lista frentes faltantes
 *   pra Sonnet saber o que dizer quando o usuário pedir tasks de uma frente
 *   que não tem Trello.
 */
export function buildTrelloSystemBlock(map: TrelloListMap | null, frentes: string[] = []): string {
  if (!map || Object.keys(map).length === 0) {
    return `ACESSO AO TRELLO (tarefas)
- Não configurado. Se pedirem tasks (listar ou criar), diga que Trello ainda não está integrado.`;
  }

  const frentesList = Object.entries(map)
    .map(([frente, lists]) => {
      const names = Object.keys(lists).map((n) => `"${n}"`).join(", ");
      return `  - ${frente}: ${names}`;
    })
    .join("\n");

  const knownFrentes = Object.keys(map).map((f) => f.toLowerCase());
  const missingFrentes = frentes.filter((f) => !knownFrentes.includes(f));

  const missingNote = missingFrentes.length === 0
    ? ""
    : `\n- Frentes SEM Trello configurado: ${missingFrentes.join(", ")}. Se pedirem tasks de uma dessas, diga que essa frente ainda não está integrada — não chame a tool.`;

  return `ACESSO AO TRELLO (tarefas)
- 3 tools: list_tasks(frente, list?, limit?), create_task(frente, list, title, ...), complete_task(frente, query, list?).
- Frentes e suas lists no Trello:
${frentesList}
- list_tasks: \`list\` é opcional — sem ele, agrega tasks de TODAS as lists da frente.
- create_task: \`list\` é OBRIGATÓRIO. Se o usuário não disser onde (qual list dentro da frente), PERGUNTE — não chute.
- complete_task: use quando o usuário disser que JÁ FEZ algo que soa como task existente (ex: "já apresentei o deck pro cliente", "terminei o X"). \`query\` é um trecho do nome da task pra identificar qual — se vier \`candidates\` (mais de uma task parecida), pergunte qual antes de marcar.${missingNote}`;
}

// ─── Adapter: encaixa as funções acima na interface TaskProvider comum ──────

export function createTrelloProvider(env?: (key: string) => string | undefined): TaskProvider {
  const deps = env ? { ...defaultTrelloDeps(), env } : defaultTrelloDeps();

  return {
    name: "trello",

    listTasks: (input: PListTasksInput): Promise<TaskItem[]> =>
      listTasks(input, deps),

    createTask: (input: PCreateTaskInput): Promise<TaskItem> => {
      if (!input.list) {
        throw new Error(
          "Trello exige `list` pra criar card — pergunte em qual list.",
        );
      }
      return createTask({ ...input, list: input.list }, deps);
    },

    completeTask: (input: PCompleteTaskInput): Promise<PCompleteTaskResult> =>
      completeTask(input, deps),

    rescheduleTask: (input: PRescheduleTaskInput): Promise<PRescheduleTaskResult> =>
      rescheduleTask(input, deps),

    listAllOpenTasksWithDue: (): Promise<OpenTaskWithDue[]> =>
      listAllOpenTasksWithDue(deps),

    buildSystemBlock: (): string => {
      const map = tryLoadTrelloMap(deps.env);
      return buildTrelloSystemBlock(map, frentesDoEnv(deps.env));
    },
  };
}
