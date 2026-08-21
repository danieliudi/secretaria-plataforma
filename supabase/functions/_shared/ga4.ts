// Google Analytics 4 — leitura de métricas via Data API (runReport).
// Reusa a Google OAuth já existente; exige o escopo
// `https://www.googleapis.com/auth/analytics.readonly` no refresh token.
//
// Config (Supabase secret):
//   GA4_PROPERTY_MAP — JSON {frente: "properties/123456789"}
//                      ex: {"resibag":"properties/111","sanwey":"properties/222"}
//
// Property ID está em GA4 → Admin → Configurações da propriedade.

import { getGoogleAccessToken } from "./google-oauth.ts";
import { frentesDoEnv } from "./tenant.ts";

const GA4_BASE = "https://analyticsdata.googleapis.com/v1beta";

/** {frente: "properties/<id>"} — lookup case-insensitive na frente. */
export type Ga4PropertyMap = Record<string, string>;

export interface Ga4Deps {
  env: (k: string) => string | undefined;
  getAccessToken: () => Promise<string>;
  fetch: typeof fetch;
}

export function defaultGa4Deps(): Ga4Deps {
  return {
    env: (k) => Deno.env.get(k),
    getAccessToken: () => getGoogleAccessToken(),
    fetch,
  };
}

function loadMap(env: Ga4Deps["env"]): Ga4PropertyMap {
  const raw = env("GA4_PROPERTY_MAP");
  if (!raw) throw new Error("GA4_PROPERTY_MAP não setada");
  try {
    return JSON.parse(raw) as Ga4PropertyMap;
  } catch {
    throw new Error("GA4_PROPERTY_MAP não é JSON válido");
  }
}

/** Carrega o map ou null se não configurado/inválido (sem throw). */
export function tryLoadGa4Map(env: Ga4Deps["env"]): Ga4PropertyMap | null {
  try {
    return loadMap(env);
  } catch {
    return null;
  }
}

function resolveProperty(map: Ga4PropertyMap, frente: string): string {
  const target = frente.toLowerCase();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === target);
  if (!found) {
    const avail = Object.keys(map).join(", ") || "(nenhuma)";
    throw new Error(`Frente '${frente}' não tem GA4 configurado. Configuradas: ${avail}`);
  }
  return found[1];
}

// ─── tipos da Data API (subset) ───────────────────────────────────────────────

interface RunReportResponse {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
}

/** Erro da Data API com o status HTTP preservado, pra distinguir "métrica incompatível" (400) de auth/permissão/quota. */
export class Ga4ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function runReport(
  property: string,
  body: Record<string, unknown>,
  deps: Ga4Deps,
): Promise<RunReportResponse> {
  const token = await deps.getAccessToken();
  const res = await deps.fetch(`${GA4_BASE}/${property}:runReport`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Ga4ApiError(res.status, `GA4 runReport ${res.status}: ${(await res.text()).slice(0, 250)}`);
  }
  return (await res.json()) as RunReportResponse;
}

// "conversions" foi renomeado pra "keyEvents" no GA4 em 2024. Tentamos com
// conversions; se a property rejeitar (400), refazemos sem ela.
async function totalsReport(
  property: string,
  startDate: string,
  endDate: string,
  deps: Ga4Deps,
): Promise<{ sessions: number; activeUsers: number; conversions: number | null }> {
  const base = {
    dateRanges: [{ startDate, endDate }],
  };
  const withConv = {
    ...base,
    metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "conversions" }],
  };
  try {
    const r = await runReport(property, withConv, deps);
    const v = r.rows?.[0]?.metricValues ?? [];
    return {
      sessions: Number(v[0]?.value ?? 0),
      activeUsers: Number(v[1]?.value ?? 0),
      conversions: Number(v[2]?.value ?? 0),
    };
  } catch (e) {
    // Só refaz sem "conversions" quando o erro é mesmo de métrica incompatível
    // (400). Auth/permissão/quota (401/403/429/5xx) tem que estourar de
    // verdade — senão o segundo runReport tenta de novo com as MESMAS
    // credenciais e falha igual, e o retorno acaba fingindo "sem conversões"
    // (conversions: null) em vez de reportar o erro real.
    if (!(e instanceof Ga4ApiError) || e.status !== 400) throw e;
    const r = await runReport(property, {
      ...base,
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
    }, deps);
    const v = r.rows?.[0]?.metricValues ?? [];
    return {
      sessions: Number(v[0]?.value ?? 0),
      activeUsers: Number(v[1]?.value ?? 0),
      conversions: null,
    };
  }
}

export interface ChannelRow {
  channel: string;
  sessions: number;
}

export interface Ga4Snapshot {
  frente: string;
  period_days: number;
  sessions: number;
  prev_sessions: number;
  active_users: number;
  conversions: number | null;
  prev_conversions: number | null;
  /** Variação % de sessões vs período anterior (null se base zero). */
  sessions_delta_pct: number | null;
  by_channel: ChannelRow[];
}

function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/**
 * Snapshot de marketing de uma frente: totais do período + período anterior
 * (pra delta) + top canais de aquisição. `days` default 28.
 */
export async function getGa4Snapshot(
  frente: string,
  days = 28,
  deps: Ga4Deps = defaultGa4Deps(),
): Promise<Ga4Snapshot> {
  const map = loadMap(deps.env);
  const property = resolveProperty(map, frente);

  const curStart = `${days}daysAgo`;
  const prevStart = `${days * 2}daysAgo`;
  const prevEnd = `${days + 1}daysAgo`;

  const [cur, prev, channels] = await Promise.all([
    totalsReport(property, curStart, "yesterday", deps),
    totalsReport(property, prevStart, prevEnd, deps),
    runReport(property, {
      dateRanges: [{ startDate: curStart, endDate: "yesterday" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8,
    }, deps),
  ]);

  const byChannel: ChannelRow[] = (channels.rows ?? []).map((row) => ({
    channel: row.dimensionValues?.[0]?.value ?? "(outros)",
    sessions: Number(row.metricValues?.[0]?.value ?? 0),
  }));

  return {
    frente,
    period_days: days,
    sessions: cur.sessions,
    prev_sessions: prev.sessions,
    active_users: cur.activeUsers,
    conversions: cur.conversions,
    prev_conversions: prev.conversions,
    sessions_delta_pct: deltaPct(cur.sessions, prev.sessions),
    by_channel: byChannel,
  };
}

// ─── System prompt block ───────────────────────────────────────────────────────

export function buildGa4SystemBlock(map: Ga4PropertyMap | null, env: (k: string) => string | undefined): string {
  if (!map || Object.keys(map).length === 0) {
    return `ACESSO AO GA4 (analytics de site)
- Não configurado. Se pedirem métricas de site/tráfego, diga que o Google Analytics ainda não está integrado.`;
  }
  const frentes = Object.keys(map).join(", ");
  const known = Object.keys(map).map((f) => f.toLowerCase());
  const missing = frentesDoEnv(env).filter((f) => !known.includes(f));
  const missingNote = missing.length === 0
    ? ""
    : `\n- Frentes SEM GA4: ${missing.join(", ")}. Se pedirem métricas de uma dessas, diga que não está integrada.`;
  return `ACESSO AO GA4 (analytics de site)
- 1 tool: get_ga4_metrics(frente, days?). Retorna sessões, usuários ativos, conversões (se disponível), variação vs período anterior e top canais.
- Frentes com GA4: ${frentes}.
- days default 28. Use pra "como tá o tráfego da X?", "o site da Y melhorou esse mês?".${missingNote}`;
}
