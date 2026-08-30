import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  campanhasNoLimiteDoOrcamento,
  deMicros,
  estadoDoAds,
  LIMITE_ORCAMENTO_PCT,
  termosSemConversao,
  TERMO_CUSTO_MIN,
} from "../_shared/google-ads.ts";

function env(vals: Record<string, string>) {
  return (k: string) => vals[k];
}

const ATIVO = {
  GOOGLE_ADS_ATIVO: "1",
  GOOGLE_ADS_DEVELOPER_TOKEN: "token-de-teste",
  GOOGLE_ADS_CUSTOMER_MAP: '{"resibag":"123-456-7890"}',
};

// ── micros ────────────────────────────────────────────────────────────────
// Errar isto por um fator de um milhão é o bug clássico da API do Google Ads.

Deno.test("deMicros converte e aceita string (a API manda int64 como string)", () => {
  assertEquals(deMicros(1_000_000), 1);
  assertEquals(deMicros("840500000"), 840.5);
});

Deno.test("deMicros trata ausente como zero — a API OMITE campo com valor padrão", () => {
  assertEquals(deMicros(undefined), 0);
  assertEquals(deMicros(null), 0);
  assertEquals(deMicros("nao-numero"), 0);
});

// ── estado ────────────────────────────────────────────────────────────────
// Cada motivo de não ter dado precisa ser dizível. Ausência silenciosa foi o
// que fez uma reunião ficar parada horas em 30/08/2026.

Deno.test("desligado por padrão — sem a flag, nem tenta", () => {
  assertEquals(estadoDoAds("resibag", env({})).estado, "desligado");
});

Deno.test("ligado sem developer token diz 'sem_token', não 'desligado'", () => {
  const e = env({ GOOGLE_ADS_ATIVO: "1", GOOGLE_ADS_CUSTOMER_MAP: '{"resibag":"1234567890"}' });
  assertEquals(estadoDoAds("resibag", e).estado, "sem_token");
});

Deno.test("frente sem conta mapeada diz 'sem_conta' e nomeia a frente", () => {
  const r = estadoDoAds("sanwey", env(ATIVO));
  assertEquals(r.estado, "sem_conta");
  if (r.estado === "sem_conta") assertEquals(r.frente, "sanwey");
});

Deno.test("customer id perde os hífens — o Google MOSTRA 123-456-7890, a API quer 1234567890", () => {
  const r = estadoDoAds("resibag", env(ATIVO));
  assertEquals(r.estado, "pronto");
  if (r.estado === "pronto") assertEquals(r.customerId, "1234567890");
});

Deno.test("frente casa sem diferenciar maiúscula", () => {
  assertEquals(estadoDoAds("Resibag", env(ATIVO)).estado, "pronto");
});

Deno.test("mapa com JSON quebrado não derruba — vira 'sem_conta'", () => {
  const e = env({ ...ATIVO, GOOGLE_ADS_CUSTOMER_MAP: "{isso nao e json" });
  assertEquals(estadoDoAds("resibag", e).estado, "sem_conta");
});

Deno.test("id fora do formato numérico é recusado", () => {
  const e = env({ ...ATIVO, GOOGLE_ADS_CUSTOMER_MAP: '{"resibag":"conta-do-cliente"}' });
  assertEquals(estadoDoAds("resibag", e).estado, "sem_conta");
});

// ── leitura ───────────────────────────────────────────────────────────────

function fetchFalso(lotes: unknown): typeof fetch {
  return (() =>
    Promise.resolve(new Response(JSON.stringify(lotes), { status: 200 }))) as unknown as typeof fetch;
}

function deps(lotes: unknown) {
  return {
    env: env(ATIVO),
    getAccessToken: () => Promise.resolve("access-token-de-teste"),
    fetch: fetchFalso(lotes),
  };
}

Deno.test("orçamento estourado: pega quem passou do limite, ignora quem não passou", async () => {
  const orcamento = 100 * 1_000_000;
  const r = await campanhasNoLimiteDoOrcamento("resibag", deps([{
    results: [
      // 98% do orçamento — acima do limite, entra.
      { campaign: { name: "Resíduo Perigoso" }, campaignBudget: { amountMicros: orcamento }, metrics: { costMicros: 98 * 1_000_000 } },
      // 40% — ainda tem fôlego, fica de fora.
      { campaign: { name: "Big Bag Industrial" }, campaignBudget: { amountMicros: orcamento }, metrics: { costMicros: 40 * 1_000_000 } },
      // Sem orçamento definido: não dá pra dizer que estourou.
      { campaign: { name: "Sem Orçamento" }, metrics: { costMicros: 500 * 1_000_000 } },
    ],
  }]));
  assertEquals(r.length, 1);
  assertEquals(r[0].nome, "Resíduo Perigoso");
  assertEquals(r[0].gasto_hoje, 98);
  assertEquals(r[0].orcamento_dia, 100);
});

Deno.test("orçamento: campanha exatamente no limite conta como estourada", async () => {
  const orc = 100 * 1_000_000;
  const noLimite = orc * LIMITE_ORCAMENTO_PCT;
  const r = await campanhasNoLimiteDoOrcamento("resibag", deps([{
    results: [{ campaign: { name: "X" }, campaignBudget: { amountMicros: orc }, metrics: { costMicros: noLimite } }],
  }]));
  assertEquals(r.length, 1);
});

Deno.test("termos: só entra quem gastou e NÃO converteu", async () => {
  const r = await termosSemConversao("resibag", 7, deps([{
    results: [
      { searchTermView: { searchTerm: "big bag usado" }, metrics: { costMicros: 138 * 1_000_000, clicks: 44 } },
      // Converteu: é gasto que funcionou, não vazamento.
      { searchTermView: { searchTerm: "big bag resíduo perigoso" }, metrics: { costMicros: 210 * 1_000_000, clicks: 30, conversions: 3 } },
      // Abaixo do piso: ruído, não vazamento.
      { searchTermView: { searchTerm: "big bag" }, metrics: { costMicros: 2 * 1_000_000, clicks: 1 } },
    ],
  }]));
  assertEquals(r.map((t) => t.termo), ["big bag usado"]);
  assertEquals(r[0].custo, 138);
});

Deno.test("termos: ordena pelo que gasta mais", async () => {
  const gasto = (v: number) => v * 1_000_000;
  const r = await termosSemConversao("resibag", 7, deps([{
    results: [
      { searchTermView: { searchTerm: "barato" }, metrics: { costMicros: gasto(TERMO_CUSTO_MIN + 1) } },
      { searchTermView: { searchTerm: "caro" }, metrics: { costMicros: gasto(300) } },
    ],
  }]));
  assertEquals(r.map((t) => t.termo), ["caro", "barato"]);
});

Deno.test("searchStream vazio não quebra", async () => {
  assertEquals(await termosSemConversao("resibag", 7, deps([])), []);
  assertEquals(await campanhasNoLimiteDoOrcamento("resibag", deps([{}])), []);
});

Deno.test("erro do Google não ecoa corpo — só o status", async () => {
  const d = {
    env: env(ATIVO),
    getAccessToken: () => Promise.resolve("t"),
    fetch: (() =>
      Promise.resolve(
        new Response('{"error":{"message":"query: SELECT ... customer 1234567890"}}', { status: 403 }),
      )) as unknown as typeof fetch,
  };
  let msg = "";
  try {
    await termosSemConversao("resibag", 7, d);
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  assertEquals(msg.includes("403"), true);
  assertEquals(msg.includes("1234567890"), false);
  assertEquals(msg.includes("SELECT"), false);
});
