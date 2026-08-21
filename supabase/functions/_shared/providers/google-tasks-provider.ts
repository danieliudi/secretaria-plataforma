// Google Tasks — listar, criar e concluir tasks via Google Tasks API v1.
// Auth: OAuth2 (Bearer token), obtido via getGoogleAccessToken() em
// ../google-oauth.ts — reusa a troca de refresh_token → access_token já
// implementada ali, não reimplementa OAuth aqui.
//
// IMPORTANTE (config externa, fora do escopo deste arquivo): o refresh token
// já em uso pelo restante do projeto (Calendar/Gmail) precisa ganhar o scope
// "https://www.googleapis.com/auth/tasks" na tela de consent do Google pra
// esse provider funcionar. Sem isso, getGoogleAccessToken() ainda troca o
// token normalmente, mas as chamadas à Tasks API vão retornar 401/403.
//
// Configuração (Supabase secrets):
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN — já usados
//   por google-oauth.ts (compartilhados com outras integrações Google).
//   GOOGLE_TASKS_LIST_MAP — JSON simples (NÃO aninhado, diferente do
//                           CLICKUP_LIST_MAP): {frente: "tasklistId"}
//                           ex: {"resibag": "MTIzNDU2Nzg5MDEyMzQ1Ng", ...}
//
// Modelo de dados: Google Tasks só tem UM nível — tasklists contendo tasks
// (sem pastas/sub-listas dentro de uma tasklist). Por isso "frente" mapeia
// DIRETO pra uma tasklist ID, e o parâmetro `list` (que faz sentido pra
// ClickUp/Trello) é sempre IGNORADO por este provider.

import { defaultGoogleOAuthDeps, getGoogleAccessToken } from "../google-oauth.ts";
import type { GoogleOAuthDeps } from "../google-oauth.ts";
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

const GOOGLE_TASKS_BASE = "https://tasks.googleapis.com/tasks/v1";

/** {frente: tasklistId} — map plano, sem sub-nível (diferente do ClickUp). */
export type GoogleTasksListMap = Record<string, string>;

export interface GoogleTaskItem {
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  url: string;
}

export interface ListTasksInput {
  frente: string;
  /** Ignorado — Google Tasks não tem sub-listas dentro da frente. */
  list?: string;
  limit?: number;
}

export interface CreateTaskInput {
  frente: string;
  /** Ignorado — Google Tasks não tem sub-listas dentro da frente. */
  list?: string;
  title: string;
  description?: string;
  due_date?: string;
}

export interface CompleteTaskInput {
  frente: string;
  /** Trecho do nome da task (case-insensitive) pra identificar qual concluir. */
  query: string;
  /** Ignorado — Google Tasks não tem sub-listas dentro da frente. */
  list?: string;
}

export type CompleteTaskResult =
  | { matched: GoogleTaskItem }
  | { candidates: GoogleTaskItem[] };

export interface OpenGoogleTaskWithDue extends GoogleTaskItem {
  frente: string;
}

export interface GoogleTasksDeps {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  getAccessToken: (deps?: GoogleOAuthDeps) => Promise<string>;
}

