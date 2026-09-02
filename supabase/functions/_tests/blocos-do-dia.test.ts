// O formato do resumo da manhã. Roda offline, sem chamar modelo nenhum — que
// é justamente o ponto do módulo: a lista do dia deixou de ser redação.
//
// Cada teste aqui trava uma decisão que foi tomada olhando um caso real de
// 01/09/2026, e que sem teste volta na primeira mexida:
//   - bloco sem conteúdo não é escrito (três frentes vazias viraram três linhas
//     dizendo que não havia nada);
//   - evento de dia inteiro nunca vira um "00:00" falso (ele sumia);
//   - a estrutura acompanha o tamanho do dia, porque hierarquia fixa é fricção
//     pra tenant novo, que sempre começa com pouca coisa.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AGRUPA_POR_FRENTE_ACIMA_DE,
  linhaAgenda,
  montaBlocoAgenda,
  montaBlocoPendencias,
  montaResumoDaManha,
  type Pendencia,
} from "../_shared/blocos-do-dia.ts";

const p = (nome: string, frente: string, vence: string, atrasada: boolean): Pendencia => ({
  nome,
  frente,
  vence,
  atrasada,
});

Deno.test("bloco sem conteúdo não é escrito", () => {
  assertEquals(montaBlocoAgenda([]), "");
  assertEquals(montaBlocoPendencias([]), "");
  const so_agenda = montaResumoDaManha("Terça, 01/09", [{ titulo: "Call", hora: "14:00" }], []);
  assert(!so_agenda.includes("Pendências"), `escreveu bloco vazio:\n${so_agenda}`);
  assert(!so_agenda.includes("Sinais"), `escreveu bloco vazio:\n${so_agenda}`);
});

Deno.test("evento de dia inteiro nunca vira 00:00", () => {
  // O bug de 01/09: o evento sumia por não ter horário. Se um dia ele voltar a
  // ser tratado como "meia-noite", a mensagem passa a mentir o horário — que é
  // pior que sumir, porque parece certo.
  assertEquals(linhaAgenda({ titulo: "Trocar filtro", hora: null }), "· Dia todo Trocar filtro");
  assertEquals(linhaAgenda({ titulo: "Reunião", hora: "09:00" }), "· 09:00 Reunião");
});

Deno.test("uma frente só: o nome dela some da linha", () => {
  // Seria a mesma palavra repetida em toda linha. É o caso de todo tenant novo.
  const bloco = montaBlocoPendencias([p("Enviar proposta", "acme", "03/09", false)]);
  assert(!bloco.includes("acme"), `repetiu a frente única:\n${bloco}`);
  assertStringIncludes(bloco, "· Enviar proposta · hoje");
});

Deno.test("poucas frentes e lista curta: frente vira sufixo, não cabeçalho", () => {
  const bloco = montaBlocoPendencias([
    p("Plano de vendas", "Resibag", "31/08", true),
    p("Manual da marca", "Sanwey", "28/08", true),
  ]);
  assertStringIncludes(bloco, "· Plano de vendas · Resibag · atrasada 31/08");
  assert(!bloco.includes("*Resibag ("), `agrupou cedo demais:\n${bloco}`);
});

Deno.test("lista longa agrupa por frente e tira o sufixo repetido", () => {
  const muitas = Array.from({ length: AGRUPA_POR_FRENTE_ACIMA_DE + 1 }, (_, i) =>
    p(`Tarefa ${i}`, i % 2 === 0 ? "Resibag" : "Sanwey", "31/08", false));
  const bloco = montaBlocoPendencias(muitas);
  assertStringIncludes(bloco, "*Resibag (");
  // Agrupado, o nome da frente vira cabeçalho — repeti-lo na linha seria dizer
  // a mesma coisa duas vezes na mesma tela.
  assert(!bloco.includes("· Tarefa 0 · Resibag"), `manteve o sufixo redundante:\n${bloco}`);
});

Deno.test("o corte entre sufixo e agrupamento é exatamente o limiar", () => {
  const faz = (n: number) =>
    montaBlocoPendencias(
      Array.from({ length: n }, (_, i) => p(`T${i}`, i % 2 === 0 ? "A" : "B", "31/08", false)),
    );
  assert(!faz(AGRUPA_POR_FRENTE_ACIMA_DE).includes("*A ("), "agrupou no limiar (devia ser sufixo)");
  assert(faz(AGRUPA_POR_FRENTE_ACIMA_DE + 1).includes("*A ("), "não agrupou acima do limiar");
});

Deno.test("prazo diz atrasada com a data, ou hoje", () => {
  assertStringIncludes(montaBlocoPendencias([p("a", "x", "31/08", true)]), "atrasada 31/08");
  assertStringIncludes(montaBlocoPendencias([p("a", "x", "03/09", false)]), "· hoje");
});

Deno.test("dia limpo explica, em vez de sumir", () => {
  // Silêncio total seria pior: a pessoa não sabe se o dia está limpo ou se a
  // Mia quebrou.
  const vazio = montaResumoDaManha("Domingo, 07/09", [], []);
  assertStringIncludes(vazio, "Domingo, 07/09");
  assertStringIncludes(vazio, "Dia limpo");
});

Deno.test("sinais entram só quando existem, e sempre por último", () => {
  const com = montaResumoDaManha("Terça, 01/09", [{ titulo: "Call", hora: "14:00" }], [], "· Edital X");
  assertStringIncludes(com, "*Sinais*\n· Edital X");
  assert(com.indexOf("*Sinais*") > com.indexOf("*Agenda*"), "sinais vieram antes da agenda");
  assert(!montaResumoDaManha("Terça", [{ titulo: "Call", hora: "14:00" }], [], "   ").includes("Sinais"));
});
