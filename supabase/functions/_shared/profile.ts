// Perfil acumulado do usuário (memória de preferências, 2F).
// Persiste e recupera fatos duráveis sobre o Daniel na tabela `user_profile`
// do Supabase, chaveada por user_id — o remoteJid do WhatsApp que chega como
// `from` no reflex e é repassado ao fast.
//
// Schema:
//   user_profile {
//     id uuid, user_id text, category text, key text, value text,
//     created_at timestamptz, updated_at timestamptz,
//     unique (user_id, key)
//   }
//
// A secretária preenche via tool `save_profile_fact` quando o Daniel revela
// algo estável (preferência, pessoa recorrente, rotina, jeito de trabalhar).
// O perfil é lido a cada conversa e injetado no system prompt do fast.
//
// Leitura é best-effort: falha não derruba a conversa. Escrita é via tool —
// erros sobem pro executeTool, que devolve {error} pro modelo.

import { getSupabaseClient } from "./supabase.ts";
import { getAnthropicClient } from "./anthropic.ts";
import { registraUso } from "./uso.ts";
import { apelidoDeUsuario, semDadoPessoal } from "./log-seguro.ts";

export type ProfileCategory =
  | "preferencia"
  | "pessoa"
  | "rotina"
  | "projeto"
  | "outro";

export interface ProfileFact {
  category: ProfileCategory;
  key: string;
  value: string;
}

// Quantos fatos carregar como contexto. Teto generoso — o perfil cresce devagar
// e cada fato é curto; 60 cobre meses de uso sem inflar o prompt.
export const PROFILE_LIMIT = 60;

// Um "fato durável" é pra ser curto por natureza (a própria tool já pede
// isso) — sem teto, `value` entra sem corte no system prompt de TODA
// conversa futura pra sempre. 500 chars é generoso pra frase/parágrafo curto
// e barra tanto acidente (dedo no botão errado ditando texto longo) quanto
// conteúdo de terceiro (e-mail, PDF) acabando ali inteiro por engano.
const MAX_VALUE_LEN = 500;

type UpsertRow = {
  user_id: string;
  category: string;
  key: string;
  value: string;
  updated_at: string;
  /** Opcional: chamadas stateless de teste não têm tenant resolvido. */
  tenant_id?: string;
};

export interface ProfileDeps {
  loadFacts: (userId: string, limit: number) => Promise<ProfileFact[]>;
  upsertFact: (row: UpsertRow) => Promise<{ error: { message: string } | null }>;
}

export function defaultProfileDeps(): ProfileDeps {
  return {
    loadFacts: async (userId, limit) => {
      const { data, error } = await getSupabaseClient()
        .from("user_profile")
        .select("category, key, value")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as ProfileFact[];
    },
    upsertFact: (row) =>
      getSupabaseClient()
        .from("user_profile")
        .upsert(row, { onConflict: "user_id,key" }) as unknown as Promise<
          { error: { message: string } | null }
        >,
  };
}

/**
 * Carrega o perfil acumulado do usuário.
 * Falha de leitura não derruba a conversa — loga e retorna [].
 */
export async function loadUserProfile(
  userId: string,
  deps: ProfileDeps = defaultProfileDeps(),
  limit: number = PROFILE_LIMIT,
): Promise<ProfileFact[]> {
  try {
    return await deps.loadFacts(userId, limit);
  } catch (err) {
    // apelidoDeUsuario, não userId cru: o telefone não pertence a um log sem
    // dono nem prazo (ver _shared/log-seguro.ts).
    console.error(`[profile] load falhou p/ ${apelidoDeUsuario(userId)}:`, semDadoPessoal(err));
    return [];
  }
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  "preferencia",
  "pessoa",
  "rotina",
  "projeto",
  "outro",
]);

