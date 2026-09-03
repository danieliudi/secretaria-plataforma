import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { comDiaDaSemana, diaDaSemanaDe, ehFimDeSemana } from "../_shared/dia-semana.ts";
import { blocoAgora, calendarioProximosDias } from "../_shared/fast.ts";

// ── O caso real que motivou o módulo ────────────────────────────────────────
//
// 02/09/2026, 20:40. Ela escreveu "quinta/quinta/sexta" e gravou 04/09, 04/09
// e 05/09. Este teste é a prova de que o CÓDIGO discorda dela — que é
// exatamente o que faltava pra alguém perceber.

Deno.test("02/09/2026: o que ela chamou de quinta era sexta, e de sexta era sábado", () => {
  assertEquals(diaDaSemanaDe("2026-09-02"), "quarta-feira");
  assertEquals(diaDaSemanaDe("2026-09-03"), "quinta-feira"); // a quinta de verdade
  assertEquals(diaDaSemanaDe("2026-09-04"), "sexta-feira"); // ela disse "quinta"
  assertEquals(diaDaSemanaDe("2026-09-05"), "sábado"); // ela disse "sexta"
  assert(ehFimDeSemana("2026-09-05"), "skills Resibag caiu num sábado sem aviso");
});

// ── Fuso ────────────────────────────────────────────────────────────────────

Deno.test("ISO em UTC vira o dia de SP, não o da string", () => {
  // 01:00Z de sábado é 22:00 de SEXTA em São Paulo. Cortar a string daria
  // "sábado" pra um compromisso que acontece na sexta à noite.
  assertEquals(diaDaSemanaDe("2026-09-05T01:00:00Z"), "sexta-feira");
  assertEquals(diaDaSemanaDe("2026-09-04T22:00:00-03:00"), "sexta-feira");
  // Data pura é ancorada ao meio-dia: não escorrega pro dia anterior.
  assertEquals(diaDaSemanaDe("2026-09-04"), "sexta-feira");
});

Deno.test("o que não é data devolve null em vez de um dia inventado", () => {
  for (const lixo of ["", "  ", "quinta", "semana que vem", "2026-13-45", "null"]) {
    assertEquals(diaDaSemanaDe(lixo), null, `aceitou '${lixo}'`);
  }
});

// ── O eco no retorno da tool ────────────────────────────────────────────────

Deno.test("remarcar_tarefa: o retorno passa a carregar o dia da semana", () => {
  const bruto = { matched: { id: "1", name: "Fazer relatório da AGCO", status: "a_fazer", due_date: "2026-09-04", url: "x" } };
  const r = comDiaDaSemana(bruto) as { matched: Record<string, unknown> };
  assertEquals(r.matched.due_date_dia_semana, "sexta-feira");
  assertEquals(r.matched.due_date, "2026-09-04", "a data original não pode ser mexida");
});

Deno.test("lembrete e evento também: fire_at, start e end", () => {
  const r = comDiaDaSemana({
    reminder: { fire_at: "2026-09-05T11:00:00-03:00" },
    evento: { start: "2026-09-03T10:00:00-03:00", end: "2026-09-03T11:00:00-03:00" },
  }) as Record<string, Record<string, unknown>>;
  assertEquals(r.reminder.fire_at_dia_semana, "sábado");
  assertEquals(r.evento.start_dia_semana, "quinta-feira");
  assertEquals(r.evento.end_dia_semana, "quinta-feira");
});

Deno.test("lista de candidatas: cada uma ganha o seu", () => {
  const r = comDiaDaSemana({
    candidates: [{ due_date: "2026-09-04" }, { due_date: "2026-09-07" }],
  }) as { candidates: Array<Record<string, unknown>> };
  assertEquals(r.candidates[0].due_date_dia_semana, "sexta-feira");
  assertEquals(r.candidates[1].due_date_dia_semana, "segunda-feira");
});

Deno.test("chave que não é de data fica intacta — nada de poluir o retorno", () => {
  const r = comDiaDaSemana({ created_at: "2026-09-04T10:00:00Z", nome: "x" }) as Record<string, unknown>;
  assert(!("created_at_dia_semana" in r), "anexou dia em created_at");
  assertEquals(r.nome, "x");
});

Deno.test("due_date null não vira dia nenhum", () => {
  const r = comDiaDaSemana({ due_date: null }) as Record<string, unknown>;
  assert(!("due_date_dia_semana" in r), "inventou dia pra tarefa sem prazo");
});

Deno.test("não muta a entrada", () => {
  const bruto = { due_date: "2026-09-04" };
  comDiaDaSemana(bruto);
  assertEquals(Object.keys(bruto), ["due_date"]);
});

// ── O calendário do contexto ────────────────────────────────────────────────

Deno.test("o calendário traz a data certa de cada dia, com hoje e amanhã marcados", () => {
  // 02/09/2026 23:40Z = quarta, 20:40 em SP — o instante exato do erro.
  const cal = calendarioProximosDias(new Date("2026-09-02T23:40:00Z"));
  assertStringIncludes(cal, "2026-09-02  quarta  (hoje)");
  assertStringIncludes(cal, "2026-09-03  quinta  (amanhã)");
  assertStringIncludes(cal, "2026-09-04  sexta");
  assertStringIncludes(cal, "2026-09-05  sábado  (fim de semana)");
  assertStringIncludes(cal, "2026-09-06  domingo  (fim de semana)");
});

Deno.test("o calendário cobre 14 dias e não escorrega na virada do mês", () => {
  const cal = calendarioProximosDias(new Date("2026-09-02T23:40:00Z"));
  const linhas = cal.split("\n").filter((l) => /^\d{4}-\d{2}-\d{2}/.test(l));
  assertEquals(linhas.length, 14);
  assertStringIncludes(cal, "2026-09-15  terça");
});

Deno.test("virada de mês e de ano continuam certas", () => {
  assertStringIncludes(calendarioProximosDias(new Date("2026-09-30T15:00:00Z")), "2026-10-01  quinta");
  assertStringIncludes(calendarioProximosDias(new Date("2026-12-31T15:00:00Z")), "2027-01-01  sexta");
});

// Depois das 21:00 em SP já é o dia seguinte em UTC. O calendário tem que
// seguir SP, senão o "hoje" da tabela discorda do "Agora" logo acima dela.
Deno.test("23:00 em SP: o 'hoje' da tabela é o dia de SP, não o de UTC", () => {
  const cal = calendarioProximosDias(new Date("2026-09-03T02:00:00Z")); // 23:00 de 02/09 em SP
  assertStringIncludes(cal, "2026-09-02  quarta  (hoje)");
});

Deno.test("blocoAgora leva o instante e o calendário juntos", () => {
  const b = blocoAgora(new Date("2026-09-02T23:40:00Z"));
  assertStringIncludes(b, "quarta-feira, 02/09/2026, 20:40 (São Paulo)");
  assertStringIncludes(b, "NUNCA calcule dia da semana");
  assertStringIncludes(b, "2026-09-04  sexta");
});
