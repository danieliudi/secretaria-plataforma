// Constantes e helpers da memória editável, lado Next.js.
//
// Duplica de propósito o que existe em supabase/functions/_shared/instrucoes.ts:
// aquele arquivo é Deno e roda nas edge functions; este roda no Netlify. Os
// dois espelham os mesmos CHECKs da migration (20260831_instrucoes.sql), que é
// quem manda de verdade — os limites aqui existem pra dar mensagem legível na
// tela em vez de deixar o Postgres recusar com erro de constraint.

export const MAX_NOME = 60;
export const MAX_QUANDO_USAR = 160;
export const MAX_TEXTO = 6000;

/** Teto de instruções por conta. Ver MAX_INSTRUCOES_NO_PROMPT do lado Deno. */
export const MAX_INSTRUCOES = 40;

export type OrigemInstrucao = "escrita" | "proposta";

export interface Instrucao {
  id: string;
  slug: string;
  nome: string;
  quando_usar: string;
  texto: string;
  ativo: boolean;
  origem: OrigemInstrucao;
  usos: number;
  ultimo_uso: string | null;
  atualizado_em: string;
}

/** Mesmo algoritmo do lado Deno — os dois têm que produzir o mesmo slug. */
export function slugDoNome(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Uma instrução só pode ser ativada com gatilho E texto. Espelha o CHECK
 * `instrucao_ativa_completa`. Devolve o motivo pra tela explicar, em vez de
 * mostrar um botão que falha ao ser clicado.
 */
export function motivoNaoPodeAtivar(
  inst: Pick<Instrucao, "quando_usar" | "texto">,
): string | null {
  if (!inst.quando_usar.trim()) {
    return "Falta o “quando usar” — sem gatilho ela nunca abre.";
  }
  if (!inst.texto.trim()) return "Falta o texto.";
  return null;
}

/** "usada 9 vezes · última em 28/08" ou "nunca usada". */
export function usoTexto(usos: number, ultimoUso: string | null): string {
  if (usos === 0) return "nunca usada";
  const quantas = usos === 1 ? "usada 1 vez" : `usada ${usos} vezes`;
  if (!ultimoUso) return quantas;
  const quando = new Date(ultimoUso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return `${quantas} · última em ${quando}`;
}
