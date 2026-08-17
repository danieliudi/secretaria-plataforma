// Sanwey Tasks — "Meu To-Do" pessoal do Daniel dentro do sanwey-crm
// (sanwey-gestao.netlify.app), via a edge function dedicada
// personal-tasks-agent (projeto Supabase SEPARADO do secretaria-agentic —
// não confundir com _shared/sanwey-crm.ts, que é outro projeto ainda,
// read-only de leads/marketing). Contrato completo em
// sanwey-crm/personal-tasks-agent-api.md.
//
// Auth: token único num header (`X-Personal-Tasks-Key`), sem OAuth — mais
// parecido com o Trello (key+token) do que com Google Tasks, só que mais
// simples ainda (um token só).
//
// Configuração (Supabase secrets, projeto secretaria-agentic):
//   SANWEY_TASKS_API_TOKEN — mesmo valor do PERSONAL_TASKS_AGENT_KEY
//                             configurado no projeto do sanwey-crm.
//   SANWEY_TASKS_LIST_MAP  — JSON plano (igual GOOGLE_TASKS_LIST_MAP):
//                             {frente: "tag"} ex: {"resibag": "Resibag"}
//
// Modelo de dados: `personal_tasks` não tem o conceito de "frente" nem de
// sub-lista — é UMA lista só, pertencente a UMA pessoa (o Daniel). A ponte
// escolhida é frente → tag: cada frente do map aponta pra uma tag de
// `personal_tasks.tags`, e o filtro é feito aqui (lado da secretária), não
// na function — mesmo padrão que ClickUp/Trello já usam pra "frente" hoje.
// `list` (sub-agrupador) é sempre IGNORADO, igual Google Tasks.
//
// Só existem os 3 status que a secretária escreve: "a_fazer" (criar),
// "concluido" (concluir — NUNCA "feito", que no sanwey-crm é a etapa de
// Arquivar, não de Conclusão) e o que já estiver lá em "fazendo"/etc, que a
// secretária apenas lê, nunca seta.

import type {
  CompleteTaskInput as PCompleteTaskInput,
  CompleteTaskResult as PCompleteTaskResult,
  CreateTaskInput as PCreateTaskInput,
  ListTasksInput as PListTasksInput,
  OpenTaskWithDue,
  TaskItem,
  TaskProvider,
} from "../task-provider.ts";

// URL fixa da function — não é segredo, só o endereço público dela (o
// segredo é o token no header). Ver personal-tasks-agent-api.md.
const PERSONAL_TASKS_API_URL =
  "https://adizvduyfzfftyswkijj.supabase.co/functions/v1/personal-tasks-agent";

/** {frente: tag} — map plano, sem sub-nível (mesma forma do Google Tasks). */
export type SanweyTasksListMap = Record<string, string>;

export interface SanweyTaskItem {
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  url: string;
}

export interface ListTasksInput {
  frente: string;
  /** Ignorado — `personal_tasks` não tem sub-lista dentro da frente. */
  list?: string;
  limit?: number;
}

export interface CreateTaskInput {
  frente: string;
  /** Ignorado — `personal_tasks` não tem sub-lista dentro da frente. */
  list?: string;
  title: string;
  description?: string;
  due_date?: string;
}

export interface CompleteTaskInput {
  frente: string;
  /** Trecho do nome da task (case-insensitive) pra identificar qual concluir. */
  query: string;
  /** Ignorado — `personal_tasks` não tem sub-lista dentro da frente. */
  list?: string;
}

export type CompleteTaskResult =
  | { matched: SanweyTaskItem }
  | { candidates: SanweyTaskItem[] };

export interface OpenSanweyTaskWithDue extends SanweyTaskItem {
  frente: string;
}

export interface SanweyTasksDeps {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
}

export function defaultSanweyTasksDeps(): SanweyTasksDeps {
  return { env: (k) => Deno.env.get(k), fetch };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadMap(env: SanweyTasksDeps["env"]): SanweyTasksListMap {
  const raw = env("SANWEY_TASKS_LIST_MAP");
  if (!raw) throw new Error("SANWEY_TASKS_LIST_MAP não setada");
  try {
    return JSON.parse(raw) as SanweyTasksListMap;
  } catch {
    throw new Error("SANWEY_TASKS_LIST_MAP não é JSON válido");
  }
}

/** Carrega o map ou retorna null se não configurado/inválido (sem throw). */
export function tryLoadSanweyTasksMap(
  env: SanweyTasksDeps["env"],
): SanweyTasksListMap | null {
  try {
    return loadMap(env);
  } catch {
    return null;
  }
}

/** Resolve a tag configurada pra `frente` (lookup case-insensitive). */
function resolveTag(map: SanweyTasksListMap, frente: string): string {
  const target = frente.toLowerCase();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === target);
  if (!found) {
    const available = Object.keys(map).join(", ") || "(nenhuma)";
    throw new Error(
      `Frente '${frente}' não tem Sanwey Tasks configurado. Configuradas: ${available}`,
    );
  }
  return found[1];
}

