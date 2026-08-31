// Notion como gerenciador de tarefas — implementa TaskProvider.
//
// Secrets (Supabase):
//   NOTION_API_TOKEN     — token de uma "internal integration" do Notion
//                          (notion.so/my-integrations). O usuário precisa
//                          COMPARTILHAR cada database com essa integração
//                          (⋯ → Add connections) — sem isso a API devolve 404.
//   NOTION_DATABASE_MAP  — JSON {frente: databaseId}. Um nível só: 1 database
//                          por frente. Notion não tem sub-agrupador nativo
//                          equivalente à `list` do ClickUp/Trello — o
//                          parâmetro `list` é ignorado por este provider.
//
// Diferente do ClickUp/Trello, a database do usuário não segue um schema
// fixo — cada um nomeia as colunas do seu jeito. Em vez de exigir nomes
// exatos de propriedade (fricção alta pra "leigo"), este provider AUTO-
// DETECTA pelo TIPO da propriedade:
//   - título da task  → a propriedade com type "title" (toda database tem
//     exatamente uma, é obrigatória no Notion).
//   - "concluído?"    → a primeira propriedade com type "status" (usa os
//     grupos nativos to-do/in-progress/complete — mais confiável que nome
//     de opção) ou, na falta dela, a primeira com type "select" (aí tenta
//     achar uma opção chamada "Done"/"Concluído"/"Completed"/"Feito").
//   - prazo           → a primeira propriedade com type "date".
// Se a database não tiver uma coluna de status/select nem de data, as
// funções correspondentes falham com mensagem clara pedindo pra adicionar.
//
// O schema resolvido fica em cache em memória (module-level) por databaseId,
// evitando 1 chamada extra a cada request — só busca de novo se o processo
// reiniciar (cold start), o que é aceitável pra colunas que mudam raríssimo.

import type {
  CompleteTaskResult,
  CreateTaskInput,
  ListTasksInput,
  OpenTaskWithDue,
  TaskItem,
  TaskProvider,
  RescheduleTaskInput,
  RescheduleTaskResult,
} from "../task-provider.ts";
import { frentesDoEnv } from "../tenant.ts";
import { fetchComRetry } from "../http-retry.ts";

const NOTION_BASE = "https://api.notion.com/v1";
// A partir desta versão, "database" virou um CONTÊINER de uma ou mais "data
// sources" — schema/query/criação de página passaram a agir sobre uma data
// source específica (/v1/data_sources/*), não mais sobre a database direto.
// Migração obrigatória mesmo sem nenhum tenant com múltiplas fontes HOJE: o
// dono do workspace pode criar uma 2ª fonte numa database a qualquer momento
// pela própria UI do Notion, sem avisar o sistema — e a partir desse instante
// TODA chamada feita com a versão antiga (2022-06-28) contra aquela database
// específica passa a falhar com validation_error explícito (GET database,
// query, create-page com parent.database_id). Ver resolveDataSourceId.
const NOTION_VERSION = "2025-09-03";

/** {frente: databaseId} — lookup case-insensitive na frente. */
export type NotionDatabaseMap = Record<string, string>;

export interface NotionDeps {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
}

export function defaultNotionDeps(): NotionDeps {
  return { env: (k) => Deno.env.get(k), fetch };
}

function getApiToken(env: NotionDeps["env"]): string {
  const token = env("NOTION_API_TOKEN");
  if (!token) throw new Error("NOTION_API_TOKEN não setada");
  return token;
}

function loadMap(env: NotionDeps["env"]): NotionDatabaseMap {
  const raw = env("NOTION_DATABASE_MAP");
  if (!raw) throw new Error("NOTION_DATABASE_MAP não setada");
  try {
    return JSON.parse(raw) as NotionDatabaseMap;
  } catch {
    throw new Error("NOTION_DATABASE_MAP não é JSON válido");
  }
}

export function tryLoadNotionMap(env: NotionDeps["env"]): NotionDatabaseMap | null {
  try {
    return loadMap(env);
  } catch {
    return null;
  }
}

function resolveDatabaseId(map: NotionDatabaseMap, frente: string): string {
  const target = frente.toLowerCase();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === target);
  if (!found) {
    const available = Object.keys(map).join(", ") || "(nenhuma)";
    throw new Error(
      `Frente '${frente}' não tem Notion configurado. Configuradas: ${available}`,
    );
  }
  return found[1];
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// ─── Schema: tipos crus da API ────────────────────────────────────────────

interface NotionSelectOption {
  id: string;
  name: string;
}

interface NotionStatusGroup {
  id: string;
  name: string;
  option_ids: string[];
}

interface NotionPropertySchema {
  id: string;
  type: string;
  status?: { options: NotionSelectOption[]; groups: NotionStatusGroup[] };
  select?: { options: NotionSelectOption[] };
}

