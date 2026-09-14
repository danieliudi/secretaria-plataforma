import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  diaUtil,
  diasUteisDe,
  DIAS_UTEIS_PADRAO,
  domingoDePascoa,
  ehDiaUtil,
  feriadoNacionalDe,
  feriadosNacionais,
  puloPorRotina,
  rotinaDe,
  vesperaDaSemana,
} from "../_shared/rotina.ts";

const SEG_A_SEX = rotinaDe([1, 2, 3, 4, 5]);

// ── Páscoa ────────────────────────────────────────────────────────────────
//
// Valores de referência conhecidos. Se o algoritmo quebrar, quebra aqui e não
// seis meses depois num Carnaval que não aconteceu.

Deno.test("Páscoa bate com os anos conhecidos", () => {
  assertEquals(domingoDePascoa(2024), "2024-03-31");
  assertEquals(domingoDePascoa(2025), "2025-04-20");
  assertEquals(domingoDePascoa(2026), "2026-04-05");
  assertEquals(domingoDePascoa(2027), "2027-03-28");
});

Deno.test("Páscoa cai sempre entre 22/03 e 25/04", () => {
  for (let ano = 1900; ano <= 2100; ano++) {
    const iso = domingoDePascoa(ano);
    assert(iso >= `${ano}-03-22` && iso <= `${ano}-04-25`, `${ano}: ${iso}`);
  }
});

Deno.test("Páscoa é sempre domingo", () => {
  for (let ano = 2020; ano <= 2060; ano++) {
    const dow = new Date(`${domingoDePascoa(ano)}T12:00:00Z`).getUTCDay();
    assertEquals(dow, 0, `${ano} não caiu em domingo`);
  }
});

// ── feriados ──────────────────────────────────────────────────────────────

Deno.test("os móveis de 2026 saem da Páscoa de 05/04", () => {
  const f = feriadosNacionais(2026);
  assertEquals(f.get("2026-02-17")?.nome, "Carnaval");
  assertEquals(f.get("2026-02-16")?.nome, "Carnaval (segunda)");
  assertEquals(f.get("2026-04-03")?.nome, "Sexta-feira Santa");
  assertEquals(f.get("2026-06-04")?.nome, "Corpus Christi");
});

Deno.test("Carnaval é sempre terça e Corpus Christi sempre quinta", () => {
  for (let ano = 2020; ano <= 2060; ano++) {
    const f = feriadosNacionais(ano);
    const carnaval = [...f.values()].find((x) => x.nome === "Carnaval")!;
    const corpus = [...f.values()].find((x) => x.nome === "Corpus Christi")!;
    assertEquals(new Date(`${carnaval.iso}T12:00:00Z`).getUTCDay(), 2, `${ano} carnaval`);
    assertEquals(new Date(`${corpus.iso}T12:00:00Z`).getUTCDay(), 4, `${ano} corpus`);
  }
});

Deno.test("Consciência Negra só existe a partir de 2025", () => {
  assertEquals(feriadosNacionais(2024).get("2024-11-20"), undefined);
  assertEquals(feriadosNacionais(2025).get("2025-11-20")?.nome, "Consciência Negra");
  assertEquals(feriadosNacionais(2026).get("2026-11-20")?.nome, "Consciência Negra");
});

Deno.test("Carnaval e Corpus Christi ficam marcados como não-legais", () => {
  const f = feriadosNacionais(2026);
  assertFalse(f.get("2026-02-17")!.legal);
  assertFalse(f.get("2026-06-04")!.legal);
  assert(f.get("2026-12-25")!.legal);
  assert(f.get("2026-04-03")!.legal);
});

Deno.test("feriadoNacionalDe recusa o que não é data ISO", () => {
  assertEquals(feriadoNacionalDe("25/12/2026"), null);
  assertEquals(feriadoNacionalDe("2026-12-25T10:00:00Z"), null);
  assertEquals(feriadoNacionalDe(""), null);
  assertEquals(feriadoNacionalDe("2026-12-25")?.nome, "Natal");
});

// ── dias úteis ────────────────────────────────────────────────────────────
//
// O default existe pra falhar aberto: campo nulo, corrompido ou vazio tem que
// devolver seg–sex, nunca conjunto vazio. Secretária silenciada por bug não
// gera reclamação — gera abandono.

Deno.test("valor ausente ou malformado cai no padrão seg–sex", () => {
  for (const bruto of [null, undefined, "seg a sex", 5, {}, [], ["x", "y"], [9, -1, 7]]) {
    assertEquals(diasUteisDe(bruto), [...DIAS_UTEIS_PADRAO], `bruto: ${JSON.stringify(bruto)}`);
  }
});

Deno.test("dias válidos são normalizados: sem repetido, ordenados", () => {
  assertEquals(diasUteisDe([5, 1, 1, 3]), [1, 3, 5]);
  assertEquals(diasUteisDe(["1", "2"]), [1, 2]);
  assertEquals(diasUteisDe([0, 6]), [0, 6]);
});

