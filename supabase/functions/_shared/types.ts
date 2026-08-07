// Tipos compartilhados entre reflex / fast / proxy.
//
// NOTA: importados sempre via `import type` — apagados em runtime (type
// erasure), por isso este arquivo não aparece no bundle das edge functions.
// Mantido no repo para o type-check local e como contrato único das camadas.

/** Camada que processa a mensagem. */
export type Tier = "reflex" | "fast" | "deep";

/** Resultado da classificação do reflex sobre uma mensagem do Daniel. */
export interface Decision {
  tier: Tier;
  /** Frente de trabalho inferida (resibag, sanwey, pessoal, ...). */
  frente: string;
  /** Domínio do assunto (agenda, email, tarefa, outro, ...). */
  domain: string;
  /** Se a mensagem pede uma ação (criar/alterar algo) vs. só consulta. */
  action_required: boolean;
  /** Se a ação é irreversível (exige mais cautela/confirmação). */
  irreversible: boolean;
  /** Confiança da classificação, 0..1. */
  confidence: number;
}

/** Retorno padrão dos handlers (fast/reflex) pro proxy e pro WhatsApp. */
export interface ReflexResult {
  ok: boolean;
  message: string;
}
