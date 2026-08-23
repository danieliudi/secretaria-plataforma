// ClickUp — listar e criar tasks. POST/GET diretos na API v2.
// Auth: API token pessoal (sem "Bearer" prefix — convenção do ClickUp).
//
// Configuração (Supabase secrets):
//   CLICKUP_API_TOKEN     — token pessoal (gerado em app.clickup.com/settings/apps)
//   CLICKUP_LIST_MAP      — JSON aninhado: {frente: {listName: listId}}
//                           ex: {"resibag": {"Pauta & Reuniões": "901713327172", ...}}
//
// Schema do map permite múltiplas lists por frente. listTasks pode agregar
// (sem `list` no input) ou filtrar uma list específica (com `list`).
// createTask exige `list` obrigatório.

const CLICKUP_BASE = "https://api.clickup.com/api/v2";

/** {frente: {listName: listId}} — case-insensitive lookup nos dois níveis. */
export type ClickUpListMap = Record<string, Record<string, string>>;

export interface ClickUpTask {
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  url: string;
  /** Nome da list onde a task vive. Populado quando agregando de múltiplas lists. */
  list?: string;
}

export interface ListTasksInput {
  frente: string;
  /** (opcional) Nome da list dentro da frente. Sem ele, agrega tasks de todas. */
  list?: string;
  limit?: number;
}

export interface CreateTaskInput {
  frente: string;
  /** Obrigatório — o modelo deve perguntar se o usuário não disser. */
  list: string;
  title: string;
  description?: string;
  due_date?: string;
}

export interface ClickUpDeps {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
}