// snake_case curto: minúsculas, dígitos e underscore. Normaliza o que o modelo
// mandar (espaços/acentos viram underscore) pra manter a key estável no upsert.
function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * Salva (ou atualiza) um fato no perfil. Upsert por (user_id, key): a mesma key
 * corrige um fato anterior. Lança em erro de validação ou de escrita — o
 * executeTool no fast captura e devolve {error} pro modelo.
 */
export async function saveProfileFact(
  userId: string,
  category: string,
  key: string,
  value: string,
  tenantId?: string,
  deps: ProfileDeps = defaultProfileDeps(),
): Promise<ProfileFact> {
  const cat = category.trim().toLowerCase();
  if (!VALID_CATEGORIES.has(cat)) {
    throw new Error(
      `category inválida: '${category}'. Use: preferencia, pessoa, rotina, projeto, outro.`,
    );
  }
  const k = normalizeKey(key);
  if (!k) throw new Error("key vazia após normalização");
  const v = value.trim().slice(0, MAX_VALUE_LEN);
  if (!v) throw new Error("value vazio");

  const { error } = await deps.upsertFact({
    user_id: userId,
    category: cat,
    key: k,
    value: v,
    updated_at: new Date().toISOString(),
    ...(tenantId ? { tenant_id: tenantId } : {}),
  });
  if (error) throw new Error(`user_profile upsert falhou: ${error.message}`);

  return { category: cat as ProfileCategory, key: k, value: v };
}

// ─── Consolidação periódica do perfil ───────────────────────────────────────
//
// Por que existe: `loadUserProfile` lê os PROFILE_LIMIT (60) fatos mais
// recentes. Sem consolidação, o perfil de quem usa muito degrada sozinho —
// fatos quase-iguais se acumulam ("prefere manhã", "gosta de reunião cedo"),
// empurram os antigos pra fora do limite, e o que sobra passa a ser o mais
// RECENTE em vez do mais RELEVANTE. A consolidação reescreve o conjunto:
// funde duplicatas, descarta o que envelheceu, mantém o que importa.
//
// Roda no cron semanal e só pra quem passou do limiar — quem usa pouco nunca
// dispara, então não custa nada no caso comum.

/** Abaixo disso não vale consolidar — o perfil ainda cabe folgado no limite. */
export const CONSOLIDATION_THRESHOLD = 40;

/** Haiku dá conta de fundir/podar texto curto — não vale Sonnet aqui. */
const CONSOLIDATION_MODEL = "claude-haiku-4-5-20251001";

/** Piso de sobrevivência: recusa um resultado que apague mais que isso. */
const MAX_SHRINK_RATIO = 0.5;

export interface ConsolidationDeps extends ProfileDeps {
  /** Todos os fatos do usuário, sem o limite de leitura da conversa. */
  loadAllFacts: (userId: string) => Promise<ProfileFact[]>;
  deleteFactsByKeys: (userId: string, keys: string[]) => Promise<{ error: { message: string } | null }>;
  /** Recebe o prompt, devolve o texto cru do modelo. */
  askModel: (prompt: string) => Promise<string>;
}

