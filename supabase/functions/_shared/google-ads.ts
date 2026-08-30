// Leitura do Google Ads. SOMENTE LEITURA, e isso é decisão de produto, não
// limitação técnica.
//
// A MESMA credencial que lê campanha consegue pausar campanha e mudar
// orçamento. Errar uma tarefa custa uma correção; errar um orçamento de
// anúncio custa dinheiro ENQUANTO NINGUÉM ESTÁ OLHANDO, e no Ads o estrago
// acontece em horas. Então aqui não existe nenhuma função de escrita — a Mia
// sugere (ex.: a lista de palavras negativas), quem aplica é a pessoa.
//
// PRÉ-REQUISITO QUE NÃO É CÓDIGO: a API do Google Ads não abre só com OAuth.
// Exige um developer token com "Basic Access", que é uma SOLICITAÇÃO analisada
// pelo Google — não é chave que se gera e cola. Enquanto ele não existir, tudo
// aqui devolve `sem_token` (ver EstadoAds) em vez de falhar em silêncio.
//
// STATUS DE VERIFICAÇÃO (30/08/2026): escrito contra a documentação da v25,
// mas NUNCA executado contra a API real — não temos o developer token ainda.
// Tratar como não verificado até a primeira chamada de verdade.

import { fetchComRetry } from "./http-retry.ts";

/** v25: lançada em julho/2026, sunset previsto pra agosto/2027. */
const API_VERSION = "v25";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const TIMEOUT_MS = 20_000;

/**
 * Valores monetários da API vêm em MICROS: 1.000.000 micros = 1 real.
 * Errar isto por um fator de um milhão é o bug clássico desta API.
 */
export const MICROS_POR_UNIDADE = 1_000_000;

export function deMicros(micros: number | string | undefined | null): number {
  const n = typeof micros === "string" ? Number(micros) : (micros ?? 0);
  return Number.isFinite(n) ? n / MICROS_POR_UNIDADE : 0;
}

/**
 * Por que existe um estado explícito em vez de simplesmente não devolver nada:
 * em 30/08/2026 uma reunião ficou parada horas porque a chave de transcrição
 * não estava configurada e o código saía em silêncio — sem erro, sem log, sem
 * nada na tela. A pessoa não tinha como saber. Aqui o motivo é sempre dizível.
 */
export type EstadoAds =
  | { estado: "desligado" }
  | { estado: "sem_token" }
  | { estado: "sem_conta"; frente: string }
  | { estado: "pronto"; customerId: string; loginCustomerId: string | null };

export interface AdsDeps {
  env: (key: string) => string | undefined;
  getAccessToken: () => Promise<string>;
  fetch: typeof fetch;
}

/** Só dígitos. O Google MOSTRA o id como 123-456-7890, mas a API quer 1234567890. */
function normalizaCustomerId(bruto: string): string | null {
  const so = bruto.replace(/\D/g, "");
  return /^[0-9]{8,12}$/.test(so) ? so : null;
}