interface NotionDatabaseSchema {
  properties: Record<string, NotionPropertySchema>;
}

// Resolução por tipo: qual coluna é título / status / prazo, e (pro status)
// quais IDs de opção contam como "concluído".
interface ResolvedSchema {
  titleProp: string;
  statusProp: string | null;
  statusKind: "status" | "select" | null;
  /** IDs (status) ou nomes (select, case-insensitive) que valem como "feito". */
  doneOptionIds: Set<string>;
  doneOptionNames: Set<string>;
  dueProp: string | null;
}

const DONE_SELECT_NAMES = new Set(["done", "concluído", "concluido", "completed", "feito"]);

interface NotionDataSourceRef {
  id: string;
  name: string;
}

interface NotionDatabaseObject {
  data_sources?: NotionDataSourceRef[];
}

const dataSourceIdCache = new Map<string, string>();

/**
 * Resolve o data_source_id operacional a partir do database_id salvo na
 * config do tenant (esse último continua sendo o único identificador que a
 * config guarda — ver NotionDatabaseMap). Uma database com 1 única fonte
 * (o caso normal de todo tenant hoje) resolve sozinha, sem perguntar nada.
 * Com 2+ fontes, a API do Notion não marca nenhuma como "padrão" (sem
 * is_default/primary no retorno) — pegar a primeira do array silenciosamente
 * seria loteria, então isso vira erro explícito pedindo configuração manual.
 */
