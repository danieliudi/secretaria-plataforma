// Regressão do desvio de um dia nos prazos de tarefa (achado de 02/09/2026).
//
// O sintoma real: o fim do dia de 01/09 disse "Tinha 1 coisa hoje" quando
// havia três — as duas tarefas com prazo 2026-09-01 foram lidas como 31/08 e
// descartadas do filtro `diaSPdeMs(dueMs) === hoje`. O mesmo desvio dava as
// tarefas como atrasadas um dia antes no atrasadas_check e no runAlerts.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { msDoPrazo, fimDoPrazoMs, prazoSoTemData } from "../_shared/task-provider.ts";

/** Mesma função do cron (cron/index.ts: diaSPdeMs) — o dia civil em SP de um instante. */
const diaSP = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(ms));

Deno.test("prazo só-data cai no MESMO dia em São Paulo", () => {
  assertEquals(diaSP(msDoPrazo("2026-09-01")), "2026-09-01");
});

Deno.test("o jeito ingênuo (new Date da data crua) é que andava um dia pra trás", () => {
  // Este teste documenta o bug, não o comportamento desejado: se um dia ele
  // falhar, é porque o runtime mudou e a âncora do meio-dia virou desnecessária.
  assertEquals(diaSP(new Date("2026-09-01").getTime()), "2026-08-31");
  assert(
    msDoPrazo("2026-09-01") !== new Date("2026-09-01").getTime(),
    "msDoPrazo virou equivalente ao new Date cru — a âncora do meio-dia sumiu",
  );
});

Deno.test("vale pro ano inteiro, não só pra uma data de sorte", () => {
  for (const data of ["2026-01-01", "2026-03-15", "2026-06-30", "2026-10-20", "2026-12-31"]) {
    assertEquals(diaSP(msDoPrazo(data)), data, `desviou em ${data}`);
  }
});

Deno.test("prazo COM hora passa direto — ali a hora é informação de verdade", () => {
  // ClickUp manda epoch em ms convertido pra ISO; Outlook manda ISO completo.
  // Ancorar no meio-dia aqui apagaria o horário real do compromisso.
  const iso = "2026-09-01T22:30:00.000Z";
  assertEquals(msDoPrazo(iso), new Date(iso).getTime());
});

Deno.test("espaço em volta não quebra a detecção de só-data", () => {
  assertEquals(diaSP(msDoPrazo("  2026-09-01  ")), "2026-09-01");
});

Deno.test("uma tarefa com prazo hoje entra no fim do dia de hoje", () => {
  // O filtro exato que o runEveningRecap aplica.
  const hoje = diaSP(Date.now());
  assertEquals(diaSP(msDoPrazo(hoje)), hoje, "tarefa com prazo hoje sairia da mensagem das 19h");
});

// ── O fim do prazo, não a âncora (03/09/2026) ──────────────────────────────
// Às 14:00 a Mia anunciou "🔴 Prazos vencidos (3)" sobre tarefas que ainda
// tinham 10 horas. A causa: o código comparava `agora` com a âncora do
// meio-dia UTC que msDoPrazo usa pra acertar o DIA.

Deno.test("prazo só com data acaba às 23:59:59 daquele dia em São Paulo", () => {
  const fim = fimDoPrazoMs("2026-09-03");
  const emSP = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(fim));
  assertEquals(emSP, "03/09/2026, 23:59:59");
});

Deno.test("às 14:00, uma tarefa que vence hoje NÃO está vencida", () => {
  // É literalmente o caso de 03/09. Se este teste cair, o vermelho falso volta.
  const agora = new Date("2026-09-03T17:00:00Z").getTime(); // 14:00 em SP
  assert(fimDoPrazoMs("2026-09-03") > agora, "declarou vencida antes da meia-noite");
  assert(fimDoPrazoMs("2026-09-02") < agora, "deixou de reconhecer o que venceu ontem");
});

Deno.test("prazo COM hora acaba na hora marcada, sem virar fim do dia", () => {
  const comHora = "2026-09-03T11:00:00-03:00";
  assertEquals(fimDoPrazoMs(comHora), new Date(comHora).getTime());
  assert(!prazoSoTemData(comHora));
  assert(prazoSoTemData("2026-09-03"));
  assert(prazoSoTemData("  2026-09-03  "), "espaço em volta não devia mudar a leitura");
});

Deno.test("a virada do dia é exata — 23:59:59,999 ainda vale, 00:00 do dia seguinte não", () => {
  const fim = fimDoPrazoMs("2026-09-03");
  const meiaNoite = new Date("2026-09-04T03:00:00.000Z").getTime(); // 00:00 de 04/09 em SP
  assertEquals(meiaNoite - fim, 1);
});
