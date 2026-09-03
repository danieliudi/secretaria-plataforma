// O formato do alerta de prazo. Função pura, roda offline.
//
// Cada teste trava algo que saiu errado no WhatsApp em 03/09/2026: três bolhas
// no mesmo minuto, a mais urgente no meio, e negrito que o Telegram não
// converte.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { montaMensagemDePrazos, type PrazoEmAberto, PRAZOS_MAX_ITENS } from "../_shared/prazos.ts";

const P = (nome: string, frente = "Resibag", quando = "03/09"): PrazoEmAberto => ({ nome, frente, quando });

Deno.test("sem nada a avisar, não manda mensagem", () => {
  assertEquals(montaMensagemDePrazos([], []), null);
});

Deno.test("vencidas e vencendo cabem numa mensagem só", () => {
  // Em 03/09 isso saiu como três bolhas seguidas às 14:00.
  const msg = montaMensagemDePrazos([P("Plano de vendas")], [P("Manual da marca", "Sanwey", "04/09")])!;
  assertEquals(msg.split("🔴").length - 1, 1);
  assertEquals(msg.split("🟡").length - 1, 1);
  assertStringIncludes(msg, "🔴 Venceram");
  assertStringIncludes(msg, "🟡 Vencem em breve");
});

Deno.test("vencida vem SEMPRE antes de vencendo", () => {
  const msg = montaMensagemDePrazos([P("Já venceu")], [P("Vence amanhã", "Sanwey", "04/09")])!;
  assert(msg.indexOf("Já venceu") < msg.indexOf("Vence amanhã"), msg);
});

Deno.test("só vencendo: a seção de vencidas nem aparece", () => {
  const msg = montaMensagemDePrazos([], [P("Manual da marca", "Sanwey", "04/09")])!;
  assert(!msg.includes("🔴"), msg);
  assertStringIncludes(msg, "· Manual da marca — vence 04/09");
});

Deno.test("uma frente só: nenhum rótulo polui a lista", () => {
  const msg = montaMensagemDePrazos([P("A"), P("B")], [])!;
  assert(!msg.includes("Resibag"), msg);
});

Deno.test("várias frentes: cada linha diz de qual é", () => {
  const msg = montaMensagemDePrazos([P("A", "Resibag"), P("B", "Sanwey")], [])!;
  assertStringIncludes(msg, "· A · Resibag — venceu");
  assertStringIncludes(msg, "· B · Sanwey — venceu");
});

Deno.test("o corte dá a vaga pra vencida antes de vencendo", () => {
  const vencidas = Array.from({ length: PRAZOS_MAX_ITENS }, (_, i) => P(`Venceu ${i}`));
  const msg = montaMensagemDePrazos(vencidas, [P("Vence amanhã", "Sanwey", "04/09")])!;
  assert(!msg.includes("Vence amanhã"), "vencendo tomou vaga de vencida");
  assertStringIncludes(msg, `(mostrei ${PRAZOS_MAX_ITENS} de ${PRAZOS_MAX_ITENS + 1})`);
});

Deno.test("no teto exato não aparece rodapé de corte", () => {
  const v = Array.from({ length: PRAZOS_MAX_ITENS }, (_, i) => P(`T${i}`));
  assert(!montaMensagemDePrazos(v, [])!.includes("mostrei"));
});

Deno.test("sem marcador de negrito — a mesma string vai pros dois canais", () => {
  const msg = montaMensagemDePrazos([P("A", "Resibag")], [P("B", "Sanwey", "04/09")])!;
  assert(!msg.includes("*"), `mensagem tem asterisco: ${msg}`);
  assert(!msg.includes("_"), `mensagem tem underscore: ${msg}`);
});

Deno.test("não faz pergunta — quem pergunta é o 13:00 e o 19:00", () => {
  const msg = montaMensagemDePrazos([P("A")], [])!;
  assert(!msg.includes("?"), `alerta virou pergunta: ${msg}`);
});