export function defaultGoogleTasksDeps(): GoogleTasksDeps {
  return {
    env: (k) => Deno.env.get(k),
    fetch,
    getAccessToken: getGoogleAccessToken,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadMap(env: GoogleTasksDeps["env"]): GoogleTasksListMap {
  const raw = env("GOOGLE_TASKS_LIST_MAP");
  if (!raw) throw new Error("GOOGLE_TASKS_LIST_MAP não setada");
  try {
    return JSON.parse(raw) as GoogleTasksListMap;
  } catch {
    throw new Error("GOOGLE_TASKS_LIST_MAP não é JSON válido");
  }
}

/** Carrega o map ou retorna null se não configurado/inválido (sem throw). */
export function tryLoadGoogleTasksMap(
  env: GoogleTasksDeps["env"],
): GoogleTasksListMap | null {
  try {
    return loadMap(env);
  } catch {
    return null;
  }
}

/** Resolve a tasklist ID configurada pra `frente` (lookup case-insensitive). */
function resolveTasklistId(map: GoogleTasksListMap, frente: string): string {
  const target = frente.toLowerCase();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === target);
  if (!found) {
    const available = Object.keys(map).join(", ") || "(nenhuma)";
    throw new Error(
      `Frente '${frente}' não tem Google Tasks configurado. Configuradas: ${available}`,
    );
  }
  return found[1];
}

async function getAuthHeaders(
  deps: GoogleTasksDeps,
): Promise<Record<string, string>> {
  const token = await deps.getAccessToken({ env: deps.env, fetch: deps.fetch });
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ─── tipos internos da API (Google Tasks API v1) ────────────────────────────

interface GTaskItem {
  id: string;
  title: string;
  notes?: string;
  status?: string; // "needsAction" | "completed"
  due?: string; // RFC3339 — só a parte de data é honrada pela API
}

interface GTaskListResponse {
  items?: GTaskItem[];
}

function mapTask(t: GTaskItem): GoogleTaskItem {
  return {
    id: t.id,
    name: t.title,
    status: t.status ?? "needsAction",
    due_date: t.due ?? null,
    // Google Tasks API não expõe uma URL web addressable pra uma task
    // específica (diferente do ClickUp, que retorna `url` por task) — não
    // há como linkar direto pra uma task individual, então fica vazio.
    url: "",
  };
}

async function fetchTasklistTasks(
  tasklistId: string,
  deps: GoogleTasksDeps,
): Promise<GoogleTaskItem[]> {
  const headers = await getAuthHeaders(deps);
  const url = new URL(
    `${GOOGLE_TASKS_BASE}/lists/${tasklistId}/tasks`,
  );
  url.searchParams.set("showCompleted", "false");
  url.searchParams.set("showHidden", "false");
  url.searchParams.set("maxResults", "100");

  const res = await deps.fetch(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(
      `Google Tasks list failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as GTaskListResponse;
  return (data.items ?? []).map(mapTask);
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lista tasks abertas de uma frente.
 * - `list` é ignorado — Google Tasks não tem sub-listas dentro da frente.
 * - `limit` corta lado-cliente.
 */
export async function listTasks(
  input: ListTasksInput,
  deps: GoogleTasksDeps = defaultGoogleTasksDeps(),
): Promise<GoogleTaskItem[]> {
  const map = loadMap(deps.env);
  const tasklistId = resolveTasklistId(map, input.frente);

  let tasks = await fetchTasklistTasks(tasklistId, deps);
  if (input.limit !== undefined && input.limit > 0) {
    tasks = tasks.slice(0, input.limit);
  }
  return tasks;
}

/**
 * Cria task na tasklist da frente. `list` é ignorado.
 * Nota: `due` é RFC3339, mas a Tasks API só honra a PARTE DA DATA (o
 * horário é ignorado/zerado pela API) — não dá pra agendar hora exata.
 */
export async function createTask(
  input: CreateTaskInput,
  deps: GoogleTasksDeps = defaultGoogleTasksDeps(),
): Promise<GoogleTaskItem> {
  const map = loadMap(deps.env);
  const tasklistId = resolveTasklistId(map, input.frente);
  const headers = await getAuthHeaders(deps);

  const body: Record<string, unknown> = { title: input.title };
  if (input.description) body.notes = input.description;
  if (input.due_date) body.due = input.due_date;

  const res = await deps.fetch(
    `${GOOGLE_TASKS_BASE}/lists/${tasklistId}/tasks`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Google Tasks create failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as GTaskItem;
  return mapTask(data);
}

/**
 * Marca como concluída a task cujo nome contém `query` (case-insensitive).
 * `list` é ignorado.
 * - Nenhum match: throw (executeTool traduz em {error}).
 * - Mais de um match: devolve candidates pro modelo pedir pra Daniel escolher.
 * - Exatamente um: PATCH status → "completed".
 */
export async function completeTask(
  input: CompleteTaskInput,
  deps: GoogleTasksDeps = defaultGoogleTasksDeps(),
): Promise<CompleteTaskResult> {
  const map = loadMap(deps.env);
  const tasklistId = resolveTasklistId(map, input.frente);
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
    `${GOOGLE_TASKS_BASE}/lists/${tasklistId}/tasks/${task.id}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "completed" }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Google Tasks update status failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as GTaskItem;
  return { matched: mapTask(data) };
}

// ─── "O que eu faço agora": tasks com prazo, cross-frente ───────────────────

/** Agrega tasks abertas COM prazo de todas as frentes configuradas. */
export async function listAllOpenTasksWithDue(
  deps: GoogleTasksDeps = defaultGoogleTasksDeps(),
): Promise<OpenGoogleTaskWithDue[]> {
  const map = loadMap(deps.env);

  const batches = await Promise.all(
    Object.entries(map).map(async ([frente, tasklistId]) => {
      const tasks = await fetchTasklistTasks(tasklistId, deps);
      return tasks
        .filter((task) => task.due_date)
        .map((task): OpenGoogleTaskWithDue => ({ ...task, frente }));
    }),
  );
  return batches.flat();
}

// ─── System prompt block builder ─────────────────────────────────────────────

/**
 * Gera o bloco do system prompt do Sonnet com base no map carregado.
 * - Sem map ou vazio: bloco curto "não configurado".
 * - Com map: lista frentes configuradas + lista frentes faltantes, e deixa
 *   explícito que essa plataforma NÃO tem sub-listas dentro da frente
 *   (diferente do ClickUp) — o modelo não deve tentar usar `list`.
 */
export function buildGoogleTasksSystemBlock(map: GoogleTasksListMap | null, frentes: string[] = []): string {
  if (!map || Object.keys(map).length === 0) {
    return `ACESSO AO GOOGLE TASKS (tarefas)
- Não configurado. Se pedirem tasks (listar ou criar), diga que Google Tasks ainda não está integrado.`;
  }

  const frentesList = Object.keys(map)
    .map((frente) => `  - ${frente}`)
    .join("\n");

  const knownFrentes = Object.keys(map).map((f) => f.toLowerCase());
  const missingFrentes = frentes.filter((f) => !knownFrentes.includes(f));

  const missingNote = missingFrentes.length === 0
    ? ""
    : `\n- Frentes SEM Google Tasks configurado: ${missingFrentes.join(", ")}. Se pedirem tasks de uma dessas, diga que essa frente ainda não está integrada — não chame a tool.`;

  return `ACESSO AO GOOGLE TASKS (tarefas)
- 3 tools: list_tasks(frente, limit?), create_task(frente, title, ...), complete_task(frente, query).
- Frentes com Google Tasks configurado:
${frentesList}
- IMPORTANTE: diferente do ClickUp, Google Tasks NÃO tem sub-listas dentro da frente — é só a frente inteira como uma tasklist única. Não existe parâmetro \`list\` aqui; não pergunte "em qual list" nem tente usá-lo.
- create_task: due_date, se enviado, só agenda a DATA — Google Tasks ignora o horário.
- complete_task: use quando o Daniel disser que JÁ FEZ algo que soa como task existente (ex: "já apresentei o deck pro Everton", "terminei o X"). \`query\` é um trecho do nome da task pra identificar qual — se vier \`candidates\` (mais de uma task parecida), pergunte qual antes de marcar.${missingNote}`;
}

// ─── Adapter: encaixa na interface TaskProvider comum ───────────────────────

export function createGoogleTasksProvider(env?: (key: string) => string | undefined): TaskProvider {
  const deps = env ? { ...defaultGoogleTasksDeps(), env } : defaultGoogleTasksDeps();

  return {
    name: "google_tasks",

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
      const map = tryLoadGoogleTasksMap(deps.env);
      return buildGoogleTasksSystemBlock(map, frentesDoEnv(deps.env));
    },
  };
}