Deno.test("lixo no meio é descartado, o resto sobrevive", () => {
  // `null` importa aqui: `Number(null)` é 0, que é domingo. A primeira versão
  // convertia tudo com Number() e transformava lixo em dia útil.
  assertEquals(diasUteisDe([1, 2, 99, 3, null, 4.5]), [1, 2, 3]);
  assertEquals(diasUteisDe([null, "", [], {}]), [...DIAS_UTEIS_PADRAO]);
});

// ── dia útil ──────────────────────────────────────────────────────────────

Deno.test("seg–sex: sábado e domingo não são úteis", () => {
  assert(ehDiaUtil("2026-09-14", SEG_A_SEX)); // segunda
  assert(ehDiaUtil("2026-09-18", SEG_A_SEX)); // sexta
  assertFalse(ehDiaUtil("2026-09-19", SEG_A_SEX)); // sábado
  assertFalse(ehDiaUtil("2026-09-20", SEG_A_SEX)); // domingo
});

Deno.test("quem trabalha sábado tem sábado útil", () => {
  const comSabado = rotinaDe([1, 2, 3, 4, 5, 6]);
  assert(ehDiaUtil("2026-09-19", comSabado));
  assertFalse(ehDiaUtil("2026-09-20", comSabado));
});

Deno.test("feriado nacional derruba dia útil, e diz qual", () => {
  const r = diaUtil("2026-09-07", SEG_A_SEX); // Independência, segunda
  assertFalse(r.util);
  assertEquals(r.motivo?.tipo, "feriado");
  assertEquals(r.motivo?.tipo === "feriado" ? r.motivo.feriado.nome : null, "Independência");
});

Deno.test("folga de fim de semana vem com motivo próprio", () => {
  const r = diaUtil("2026-09-19", SEG_A_SEX);
  assertFalse(r.util);
  assertEquals(r.motivo?.tipo, "folga");
});

Deno.test("respeitaFeriado=false faz o feriado virar dia comum", () => {
  const semFeriado = rotinaDe([1, 2, 3, 4, 5], false);
  assert(ehDiaUtil("2026-09-07", semFeriado));
  assertFalse(ehDiaUtil("2026-09-20", semFeriado)); // domingo continua folga
});

Deno.test("entrada que não é data ISO não silencia ninguém", () => {
  // Falhar fechado aqui esconderia a mensagem do dia inteiro por causa de um
  // formato errado. Na dúvida, é dia útil.
  assert(ehDiaUtil("amanhã", SEG_A_SEX));
  assert(ehDiaUtil("", SEG_A_SEX));
});

// ── véspera da semana ─────────────────────────────────────────────────────

Deno.test("seg–sex planeja no domingo", () => {
  assert(vesperaDaSemana("2026-09-20", SEG_A_SEX)); // domingo
  assertFalse(vesperaDaSemana("2026-09-19", SEG_A_SEX)); // sábado
  assertFalse(vesperaDaSemana("2026-09-18", SEG_A_SEX)); // sexta
});

Deno.test("quem trabalha sábado também planeja no domingo", () => {
  const comSabado = rotinaDe([1, 2, 3, 4, 5, 6]);
  assert(vesperaDaSemana("2026-09-20", comSabado));
  assertFalse(vesperaDaSemana("2026-09-19", comSabado));
});

Deno.test("quem folga só na quarta planeja na quarta", () => {
  const folgaQuarta = rotinaDe([0, 1, 2, 4, 5, 6]);
  assert(vesperaDaSemana("2026-09-16", folgaQuarta)); // quarta
  assertFalse(vesperaDaSemana("2026-09-20", folgaQuarta)); // domingo é útil pra ela
});

Deno.test("quem trabalha os sete dias não tem véspera", () => {
  const todoDia = rotinaDe([0, 1, 2, 3, 4, 5, 6]);
  for (let d = 14; d <= 20; d++) {
    assertFalse(vesperaDaSemana(`2026-09-${d}`, todoDia));
  }
});

Deno.test("feriado no meio da semana não vira véspera", () => {
  // Terça de Carnaval de 2026 (17/02) tem quarta útil depois. Sem o cuidado de
  // olhar só o padrão semanal, o planejamento da semana chegaria no Carnaval.
  assertFalse(vesperaDaSemana("2026-02-17", SEG_A_SEX));

  // E o inverso: 07/09/2026 é feriado numa SEGUNDA, e mesmo assim o domingo
  // anterior continua sendo a noite de planejamento. A semana começa mais
  // tarde, não deixa de existir.
  assert(vesperaDaSemana("2026-09-06", SEG_A_SEX));
});