async function resolveDataSourceId(
  databaseId: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const cached = dataSourceIdCache.get(databaseId);
  if (cached) return cached;

  const res = await fetchComRetry(`${NOTION_BASE}/databases/${databaseId}`, {
    headers: authHeaders(token),
  }, fetchFn);
  if (!res.ok) {
    throw new Error(`Notion database lookup failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as NotionDatabaseObject;
  const sources = data.data_sources ?? [];

  if (sources.length === 0) {
    throw new Error(`Database ${databaseId} não tem nenhuma data source — configuração inválida no Notion`);
  }
  if (sources.length > 1) {
    const nomes = sources.map((s) => s.name).join(", ");
    throw new Error(
      `Database ${databaseId} tem ${sources.length} data sources (${nomes}) — o Notion não marca qual é a padrão, ` +
        `não dá pra escolher sozinho sem risco de operar na fonte errada. Configure manualmente qual data source usar.`,
    );
  }

  const dataSourceId = sources[0].id;
  dataSourceIdCache.set(databaseId, dataSourceId);
  return dataSourceId;
}

const schemaCache = new Map<string, ResolvedSchema>();

async function fetchDatabaseSchema(
  databaseId: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<ResolvedSchema> {
  const cached = schemaCache.get(databaseId);
  if (cached) return cached;

  const dataSourceId = await resolveDataSourceId(databaseId, token, fetchFn);
  const res = await fetchComRetry(`${NOTION_BASE}/data_sources/${dataSourceId}`, {
    headers: authHeaders(token),
  }, fetchFn);
  if (!res.ok) {
    throw new Error(`Notion database schema failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as NotionDatabaseSchema;

  let titleProp: string | null = null;
  let statusProp: string | null = null;
  let statusKind: ResolvedSchema["statusKind"] = null;
  let dueProp: string | null = null;
  const doneOptionIds = new Set<string>();
  const doneOptionNames = new Set<string>();

  for (const [name, schema] of Object.entries(data.properties)) {
    if (schema.type === "title" && !titleProp) titleProp = name;
    if (schema.type === "date" && !dueProp) dueProp = name;
    if (schema.type === "status" && !statusProp) {
      statusProp = name;
      statusKind = "status";
      const complete = schema.status?.groups.find((g) => g.name.toLowerCase() === "complete");
      for (const id of complete?.option_ids ?? []) doneOptionIds.add(id);
    }
    if (schema.type === "select" && !statusProp) {
      statusProp = name;
      statusKind = "select";
      for (const opt of schema.select?.options ?? []) {
        if (DONE_SELECT_NAMES.has(opt.name.trim().toLowerCase())) {
          doneOptionNames.add(opt.name);
        }
      }
    }
  }

  if (!titleProp) {
    throw new Error(
      `Database ${databaseId} sem propriedade de título (type "title") — impossível operar`,
    );
  }

  const resolved: ResolvedSchema = {
    titleProp,
    statusProp,
    statusKind,
    doneOptionIds,
    doneOptionNames,
    dueProp,
  };
  schemaCache.set(databaseId, resolved);
  return resolved;
}

// ─── Páginas: tipos crus + mapeamento pra TaskItem ────────────────────────

interface NotionPropertyValue {
  type: string;
  title?: Array<{ plain_text: string }>;
  date?: { start: string };
  status?: { id: string; name: string };
  select?: { id: string; name: string } | null;
}

interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, NotionPropertyValue>;
}

function isDone(page: NotionPage, schema: ResolvedSchema): boolean {
  if (!schema.statusProp) return false;
  const value = page.properties[schema.statusProp];
  if (schema.statusKind === "status") {
    return value?.status ? schema.doneOptionIds.has(value.status.id) : false;
  }
  if (schema.statusKind === "select") {
    return value?.select ? schema.doneOptionNames.has(value.select.name) : false;
  }
  return false;
}

function statusLabel(page: NotionPage, schema: ResolvedSchema): string {
  if (!schema.statusProp) return "";
  const value = page.properties[schema.statusProp];
  return value?.status?.name ?? value?.select?.name ?? "";
}

function mapPage(page: NotionPage, schema: ResolvedSchema): TaskItem {
  const titleValue = page.properties[schema.titleProp];
  const name = titleValue?.title?.map((t) => t.plain_text).join("") ?? "(sem título)";
  const due = schema.dueProp ? page.properties[schema.dueProp]?.date?.start ?? null : null;
  return {
    id: page.id,
    name,
    status: statusLabel(page, schema),
    due_date: due,
    url: page.url,
  };
}

async function queryDatabase(
  databaseId: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<{ pages: NotionPage[]; schema: ResolvedSchema }> {
  const schema = await fetchDatabaseSchema(databaseId, token, fetchFn);
  const dataSourceId = await resolveDataSourceId(databaseId, token, fetchFn);
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;

  // Notion pagina em blocos de até 100 e devolve has_more/next_cursor — sem
  // seguir isso, uma database com mais de 100 tasks abertas perde o
  // excedente em silêncio.
  do {
    const res = await fetchComRetry(`${NOTION_BASE}/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ page_size: 100, ...(startCursor ? { start_cursor: startCursor } : {}) }),
    }, fetchFn);
    if (!res.ok) {
      throw new Error(`Notion database query failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { results: NotionPage[]; has_more?: boolean; next_cursor?: string | null };
    pages.push(...data.results);
    startCursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (startCursor);

  return { pages, schema };
}

// ─── API pública ────────────────────────────────────────────────────────

export function createNotionProvider(deps: NotionDeps = defaultNotionDeps()): TaskProvider {
  async function openTasksForFrente(frente: string): Promise<{ tasks: TaskItem[]; schema: ResolvedSchema }> {
    const token = getApiToken(deps.env);
    const map = loadMap(deps.env);
    const databaseId = resolveDatabaseId(map, frente);
    const { pages, schema } = await queryDatabase(databaseId, token, deps.fetch);
    const open = pages.filter((p) => !isDone(p, schema));
    return { tasks: open.map((p) => mapPage(p, schema)), schema };
  }

  return {
    name: "notion",

    async listTasks(input: ListTasksInput): Promise<TaskItem[]> {
      // `list` não existe no modelo Notion (1 database = 1 frente) — ignorado.
      const { tasks } = await openTasksForFrente(input.frente);
      if (input.limit !== undefined && input.limit > 0) return tasks.slice(0, input.limit);
      return tasks;
    },

    async createTask(input: CreateTaskInput): Promise<TaskItem> {
      const token = getApiToken(deps.env);
      const map = loadMap(deps.env);
      const databaseId = resolveDatabaseId(map, input.frente);
      const schema = await fetchDatabaseSchema(databaseId, token, deps.fetch);
      const dataSourceId = await resolveDataSourceId(databaseId, token, deps.fetch);

      // deno-lint-ignore no-explicit-any
      const properties: Record<string, any> = {
        [schema.titleProp]: { title: [{ text: { content: input.title } }] },
      };
      if (input.due_date && schema.dueProp) {
        properties[schema.dueProp] = { date: { start: input.due_date } };
      }
      // Descrição: Notion não tem campo "notes" simples pra database pages —
      // criar como um parágrafo no corpo da página, não como propriedade.
      const children = input.description
        ? [{
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: input.description } }] },
        }]
        : undefined;

      const res = await fetchComRetry(`${NOTION_BASE}/pages`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          parent: { type: "data_source_id", data_source_id: dataSourceId },
          properties,
          ...(children ? { children } : {}),
        }),
      }, deps.fetch);
      if (!res.ok) {
        throw new Error(`Notion create page failed: ${res.status} ${await res.text()}`);
      }
      const page = (await res.json()) as NotionPage;
      return mapPage(page, schema);
    },

    async completeTask(input): Promise<CompleteTaskResult> {
      const token = getApiToken(deps.env);
      const map = loadMap(deps.env);
      const databaseId = resolveDatabaseId(map, input.frente);
      const { pages, schema } = await queryDatabase(databaseId, token, deps.fetch);
      const open = pages.filter((p) => !isDone(p, schema));

      const q = input.query.trim().toLowerCase();
      const matches = open.filter((p) => mapPage(p, schema).name.toLowerCase().includes(q));
      if (matches.length === 0) {
        throw new Error(`Nenhuma task aberta encontrada com '${input.query}' em '${input.frente}'`);
      }
      if (matches.length > 1) {
        return { candidates: matches.map((p) => mapPage(p, schema)) };
      }

      if (!schema.statusProp) {
        throw new Error(
          `Database de '${input.frente}' não tem coluna de status/select — não dá pra marcar concluído`,
        );
      }
      const [page] = matches;
      // deno-lint-ignore no-explicit-any
      let statusValue: any;
      if (schema.statusKind === "status") {
        const doneId = [...schema.doneOptionIds][0];
        if (!doneId) {
          throw new Error(
            `Coluna de status de '${input.frente}' sem grupo "Complete" configurado no Notion`,
          );
        }
        statusValue = { status: { id: doneId } };
      } else {
        const doneName = [...schema.doneOptionNames][0];
        if (!doneName) {
          throw new Error(
            `Coluna de select de '${input.frente}' sem opção "Done"/"Concluído"/"Feito" — adicione uma`,
          );
        }
        statusValue = { select: { name: doneName } };
      }

      const res = await fetchComRetry(`${NOTION_BASE}/pages/${page.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ properties: { [schema.statusProp]: statusValue } }),
      }, deps.fetch);
      if (!res.ok) {
        throw new Error(`Notion update page failed: ${res.status} ${await res.text()}`);
      }
      const updated = (await res.json()) as NotionPage;
      return { matched: mapPage(updated, schema) };
    },

    async rescheduleTask(input: RescheduleTaskInput): Promise<RescheduleTaskResult> {
      const token = getApiToken(deps.env);
      const map = loadMap(deps.env);
      const databaseId = resolveDatabaseId(map, input.frente);
      const { pages, schema } = await queryDatabase(databaseId, token, deps.fetch);
      const open = pages.filter((p) => !isDone(p, schema));

      const q = input.query.trim().toLowerCase();
      const matches = open.filter((p) => mapPage(p, schema).name.toLowerCase().includes(q));
      if (matches.length === 0) {
        throw new Error(`Nenhuma task aberta encontrada com '${input.query}' em '${input.frente}'`);
      }
      if (matches.length > 1) {
        return { candidates: matches.map((p) => mapPage(p, schema)) };
      }

      // Database sem coluna de data: a task existe mas não tem onde guardar
      // prazo. Dizer isso é melhor que criar a coluna por conta própria.
      if (!schema.dueProp) {
        throw new Error(
          `Database de '${input.frente}' não tem coluna de data — não dá pra remarcar prazo`,
        );
      }

      const [page] = matches;
      const res = await fetchComRetry(`${NOTION_BASE}/pages/${page.id}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({
          properties: { [schema.dueProp]: { date: { start: input.due_date } } },
        }),
      }, deps.fetch);
      if (!res.ok) {
        throw new Error(`Notion update due date failed: ${res.status} ${await res.text()}`);
      }
      const updated = (await res.json()) as NotionPage;
      return { matched: mapPage(updated, schema) };
    },

    async listAllOpenTasksWithDue(): Promise<OpenTaskWithDue[]> {
      const map = loadMap(deps.env);
      const batches = await Promise.all(
        Object.keys(map).map(async (frente) => {
          const { tasks } = await openTasksForFrente(frente);
          return tasks
            .filter((t) => t.due_date)
            .map((t): OpenTaskWithDue => ({ ...t, frente }));
        }),
      );
      return batches.flat();
    },

    buildSystemBlock(): string {
      const map = tryLoadNotionMap(deps.env);

      if (!map || Object.keys(map).length === 0) {
        return `ACESSO AO NOTION (tarefas)
- Não configurado. Se pedirem tasks (listar ou criar), diga que Notion ainda não está integrado.`;
      }

      const frentesList = Object.keys(map).map((f) => `  - ${f}`).join("\n");
      const known = Object.keys(map).map((f) => f.toLowerCase());
      const missing = frentesDoEnv(deps.env).filter((f) => !known.includes(f));
      const missingNote = missing.length === 0
        ? ""
        : `\n- Frentes SEM Notion configurado: ${missing.join(", ")}. Se pedirem tasks de uma dessas, diga que essa frente ainda não está integrada.`;

      return `ACESSO AO NOTION (tarefas)
- 3 tools: list_tasks(frente, limit?), create_task(frente, title, ...), complete_task(frente, query).
- Cada frente é 1 database do Notion — NÃO existe sub-list dentro da frente (diferente de ClickUp/Trello); ignore o parâmetro list.
- Frentes com Notion configurado:
${frentesList}
- create_task: não é preciso especificar list. complete_task: se vier candidates (mais de uma task parecida), pergunte qual antes de marcar.${missingNote}`;
    },
  };
}