function mapaDeContas(env: AdsDeps["env"]): Record<string, string> {
  const cru = env("GOOGLE_ADS_CUSTOMER_MAP");
  if (!cru) return {};
  try {
    const obj = JSON.parse(cru);
    return obj && typeof obj === "object" ? obj as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** Diz, sem chamar nada, se dá pra ler o Ads desta frente — e por que não, quando não dá. */
export function estadoDoAds(frente: string, env: AdsDeps["env"]): EstadoAds {
  if (env("GOOGLE_ADS_ATIVO") !== "1") return { estado: "desligado" };
  if (!env("GOOGLE_ADS_DEVELOPER_TOKEN")) return { estado: "sem_token" };

  const mapa = mapaDeContas(env);
  const chave = Object.keys(mapa).find((k) => k.toLowerCase() === frente.toLowerCase());
  const id = chave ? normalizaCustomerId(String(mapa[chave] ?? "")) : null;
  if (!id) return { estado: "sem_conta", frente };

  const login = env("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  return {
    estado: "pronto",
    customerId: id,
    loginCustomerId: login ? normalizaCustomerId(login) : null,
  };
}

interface LinhaAds {
  campaign?: { id?: string; name?: string; status?: string };
  campaignBudget?: { amountMicros?: string | number };
  searchTermView?: { searchTerm?: string };
  metrics?: {
    costMicros?: string | number;
    clicks?: string | number;
    impressions?: string | number;
    conversions?: number;
  };
}

/**
 * Executa uma consulta GAQL via searchStream.
 *
 * ARMADILHA DA API: desde 2025 o Google OMITE campos com valor padrão na
 * resposta (zero, string vazia, false). Ou seja, uma campanha com 0 clique não
 * vem com `clicks: 0` — vem SEM o campo `clicks`. Todo acesso a métrica aqui
 * passa por `?? 0`; ler direto produziria `undefined` em silêncio e somas
 * viradas em NaN.
 */
async function consultar(
  customerId: string,
  loginCustomerId: string | null,
  gaql: string,
  deps: AdsDeps,
): Promise<LinhaAds[]> {
  const token = deps.env("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!token) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN não configurado");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${await deps.getAccessToken()}`,
    "developer-token": token,
    "Content-Type": "application/json",
  };
  // Só vai quando existe: mandar um login-customer-id vazio é 400 na hora.
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchComRetry(
      `${API_BASE}/customers/${customerId}/googleAds:searchStream`,
      { method: "POST", headers, body: JSON.stringify({ query: gaql }), signal: ctrl.signal },
      deps.fetch,
    );
    if (!res.ok) {
      // Só o status. O corpo de erro do Google Ads costuma ecoar a query
      // inteira e o customer id — nada disso precisa ir pra log.
      throw new Error(`Google Ads respondeu ${res.status}`);
    }
    // searchStream devolve um ARRAY de lotes, cada um com `results`.
    const lotes = (await res.json()) as Array<{ results?: LinhaAds[] }>;
    return (Array.isArray(lotes) ? lotes : []).flatMap((l) => l.results ?? []);
  } finally {
    clearTimeout(timer);
  }
}

/** YYYY-MM-DD em America/Sao_Paulo (o fuso da conta; Brasil não tem mais horário de verão). */
function diaSP(offsetDias = 0): string {
  const agora = new Date(Date.now() + offsetDias * 86_400_000);
  return new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

export interface CampanhaResumo {
  nome: string;
  custo: number;
  cliques: number;
  impressoes: number;
  conversoes: number;
  /** Custo por conversão. null quando não houve conversão — não é zero, é indefinido. */
  custo_por_conversao: number | null;
}

export interface ResumoAds {
  frente: string;
  dias: number;
  custo: number;
  cliques: number;
  conversoes: number;
  custo_anterior: number;
  /** Variação % do gasto vs período anterior. null se a base era zero. */
  custo_delta_pct: number | null;
  campanhas: CampanhaResumo[];
}

function deltaPct(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

const GAQL_CAMPANHAS = (de: string, ate: string) =>
  `SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks,
          metrics.impressions, metrics.conversions
   FROM campaign
   WHERE segments.date BETWEEN '${de}' AND '${ate}'
     AND campaign.status != 'REMOVED'`;

/** Gasto e desempenho por campanha no período, com comparação com o período anterior. */
export async function resumoDaFrente(frente: string, dias: number, deps: AdsDeps): Promise<ResumoAds> {
  const est = estadoDoAds(frente, deps.env);
  if (est.estado !== "pronto") throw new Error(`Google Ads indisponível: ${est.estado}`);

  const [atual, anterior] = await Promise.all([
    consultar(est.customerId, est.loginCustomerId, GAQL_CAMPANHAS(diaSP(-dias), diaSP(-1)), deps),
    consultar(est.customerId, est.loginCustomerId, GAQL_CAMPANHAS(diaSP(-dias * 2), diaSP(-dias - 1)), deps),
  ]);

  const porCampanha = new Map<string, CampanhaResumo>();
  let custo = 0, cliques = 0, conversoes = 0;

  for (const l of atual) {
    const nome = l.campaign?.name ?? "(sem nome)";
    const c = porCampanha.get(nome) ?? {
      nome, custo: 0, cliques: 0, impressoes: 0, conversoes: 0, custo_por_conversao: null,
    };
    c.custo += deMicros(l.metrics?.costMicros);
    c.cliques += Number(l.metrics?.clicks ?? 0);
    c.impressoes += Number(l.metrics?.impressions ?? 0);
    c.conversoes += Number(l.metrics?.conversions ?? 0);
    porCampanha.set(nome, c);
  }
  for (const c of porCampanha.values()) {
    c.custo_por_conversao = c.conversoes > 0 ? Math.round((c.custo / c.conversoes) * 100) / 100 : null;
    custo += c.custo;
    cliques += c.cliques;
    conversoes += c.conversoes;
  }

  const custo_anterior = anterior.reduce((s, l) => s + deMicros(l.metrics?.costMicros), 0);

  return {
    frente,
    dias,
    custo: Math.round(custo * 100) / 100,
    cliques,
    conversoes: Math.round(conversoes * 100) / 100,
    custo_anterior: Math.round(custo_anterior * 100) / 100,
    custo_delta_pct: deltaPct(custo, custo_anterior),
    campanhas: [...porCampanha.values()].sort((a, b) => b.custo - a.custo).slice(0, 12),
  };
}

export interface TermoQueimando {
  termo: string;
  custo: number;
  cliques: number;
}

/** Custo mínimo pra um termo aparecer. Abaixo disso é ruído, não vazamento. */
export const TERMO_CUSTO_MIN = 20;

/**
 * Termos de busca que consumiram dinheiro e não converteram nada.
 *
 * É o achado mais acionável que esta integração produz: no caso da Resibag,
 * "big bag usado" e "big bag para entulho" atraem comprador de saco comum, não
 * de resíduo perigoso — e cada clique desses é dinheiro que sai sem chance de
 * virar cliente.
 */
export async function termosSemConversao(frente: string, dias: number, deps: AdsDeps): Promise<TermoQueimando[]> {
  const est = estadoDoAds(frente, deps.env);
  if (est.estado !== "pronto") throw new Error(`Google Ads indisponível: ${est.estado}`);

  const linhas = await consultar(
    est.customerId,
    est.loginCustomerId,
    `SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.conversions
     FROM search_term_view
     WHERE segments.date BETWEEN '${diaSP(-dias)}' AND '${diaSP(-1)}'
     ORDER BY metrics.cost_micros DESC
     LIMIT 200`,
    deps,
  );

  return linhas
    .filter((l) => Number(l.metrics?.conversions ?? 0) === 0)
    .map((l) => ({
      termo: (l.searchTermView?.searchTerm ?? "").slice(0, 120),
      custo: Math.round(deMicros(l.metrics?.costMicros) * 100) / 100,
      cliques: Number(l.metrics?.clicks ?? 0),
    }))
    .filter((t) => t.termo && t.custo >= TERMO_CUSTO_MIN)
    .sort((a, b) => b.custo - a.custo)
    .slice(0, 10);
}

export interface CampanhaEstourada {
  nome: string;
  orcamento_dia: number;
  gasto_hoje: number;
}

/** A partir de quanto do orçamento diário a campanha é considerada travada. */
export const LIMITE_ORCAMENTO_PCT = 0.95;

/**
 * Campanhas que já gastaram (quase) todo o orçamento do dia — ou seja, que vão
 * ficar fora do ar até a virada.
 *
 * É o aviso que o painel do Google nunca dá na hora: ele mostra o número, mas
 * não te procura às 11h pra dizer que a campanha que traz a maioria dos seus
 * leads acabou de parar.
 */
export async function campanhasNoLimiteDoOrcamento(frente: string, deps: AdsDeps): Promise<CampanhaEstourada[]> {
  const est = estadoDoAds(frente, deps.env);
  if (est.estado !== "pronto") throw new Error(`Google Ads indisponível: ${est.estado}`);

  const linhas = await consultar(
    est.customerId,
    est.loginCustomerId,
    `SELECT campaign.name, campaign_budget.amount_micros, metrics.cost_micros
     FROM campaign
     WHERE segments.date DURING TODAY
       AND campaign.status = 'ENABLED'`,
    deps,
  );

  const out: CampanhaEstourada[] = [];
  for (const l of linhas) {
    const orcamento = deMicros(l.campaignBudget?.amountMicros);
    const gasto = deMicros(l.metrics?.costMicros);
    if (orcamento > 0 && gasto >= orcamento * LIMITE_ORCAMENTO_PCT) {
      out.push({
        nome: l.campaign?.name ?? "(sem nome)",
        orcamento_dia: Math.round(orcamento * 100) / 100,
        gasto_hoje: Math.round(gasto * 100) / 100,
      });
    }
  }
  return out.sort((a, b) => b.gasto_hoje - a.gasto_hoje);
}
