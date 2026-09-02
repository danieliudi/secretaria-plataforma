// Regressão do desvio de um dia nos prazos de tarefa (achado de 02/09/2026).
//
// O sintoma real: o fim do dia de 01/09 disse "Tinha 1 coisa hoje" quando
// havia três — as duas tarefas com prazo 2026-09-01 foram lidas como 31/08 e
// descartadas do filtro `diaSPdeMs(dueMs) === hoje`. O mesmo desvio dava as
// tarefas como atrasadas um dia antes no atrasadas_check e no runAlerts.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { msDoPrazo } from "../_shared/task-provider.ts";

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
