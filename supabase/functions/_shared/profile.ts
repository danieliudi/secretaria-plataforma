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

type UpsertRow = {
  user_id: string;
  category: string;
  key: string;
  value: string;
  updated_at: string;
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
    console.error(`[profile] load falhou p/ ${userId}:`, String(err));
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
  const v = value.trim();
  if (!v) throw new Error("value vazio");

  const { error } = await deps.upsertFact({
    user_id: userId,
    category: cat,
    key: k,
    value: v,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`user_profile upsert falhou: ${error.message}`);

  return { category: cat as ProfileCategory, key: k, value: v };
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

  return `O QUE EU JÁ APRENDI SOBRE O DANIEL (perfil acumulado — use pra personalizar, sem ficar repetindo de volta pra ele)
${sections.join("\n")}

- Quando o Daniel revelar algo novo e DURÁVEL sobre ele (preferência, pessoa recorrente, rotina, jeito de trabalhar), chame save_profile_fact pra lembrar nas próximas conversas. Salve em silêncio — não anuncie "memorizei".
- Se ele corrigir algo que você já sabe, chame save_profile_fact com a MESMA key pra atualizar.`;
}