export function defaultConsolidationDeps(tenantId?: string | null): ConsolidationDeps {
  const base = defaultProfileDeps();
  return {
    ...base,
    loadAllFacts: async (userId) => {
      const { data, error } = await getSupabaseClient()
        .from("user_profile")
        .select("category, key, value")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return (data ?? []) as ProfileFact[];
    },
    deleteFactsByKeys: (userId, keys) =>
      getSupabaseClient()
        .from("user_profile")
        .delete()
        .eq("user_id", userId)
        .in("key", keys) as unknown as Promise<{ error: { message: string } | null }>,
    askModel: async (prompt) => {
      const res = await getAnthropicClient().messages.create({
        model: CONSOLIDATION_MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      await registraUso(CONSOLIDATION_MODEL, "consolidacao", res.usage, tenantId);
      const first = res.content[0];
      return first && first.type === "text" ? first.text : "";
    },
  };
}

/** Usuários com perfil grande o bastante pra valer uma consolidação. */
export async function listUsersParaConsolidar(tenantId: string): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from("user_profile")
    .select("user_id")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`user_profile scan falhou: ${error.message}`);

  const contagem = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ user_id: string }>) {
    contagem.set(row.user_id, (contagem.get(row.user_id) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .filter(([, n]) => n >= CONSOLIDATION_THRESHOLD)
    .map(([userId]) => userId);
}

export interface ConsolidationResult {
  status: "consolidado" | "abaixo_do_limiar" | "recusado" | "sem_mudanca";
  antes: number;
  depois: number;
  motivo?: string;
}

function buildConsolidationPrompt(facts: ProfileFact[]): string {
  return `Você organiza a memória de longo prazo de uma secretária executiva sobre a pessoa que ela atende.

Abaixo está o perfil acumulado. Reescreva-o consolidado, aplicando:
1. FUNDA fatos que dizem a mesma coisa por outras palavras — vire um só, com a redação mais completa.
2. DESCARTE o que claramente envelheceu ou era circunstancial (algo de um dia específico, um projeto que já acabou).
3. MANTENHA intacto tudo que ainda é verdade e útil pra personalizar o atendimento.
4. NÃO invente nada que não esteja nos fatos abaixo. Não "melhore" um fato adicionando detalhe que não foi dito.

Responda APENAS com um array JSON, sem texto em volta, no formato:
[{"category":"preferencia|pessoa|rotina|projeto|outro","key":"snake_case","value":"o fato"}]

Reaproveite a key original quando o fato sobreviver. Ao fundir dois, use a key do mais específico.

PERFIL ATUAL (${facts.length} fatos):
${JSON.stringify(facts, null, 2)}`;
}

function parseConsolidationResponse(raw: string): ProfileFact[] | null {
  // O modelo às vezes embrulha em ```json — tira a cerca antes de parsear.
  const semCerca = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(semCerca);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const out: ProfileFact[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) return null;
    const { category, key, value } = item as Record<string, unknown>;
    if (typeof category !== "string" || typeof key !== "string" || typeof value !== "string") return null;
    const cat = category.trim().toLowerCase();
    const k = normalizeKey(key);
    const v = value.trim();
    if (!VALID_CATEGORIES.has(cat) || !k || !v) return null;
    out.push({ category: cat as ProfileCategory, key: k, value: v });
  }
  return out;
}

/**
 * Consolida o perfil de UM usuário. Destrutivo por natureza (apaga fatos), por
 * isso recusa qualquer resultado suspeito em vez de arriscar: resposta
 * inválida, conjunto vazio, maior que o original, ou que encolha o perfil além
 * de MAX_SHRINK_RATIO. Recusar deixa o perfil como está — o próximo ciclo
 * tenta de novo, e nada se perde.
 */
export async function consolidateUserProfile(
  userId: string,
  deps: ConsolidationDeps,
): Promise<ConsolidationResult> {
  const facts = await deps.loadAllFacts(userId);
  if (facts.length < CONSOLIDATION_THRESHOLD) {
    return { status: "abaixo_do_limiar", antes: facts.length, depois: facts.length };
  }

  const raw = await deps.askModel(buildConsolidationPrompt(facts));
  const consolidados = parseConsolidationResponse(raw);

  if (!consolidados) {
    return { status: "recusado", antes: facts.length, depois: facts.length, motivo: "resposta do modelo não parseou como perfil válido" };
  }
  if (consolidados.length === 0) {
    return { status: "recusado", antes: facts.length, depois: facts.length, motivo: "modelo devolveu perfil vazio" };
  }
  if (consolidados.length > facts.length) {
    return { status: "recusado", antes: facts.length, depois: facts.length, motivo: "consolidação não pode CRIAR fatos" };
  }
  if (consolidados.length < facts.length * MAX_SHRINK_RATIO) {
    return {
      status: "recusado",
      antes: facts.length,
      depois: facts.length,
      motivo: `apagaria ${facts.length - consolidados.length} de ${facts.length} fatos — encolhimento suspeito`,
    };
  }

  const keysMantidas = new Set(consolidados.map((f) => f.key));
  const keysRemovidas = facts.map((f) => f.key).filter((k) => !keysMantidas.has(k));

  // Grava os consolidados ANTES de apagar: se algo falhar no meio, o pior
  // caso é um perfil com fatos duplicados — nunca um perfil com buraco.
  for (const f of consolidados) {
    const { error } = await deps.upsertFact({
      user_id: userId,
      category: f.category,
      key: f.key,
      value: f.value,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      return { status: "recusado", antes: facts.length, depois: facts.length, motivo: `upsert falhou: ${semDadoPessoal(error.message)}` };
    }
  }

  if (keysRemovidas.length > 0) {
    const { error } = await deps.deleteFactsByKeys(userId, keysRemovidas);
    if (error) {
      return { status: "recusado", antes: facts.length, depois: facts.length, motivo: `delete falhou: ${semDadoPessoal(error.message)}` };
    }
  }

  if (keysRemovidas.length === 0) {
    return { status: "sem_mudanca", antes: facts.length, depois: consolidados.length };
  }
  return { status: "consolidado", antes: facts.length, depois: consolidados.length };
}

const CATEGORY_LABELS: Record<ProfileCategory, string> = {
  preferencia: "Preferências",
  pessoa: "Pessoas",
  rotina: "Rotina",
  projeto: "Projetos",
  outro: "Outros",
};

const CATEGORY_ORDER: ProfileCategory[] = [
  "preferencia",
  "pessoa",
  "rotina",
  "projeto",
  "outro",
];

/**
 * Monta o bloco do system prompt com o perfil acumulado, agrupado por categoria.
 * Vazio quando não há fatos — mantém o prompt enxuto no começo do uso.
 */
export function buildProfileSystemBlock(facts: ProfileFact[]): string {
  if (facts.length === 0) return "";

  const byCategory = new Map<ProfileCategory, ProfileFact[]>();
  for (const f of facts) {
    const cat = VALID_CATEGORIES.has(f.category) ? f.category : "outro";
    const bucket = byCategory.get(cat) ?? [];
    bucket.push(f);
    byCategory.set(cat, bucket);
  }

  const sections: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    const lines = items.map((f) => `  - ${f.value}`).join("\n");
    sections.push(`${CATEGORY_LABELS[cat]}:\n${lines}`);
  }

  return `O QUE EU JÁ APRENDI SOBRE O CHEFE (perfil acumulado — use pra personalizar, sem ficar repetindo de volta pra ele)
${sections.join("\n")}

COMO DECIDIR O QUE MEMORIZAR (save_profile_fact):
- TESTE DA VALIDADE: só salve se ainda for verdade daqui a um mês. "Prefere reunião de manhã" passa; "hoje tá atolado" não.
- TESTE DA UTILIDADE: só salve se mudar como você responde no futuro. Se saber disso não muda nada, não salve.
- PREFIRA ATUALIZAR A ACUMULAR: antes de criar uma key nova, veja se algum fato acima já cobre o mesmo assunto — se cobrir, reescreva aquele com a MESMA key em vez de criar um quase-igual. Duas linhas dizendo quase a mesma coisa valem menos que uma boa.
- NÃO DUPLIQUE O QUE AS TOOLS JÁ SABEM: tarefa, evento de agenda, lembrete e nota rápida têm tools próprias — não vire fato de perfil.
- Salve em silêncio: nunca diga "memorizei" nem anuncie. Só incorpore naturalmente nas respostas seguintes.
- Se ele corrigir algo que você já sabe, chame save_profile_fact com a MESMA key pra atualizar.`;
}
