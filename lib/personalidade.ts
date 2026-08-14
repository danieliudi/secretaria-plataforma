// Presets de voz da secretária — lado do site.
//
// RELAÇÃO COM O BACKEND: os IDs aqui precisam bater exatamente com
// `supabase/functions/_shared/personalidade.ts` e com o CHECK da coluna
// `tenants.personalidade` (migration 20260813). São três lugares porque são
// três runtimes (Next.js, Deno, Postgres) — mesma razão de `lib/log-seguro.ts`
// existir separado do `_shared/log-seguro.ts`.
//
// O que NÃO se duplica é a instrução de prompt: ela mora só no backend. Aqui
// ficam rótulo e prévia, que são texto de INTERFACE. Se a prévia divergir um
// pouco do que a secretária faz de fato, é decepção de expectativa; se a
// instrução vivesse aqui, seria o site ditando comportamento do agente.
//
// Última barreira é o CHECK do banco: valor fora do conjunto é rejeitado pelo
// Postgres mesmo que a API e a tela falhem juntas.

export type Personalidade = "direta" | "cordial" | "formal" | "leve";

export const PERSONALIDADE_PADRAO: Personalidade = "cordial";

export interface PresetPersonalidade {
  id: Personalidade;
  label: string;
  /** Uma linha dizendo pra quem serve. */
  resumo: string;
  /** Como ela falaria com você — o mesmo exemplo em todos, pra dar de comparar. */
  exemplo: string;
}

/**
 * Ordem de exibição: do mais seco ao mais solto, com o padrão (`cordial`) em
 * segundo. Todos usam a MESMA situação de exemplo — só assim dá pra ouvir a
 * diferença de voz em vez de comparar conteúdos diferentes.
 */
export const PRESETS: readonly PresetPersonalidade[] = [
  {
    id: "direta",
    label: "Direta",
    resumo: "Só o essencial, sem rodeio.",
    exemplo: "3 compromissos amanhã. 14h com a Ana, sem confirmação.",
  },
  {
    id: "cordial",
    label: "Cordial",
    resumo: "Profissional com calor. A mais equilibrada.",
    exemplo: "Amanhã você tem 3 compromissos. O das 14h com a Ana ninguém confirmou ainda.",
  },
  {
    id: "formal",
    label: "Formal",
    resumo: "Para contabilidade, jurídico, escritório tradicional.",
    exemplo:
      "Sua agenda de amanhã tem 3 compromissos. O das 14h, com Ana Takahiro, permanece sem confirmação.",
  },
  {
    id: "leve",
    label: "Leve",
    resumo: "Descontraída, com emoji.",
    exemplo: "Amanhã tem 3 compromissos 👀 o das 14h com a Ana tá sem confirmação",
  },
] as const;

/** Converte valor vindo do banco ou do formulário em preset válido. */
export function normalizaPersonalidade(valor: unknown): Personalidade {
  if (typeof valor !== "string") return PERSONALIDADE_PADRAO;
  const v = valor.trim().toLowerCase();
  return PRESETS.some((p) => p.id === v) ? (v as Personalidade) : PERSONALIDADE_PADRAO;
}