Deno.test("existe exatamente uma véspera por semana em qualquer rotina parcial", () => {
  // Rotina fragmentada ([2,4] = só terça e quinta) tem DUAS folgas que
  // antecedem trabalho. Se a regra fosse "toda folga seguida de dia útil", o
  // planejamento da semana chegaria duas vezes. Por isso diaDoPlanejamento
  // escolhe a maior corrida, e não qualquer véspera.
  for (const dias of [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [0, 1, 2, 4, 5, 6], [2, 4], [3]]) {
    const r = rotinaDe(dias);
    // 14/09/2026 é uma segunda; sete dias cobrem a semana inteira.
    const vesperas = [14, 15, 16, 17, 18, 19, 20]
      .filter((d) => vesperaDaSemana(`2026-09-${d}`, r));
    assertEquals(vesperas.length, 1, `dias úteis ${JSON.stringify(dias)} → ${vesperas}`);
  }
});

// ── o gate das tasks ──────────────────────────────────────────────────────
//
// 2026-09-19 é sábado, 2026-09-20 domingo, 2026-09-21 segunda.
// 2026-09-07 é a Independência, numa segunda.

const SABADO_ISO = "2026-09-19";
const DOMINGO_ISO = "2026-09-20";
const SEGUNDA_ISO = "2026-09-21";

Deno.test("no sábado, o que fala de hoje cala", () => {
  for (const task of ["brief", "meio_do_dia", "evening_recap", "atrasadas_check"]) {
    const p = puloPorRotina(task, SEG_A_SEX, SABADO_ISO, DOMINGO_ISO);
    assertEquals(p?.alvo, "hoje", task);
    assertEquals(p?.iso, SABADO_ISO, task);
    assertEquals(p?.motivo.tipo, "folga", task);
  }
});

Deno.test("no domingo à noite, o que fala de amanhã RODA — porque amanhã é segunda", () => {
  // O caso que o critério ingênuo ("é fim de semana? cala") quebraria: avisar
  // no domingo que a segunda está impossível é exatamente quando serve.
  for (const task of ["agenda_check", "lugar_novo"]) {
    assertEquals(puloPorRotina(task, SEG_A_SEX, DOMINGO_ISO, SEGUNDA_ISO), null, task);
  }
});

Deno.test("na sexta à noite, o que fala de amanhã cala — amanhã é sábado", () => {
  for (const task of ["agenda_check", "lugar_novo"]) {
    const p = puloPorRotina(task, SEG_A_SEX, "2026-09-18", SABADO_ISO);
    assertEquals(p?.alvo, "amanhã", task);
    assertEquals(p?.iso, SABADO_ISO, task);
  }
});

Deno.test("compromisso que a pessoa marcou nunca cala", () => {
  // Lembrete, evento, reunião: ela pediu. Silenciar quebraria a promessa.
  for (const task of ["reminders", "scheduled", "prep_reuniao", "reunioes"]) {
    assertEquals(puloPorRotina(task, SEG_A_SEX, SABADO_ISO, DOMINGO_ISO), null, task);
  }
});

Deno.test("sistema e dinheiro nunca calam", () => {
  for (const task of ["despesa_anomala", "ads_check", "alerts", "resumo_diario", "conflito_check"]) {
    assertEquals(puloPorRotina(task, SEG_A_SEX, SABADO_ISO, DOMINGO_ISO), null, task);
  }
});

Deno.test("task desconhecida roda — na dúvida, não silencia", () => {
  assertEquals(puloPorRotina("task_que_nao_existe", SEG_A_SEX, SABADO_ISO, DOMINGO_ISO), null);
  assertEquals(puloPorRotina("", SEG_A_SEX, SABADO_ISO, DOMINGO_ISO), null);
});

Deno.test("quem trabalha sábado recebe no sábado", () => {
  const comSabado = rotinaDe([1, 2, 3, 4, 5, 6]);
  assertEquals(puloPorRotina("brief", comSabado, SABADO_ISO, DOMINGO_ISO), null);
  assertEquals(puloPorRotina("brief", comSabado, DOMINGO_ISO, SEGUNDA_ISO)?.alvo, "hoje");
});

Deno.test("feriado cala e o motivo carrega o nome", () => {
  const p = puloPorRotina("brief", SEG_A_SEX, "2026-09-07", "2026-09-08");
  assertEquals(p?.motivo.tipo, "feriado");
  assertEquals(p?.motivo.tipo === "feriado" ? p.motivo.feriado.nome : null, "Independência");
});

Deno.test("tenant sem rotina cadastrada continua recebendo como sempre", () => {
  // null no banco = nunca respondeu. Segue seg–sex, que é o comportamento de
  // hoje pra dia útil — a mudança pra quem não configurou nada é só o silêncio
  // no fim de semana.
  const padrao = rotinaDe(null);
  assertEquals(puloPorRotina("brief", padrao, SEGUNDA_ISO, "2026-09-22"), null);
  assertEquals(puloPorRotina("brief", padrao, SABADO_ISO, DOMINGO_ISO)?.alvo, "hoje");
});

Deno.test("data malformada não silencia ninguém", () => {
  assertEquals(puloPorRotina("brief", SEG_A_SEX, "sábado", "domingo"), null);
  assertEquals(puloPorRotina("brief", SEG_A_SEX, "", ""), null);
});