function hasTag(record: PersonalTaskRecord, tag: string): boolean {
  const target = tag.toLowerCase();
  return (record.tags ?? []).some((t) => t.toLowerCase() === target);
}

async function callPersonalTasksApi(
  path: string,
  init: RequestInit,
  deps: SanweyTasksDeps,
): Promise<Response> {
  const token = deps.env("SANWEY_TASKS_API_TOKEN");
  if (!token) throw new Error("SANWEY_TASKS_API_TOKEN não setada");
  return deps.fetch(`${PERSONAL_TASKS_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-Personal-Tasks-Key": token,
      "Content-Type": "application/json",
    },
  });
}

// ─── tipos internos da API (personal-tasks-agent) ───────────────────────────

interface PersonalTaskRecord {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
  tags: string[] | null;
  created_at: string;
  completed_at: string | null;
}

function mapRecord(r: PersonalTaskRecord): SanweyTaskItem {
  return {
    id: r.id,
    name: r.title,
    status: r.status,
    due_date: r.due_date,
    // personal-tasks-agent não expõe URL individual por tarefa (a tela "Meu
    // To-Do" não tem rota addressable por task) — fica vazio, igual Google Tasks.
    url: "",
  };
}

/**
 * Busca as tarefas do Daniel (abertas por padrão, todas se `includeDone`).
 * Um fetch só — diferente de ClickUp/Google Tasks, `personal_tasks` é UMA
 * lista pra todas as frentes, então filtrar por tag acontece DEPOIS, aqui,
 * não em N chamadas por frente.
 */
async function fetchRecords(
  deps: SanweyTasksDeps,
  includeDone = false,
): Promise<PersonalTaskRecord[]> {
  const qs = includeDone ? "?action=list&include_done=true&limit=200" : "?action=list&limit=200";
  const res = await callPersonalTasksApi(qs, { method: "GET" }, deps);
  if (!res.ok) {
    throw new Error(
      `Sanwey Tasks list failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { data?: PersonalTaskRecord[] };
  return data.data ?? [];
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lista tasks abertas de uma frente (via tag configurada no map).
 * - `list` é ignorado — `personal_tasks` não tem sub-lista dentro da frente.
 * - `limit` corta lado-cliente.
 */
export async function listTasks(
  input: ListTasksInput,
  deps: SanweyTasksDeps = defaultSanweyTasksDeps(),
): Promise<SanweyTaskItem[]> {
  const map = loadMap(deps.env);
  const tag = resolveTag(map, input.frente);

  const records = await fetchRecords(deps);
  let tasks = records.filter((r) => hasTag(r, tag)).map(mapRecord);
  if (input.limit !== undefined && input.limit > 0) {
    tasks = tasks.slice(0, input.limit);
  }
  return tasks;
}

/** Cria task com a tag da frente. `list` é ignorado. */
export async function createTask(
  input: CreateTaskInput,
  deps: SanweyTasksDeps = defaultSanweyTasksDeps(),
): Promise<SanweyTaskItem> {
  const map = loadMap(deps.env);
  const tag = resolveTag(map, input.frente);

  const body: Record<string, unknown> = { title: input.title, tag };
  if (input.description) body.description = input.description;
  if (input.due_date) body.due_date = input.due_date;

  const res = await callPersonalTasksApi(
    "?action=create",
    { method: "POST", body: JSON.stringify(body) },
    deps,
  );
  if (!res.ok) {
    throw new Error(
      `Sanwey Tasks create failed: ${res.status} ${await res.text()}`,
    );
  }
  const { data } = (await res.json()) as { data: PersonalTaskRecord };
  return mapRecord(data);
}

/**
 * Marca como concluída (status "concluido" — nunca "feito", que é
 * Arquivar) a task cuja título contém `query` (case-insensitive), dentro
 * da frente informada. `list` é ignorado.
 * - Nenhum match: throw (executeTool traduz em {error}).
 * - Mais de um match: devolve candidates pro modelo pedir pra Daniel escolher.
 * - Exatamente um: PATCH status → "concluido".
 */
export async function completeTask(
  input: CompleteTaskInput,
  deps: SanweyTasksDeps = defaultSanweyTasksDeps(),
): Promise<CompleteTaskResult> {
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
  const res = await callPersonalTasksApi(
    "?action=update",
    { method: "PATCH", body: JSON.stringify({ id: task.id, status: "concluido" }) },
    deps,
  );
  if (!res.ok) {
    throw new Error(
      `Sanwey Tasks update status failed: ${res.status} ${await res.text()}`,
    );
  }
  const { data } = (await res.json()) as { data: PersonalTaskRecord };
  return { matched: mapRecord(data) };
}

// ─── "O que eu faço agora": tasks com prazo, cross-frente ───────────────────

/**
 * Agrega tasks abertas COM prazo de todas as frentes configuradas no map.
 * Um fetch só (ver fetchRecords) — cada frente aqui é só um filtro por tag
 * em cima do mesmo resultado, não uma lista separada.
 */
export async function listAllOpenTasksWithDue(
  deps: SanweyTasksDeps = defaultSanweyTasksDeps(),
): Promise<OpenSanweyTaskWithDue[]> {
  const map = loadMap(deps.env);
  const records = await fetchRecords(deps);
  const withDue = records.filter((r) => r.due_date);

  return Object.entries(map).flatMap(([frente, tag]) =>
    withDue
      .filter((r) => hasTag(r, tag))
      .map((r): OpenSanweyTaskWithDue => ({ ...mapRecord(r), frente }))
  );
}

// ─── System prompt block builder ─────────────────────────────────────────────

const ALL_FRENTES = ["resibag", "sanwey", "athleisure", "bootcamp", "pessoal", "side_ai"];

/**
 * Gera o bloco do system prompt do Sonnet com base no map carregado.
 * - Sem map ou vazio: bloco curto "não configurado".
 * - Com map: lista frentes configuradas + faltantes, e deixa explícito que
 *   isto é o "Meu To-Do" PESSOAL do Daniel (não um board de equipe) e que
 *   concluir tarefa recorrente por aqui não recria a próxima ocorrência.
 */
export function buildSanweyTasksSystemBlock(map: SanweyTasksListMap | null): string {
  if (!map || Object.keys(map).length === 0) {
    return `ACESSO AO SANWEY TASKS (Meu To-Do pessoal do Daniel)
- Não configurado. Se Daniel pedir tasks (listar ou criar), diga que o Sanwey Tasks ainda não está integrado.`;
  }

  const frentesList = Object.keys(map)
    .map((frente) => `  - ${frente}`)
    .join("\n");

  const knownFrentes = Object.keys(map).map((f) => f.toLowerCase());
  const missingFrentes = ALL_FRENTES.filter((f) => !knownFrentes.includes(f));

  const missingNote = missingFrentes.length === 0
    ? ""
    : `\n- Frentes SEM Sanwey Tasks configurado: ${missingFrentes.join(", ")}. Se Daniel pedir tasks de uma dessas, diga que essa frente ainda não está integrada — não chame a tool.`;

  return `ACESSO AO SANWEY TASKS (Meu To-Do pessoal do Daniel, dentro do sanwey-crm)
- 3 tools: list_tasks(frente, limit?), create_task(frente, title, ...), complete_task(frente, query).
- Frentes com Sanwey Tasks configurado:
${frentesList}
- IMPORTANTE: igual Google Tasks, não tem sub-lista dentro da frente — não existe parâmetro \`list\` aqui.
- Isto é o "Meu To-Do" PESSOAL do Daniel, não um board de equipe — só ele tem acesso a essas tarefas.
- complete_task marca status "concluido" — se a tarefa for recorrente, a próxima ocorrência só é recriada se o Daniel concluir pela própria tela do sanwey-crm, não por aqui.
- complete_task: use quando o Daniel disser que JÁ FEZ algo que soa como task existente. \`query\` é um trecho do nome da task pra identificar qual — se vier \`candidates\` (mais de uma task parecida), pergunte qual antes de marcar.${missingNote}`;
}

// ─── Adapter: encaixa na interface TaskProvider comum ───────────────────────

export function createSanweyTasksProvider(env?: (key: string) => string | undefined): TaskProvider {
  const deps = env ? { ...defaultSanweyTasksDeps(), env } : defaultSanweyTasksDeps();

  return {
    name: "sanwey_tasks",

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
      const map = tryLoadSanweyTasksMap(deps.env);
      return buildSanweyTasksSystemBlock(map);
    },
  };
}