export function defaultClickUpDeps(): ClickUpDeps {
  return {
    env: (k) => Deno.env.get(k),
    fetch,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function getApiToken(env: ClickUpDeps["env"]): string {
  const token = env("CLICKUP_API_TOKEN");
  if (!token) throw new Error("CLICKUP_API_TOKEN não setada");
  return token;
}

function loadMap(env: ClickUpDeps["env"]): ClickUpListMap {
  const raw = env("CLICKUP_LIST_MAP");
  if (!raw) throw new Error("CLICKUP_LIST_MAP não setada");
  try {
    return JSON.parse(raw) as ClickUpListMap;
  } catch {
    throw new Error("CLICKUP_LIST_MAP não é JSON válido");
  }
}

/** Carrega o map ou retorna null se não configurado/inválido (sem throw). */
export function tryLoadClickUpMap(env: ClickUpDeps["env"]): ClickUpListMap | null {
  try {
    return loadMap(env);
  } catch {
    return null;
  }
}

function getFrenteMap(
  map: ClickUpListMap,
  frente: string,
): Record<string, string> {
  // Case-insensitive frente lookup
  const target = frente.toLowerCase();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === target);
  if (!found) {
    const available = Object.keys(map).join(", ") || "(nenhuma)";
    throw new Error(
      `Frente '${frente}' não tem ClickUp configurado. Configuradas: ${available}`,
    );
  }
  return found[1];
}

function resolveListId(
  map: ClickUpListMap,
  frente: string,
  list: string,
): string {
  const frenteMap = getFrenteMap(map, frente);
  const target = list.toLowerCase();
  const entry = Object.entries(frenteMap).find(
    ([n]) => n.toLowerCase() === target,
  );
  if (!entry) {
    const available = Object.keys(frenteMap).map((n) => `\"${n}\"`).join(", ");
    throw new Error(
      `List '${list}' não encontrada em '${frente}'. Disponíveis: ${available}`,
    );
  }
  return entry[1];
}

// ─── tipos internos da API ───────────────────────────────────────────────────

interface GTask {
  id: string;
  name: string;
  status?: { status?: string };
  due_date?: string | null;
  url?: string;
}

function mapTask(t: GTask, listName?: string): ClickUpTask {
  const base: ClickUpTask = {
    id: t.id,
    name: t.name,
    status: t.status?.status ?? "",
    due_date: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
    url: t.url ?? "",
  };
  return listName ? { ...base, list: listName } : base;
}

// ClickUp devolve no máximo 100 tasks por página e não manda contagem total
// nem "has_more" — a própria API recomenda parar quando uma página vem com
// MENOS que o tamanho máximo (uma página cheia sempre pode ter mais atrás).
const CLICKUP_PAGE_SIZE = 100;

async function fetchListTasks(
  listId: string,
  listName: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<ClickUpTask[]> {
  const tasks: ClickUpTask[] = [];
  let page = 0;

  for (;;) {
    const url = new URL(`${CLICKUP_BASE}/list/${listId}/task`);
    url.searchParams.set("archived", "false");
    url.searchParams.set("page", String(page));

    const res = await fetchFn(url.toString(), {
      headers: { Authorization: token },
    });
    if (!res.ok) {
      throw new Error(`ClickUp list failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { tasks?: GTask[] };
    const pageTasks = data.tasks ?? [];
    tasks.push(...pageTasks.map((t) => mapTask(t, listName)));

    if (pageTasks.length < CLICKUP_PAGE_SIZE) break;
    page++;
  }

  return tasks;
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lista tasks de uma frente.
 * - `list` ausente: agrega TODAS as lists configuradas da frente (paralelo).
 * - `list` presente: filtra àquela list específica.
 * - `limit` corta lado-cliente.
 */
export async function listTasks(
  input: ListTasksInput,
  deps: ClickUpDeps = defaultClickUpDeps(),
): Promise<ClickUpTask[]> {
  const token = getApiToken(deps.env);
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
    targets.map(([name, id]) => fetchListTasks(id, name, token, deps.fetch)),
  );
  let tasks = batches.flat();
  if (input.limit !== undefined && input.limit > 0) {
    tasks = tasks.slice(0, input.limit);
  }
  return tasks;
}

/** Cria task na list especificada. */
export async function createTask(
  input: CreateTaskInput,
  deps: ClickUpDeps = defaultClickUpDeps(),
): Promise<ClickUpTask> {
  const token = getApiToken(deps.env);
  const map = loadMap(deps.env);
  const listId = resolveListId(map, input.frente, input.list);

  const body: Record<string, unknown> = { name: input.title };
  if (input.description) body.description = input.description;
  if (input.due_date) body.due_date = new Date(input.due_date).getTime();

  const res = await deps.fetch(`${CLICKUP_BASE}/list/${listId}/task`, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`ClickUp create failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GTask;
  return mapTask(data, input.list);
}

// ─── Concluir task (marcar como feita a partir do chat) ─────────────────────

interface ClickUpStatusInfo {
  status: string;
  type: string; // 'open' | 'custom' | 'closed' | 'done'
}

async function getListStatuses(
  listId: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<ClickUpStatusInfo[]> {
  const res = await fetchFn(`${CLICKUP_BASE}/list/${listId}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) {
    throw new Error(`ClickUp list info failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { statuses?: ClickUpStatusInfo[] };
  return data.statuses ?? [];
}

function pickClosedStatus(statuses: ClickUpStatusInfo[]): string {
  const closed = statuses.find((s) => s.type === "closed") ??
    statuses.find((s) => s.type === "done");
  if (!closed) throw new Error("Nenhum status de conclusão configurado nessa list");
  return closed.status;
}

export interface CompleteTaskInput {
  frente: string;
  /** Trecho do nome da task (case-insensitive) pra identificar qual concluir. */
  query: string;
  list?: string;
}

export type CompleteTaskResult =
  | { matched: ClickUpTask }
  | { candidates: ClickUpTask[] };

/**
 * Marca como concluída a task cujo nome contém `query` (case-insensitive).
 * - Nenhum match: throw (executeTool traduz em {error}).
 * - Mais de um match: devolve candidates pro modelo pedir pro usuário escolher.
 * - Exatamente um: resolve o status "closed"/"done" da list e faz o PUT.
 */
export async function completeTask(
  input: CompleteTaskInput,
  deps: ClickUpDeps = defaultClickUpDeps(),
): Promise<CompleteTaskResult> {
  const token = getApiToken(deps.env);
  const map = loadMap(deps.env);
  const tasks = await listTasks({ frente: input.frente, list: input.list }, deps);

  const q = input.query.trim().toLowerCase();
  const matches = tasks.filter((t) => t.name.toLowerCase().includes(q));
  if (matches.length === 0) {
    throw new Error(`Nenhuma task aberta encontrada com '${input.query}' em '${input.frente}'`);
  }
  if (matches.length > 1) return { candidates: matches };

  const [task] = matches;
  const listName = task.list ?? input.list;
  if (!listName) throw new Error("Não foi possível determinar a list da task");
  const listId = resolveListId(map, input.frente, listName);
  const statuses = await getListStatuses(listId, token, deps.fetch);
  const closedStatus = pickClosedStatus(statuses);

  const res = await deps.fetch(`${CLICKUP_BASE}/task/${task.id}`, {
    method: "PUT",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ status: closedStatus }),
  });
  if (!res.ok) {
    throw new Error(`ClickUp update status failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GTask;
  return { matched: mapTask(data, listName) };
}

// ─── "O que eu faço agora": tasks com prazo, cross-frente ───────────────────

export interface OpenTaskWithDue extends ClickUpTask {
  frente: string;
}

/** Agrega tasks abertas COM prazo de todas as frentes/lists configuradas. */
export async function listAllOpenTasksWithDue(
  deps: ClickUpDeps = defaultClickUpDeps(),
): Promise<OpenTaskWithDue[]> {
  const token = getApiToken(deps.env);
  const map = loadMap(deps.env);

  const targets: Array<{ frente: string; list: string; id: string }> = [];
  for (const [frente, lists] of Object.entries(map)) {
    for (const [list, id] of Object.entries(lists)) targets.push({ frente, list, id });
  }

  const batches = await Promise.all(
    targets.map(async (t) => {
      const tasks = await fetchListTasks(t.id, t.list, token, deps.fetch);
      return tasks
        .filter((task) => task.due_date)
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
 *   pra Sonnet saber o que dizer quando Daniel pedir tasks de uma frente
 *   que não tem ClickUp.
 */
export function buildClickUpSystemBlock(map: ClickUpListMap | null, frentes: string[] = []): string {
  if (!map || Object.keys(map).length === 0) {
    return `ACESSO AO CLICKUP (tarefas)
- Não configurado. Se pedirem tasks (listar ou criar), diga que ClickUp ainda não está integrado.`;
  }

  const frentesList = Object.entries(map)
    .map(([frente, lists]) => {
      const names = Object.keys(lists).map((n) => `\"${n}\"`).join(", ");
      return `  - ${frente}: ${names}`;
    })
    .join("\n");

  const knownFrentes = Object.keys(map).map((f) => f.toLowerCase());
  const missingFrentes = frentes.filter((f) => !knownFrentes.includes(f));

  const missingNote = missingFrentes.length === 0
    ? ""
    : `\n- Frentes SEM ClickUp configurado: ${missingFrentes.join(", ")}. Se pedirem tasks de uma dessas, diga que essa frente ainda não está integrada — não chame a tool.`;

  return `ACESSO AO CLICKUP (tarefas)
- 3 tools: list_tasks(frente, list?, limit?), create_task(frente, list, title, ...), complete_task(frente, query, list?).
- Frentes e suas lists no ClickUp:
${frentesList}
- list_tasks: \`list\` é opcional — sem ele, agrega tasks de TODAS as lists da frente.
- create_task: \`list\` é OBRIGATÓRIO. Se o usuário não disser onde (qual list dentro da frente), PERGUNTE — não chute.
- complete_task: use quando o usuário disser que JÁ FEZ algo que soa como task existente (ex: "já apresentei o deck pro cliente", "terminei o X"). \`query\` é um trecho do nome da task pra identificar qual — se vier \`candidates\` (mais de uma task parecida), pergunte qual antes de marcar.${missingNote}`;
}
