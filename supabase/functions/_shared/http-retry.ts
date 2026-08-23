// Retry com backoff pra chamadas HTTP a APIs de terceiro (ClickUp, Notion,
// Trello, GA4) que respondem 429 (rate limit) ou falham de forma transitória
// (502/503/504). Sem isso, uma rajada normal de uso — vários tenants batendo
// no mesmo provider ao mesmo tempo, ou um pico de chamadas do próprio cron —
// virava erro definitivo na primeira resposta de limite, em vez de esperar o
// tempo que o próprio provedor pede (Retry-After) e tentar de novo.
//
// Fica no `_shared` porque as 4 integrações fazem fetch cru direto na API
// (sem SDK), então o retry precisa entrar no mesmo ponto — não dá pra herdar
// de uma lib. Compõe com o tratamento de erro que já existe em cada provider:
// só troca o Response final que ele recebe, nunca decide se é erro sozinho.

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_TENTATIVAS = 3;
const BACKOFF_BASE_MS = 500; // exponencial: 500ms, 1s, 2s, sem Retry-After

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = new Date(header).getTime();
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

export interface FetchComRetryOpts {
  /** Máximo de RE-tentativas depois da 1ª chamada (default 3 — total até 4 chamadas). */
  tentativas?: number;
  /** Injetável em teste — default é um sleep real. */
  esperar?: (ms: number) => Promise<void>;
}

/**
 * Faz o fetch e, se a resposta vier 429/502/503/504, espera (Retry-After do
 * provedor, ou backoff exponencial na falta dele) e tenta de novo — até
 * `tentativas` vezes. Uma resposta OK ou um status não-retryable (4xx que não
 * seja 429, ou 5xx fora da lista) volta na hora, sem esperar. O corpo de
 * `init` precisa ser reusável entre tentativas (string via JSON.stringify já
 * é — nunca um stream), porque cada tentativa refaz o fetch do zero.
 */
export async function fetchComRetry(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch = fetch,
  opts: FetchComRetryOpts = {},
): Promise<Response> {
  const maxTentativas = opts.tentativas ?? MAX_TENTATIVAS;
  const esperar = opts.esperar ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  for (let tentativa = 0; ; tentativa++) {
    const res = await fetchFn(url, init);
    if (res.ok || !RETRYABLE_STATUS.has(res.status) || tentativa === maxTentativas) {
      return res;
    }
    const backoffMs = parseRetryAfter(res.headers.get("Retry-After")) ?? BACKOFF_BASE_MS * 2 ** tentativa;
    await esperar(backoffMs);
  }
}
