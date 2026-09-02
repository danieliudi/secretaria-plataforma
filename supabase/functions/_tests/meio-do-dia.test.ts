// O formato da mensagem das 13:00. Função pura, roda offline.
//
// O caso que originou tudo: 01/09/2026, lembrete do bolo às 11:00, sem
// resposta, e nada voltou nele — nem naquele dia nem depois. Os testes aqui
// travam as três decisões que fazem essa mensagem não virar cobrança: silêncio
// quando não há o que perguntar, um item vira frase e não lista, e o verbo
// muda conforme a Mia tenha mandado aquilo ou não.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { montaMensagemMeioDoDia } from "../_shared/meio-do-dia.ts";
import { RECAP_MAX_ITENS } from "../_shared/fim-do-dia.ts";
import type { CompromissoDoDia, LembreteDoDia } from "../_shared/fim-do-dia.ts";

const L = (texto: string, hora = "11:00"): LembreteDoDia => ({ texto, hora });
const C = (titulo: string, hora: string | null = "09:00"): CompromissoDoDia => ({ titulo, hora });
const itensDe = (msg: string) => msg.split("\n").filter((l) => /^\d+\. ☐ /.test(l));

Deno.test("sem nada pra perguntar, NÃO manda mensagem", () => {
  // A diferença de desenho entre esta e as outras duas do dia: âncora que às
  // vezes só diz "nada por aqui" é o que faz alguém silenciar a Mia.
  assertEquals(montaMensagemMeioDoDia([], []), null);
});

// ── O caso da Erika ─────────────────────────────────────────────────────────
Deno.test("um lembrete só: vira frase, cita o texto e oferece remarcar", () => {
  const msg = montaMensagemMeioDoDia([L("Lembra de procurar o bolo 🎂", "11:00")], [])!;
  assertStringIncludes(msg, 'Te mandei "Lembra de procurar o bolo 🎂" às 11:00');
  assertStringIncludes(msg, "Andou?");
  assertStringIncludes(msg, "eu passo pra amanhã");
  assertEquals(itensDe(msg).length, 0, "um item só não devia virar lista");
});

Deno.test("uma reunião só: o verbo muda — a Mia não mandou reunião nenhuma", () => {
  const msg = montaMensagemMeioDoDia([], [C("Alinhamento diário Léo + Daniel", "09:00")])!;
  assert(!msg.includes("Te mandei"), `disse que mandou uma reunião:\n${msg}`);
  assertStringIncludes(msg, '"Alinhamento diário Léo + Daniel", das 09:00, já passou. Andou?');
  // Remarcar reunião não é o que essa frase oferece — a Mia não sabe se dá.
  assert(!msg.includes("passo pra amanhã"), msg);
});

Deno.test("mais de um item: lista numerada, com o total por extenso", () => {
  const msg = montaMensagemMeioDoDia(
    [L("Procurar o bolo 🎂", "11:00")],
    [C("Alinhamento com o Léo", "09:00")],
  )!;
  assertStringIncludes(msg, "Duas coisas passaram pela sua manhã:");
  assertStringIncludes(msg, "1. ☐ Procurar o bolo 🎂 — 11:00");
  assertStringIncludes(msg, "2. ☐ Alinhamento com o Léo — 09:00");
  assertStringIncludes(msg, '"fiz a 1" já resolve');
});

Deno.test("lembrete vem antes de reunião — é o que a Mia mandou e ninguém acusou", () => {
  const msg = montaMensagemMeioDoDia([L("Bolo", "11:00")], [C("Call", "09:00")])!;
  assert(msg.indexOf("Bolo") < msg.indexOf("Call"), msg);
});

Deno.test("compromisso de dia inteiro não entra: ele ainda tem o dia todo", () => {
  assertEquals(montaMensagemMeioDoDia([], [C("TROCAR FILTRO CHUVEIRO", null)]), null);
  const msg = montaMensagemMeioDoDia([L("Bolo", "11:00")], [C("Trocar filtro", null)])!;
  assert(!msg.includes("Trocar filtro"), msg);
});

Deno.test("acima do teto corta e diz que cortou", () => {
  const muitos = Array.from({ length: RECAP_MAX_ITENS + 3 }, (_, i) => L(`Lembrete ${i + 1}`));
  const msg = montaMensagemMeioDoDia(muitos, [])!;
  assertEquals(itensDe(msg).length, RECAP_MAX_ITENS);
  assertStringIncludes(msg, `(mostrei ${RECAP_MAX_ITENS} de ${RECAP_MAX_ITENS + 3})`);
});

Deno.test("texto gigante vindo de fora é cortado", () => {
  const msg = montaMensagemMeioDoDia([L("x".repeat(400), "11:00"), L("outro")], [])!;
  const linha = itensDe(msg)[0];
  assert(linha.length < 145, `linha com ${linha.length} caracteres`);
  assertStringIncludes(linha, "…");
});

Deno.test("sem marcador de negrito — a mesma string vai pro WhatsApp e pro Telegram", () => {
  const msg = montaMensagemMeioDoDia([L("Bolo")], [C("Call")])!;
  assert(!msg.includes("*"), `mensagem tem asterisco: ${msg}`);
  assert(!msg.includes("_"), `mensagem tem underscore: ${msg}`);
});

Deno.test("não cobra, não julga, não vira coach", () => {
  const msg = montaMensagemMeioDoDia([L("Bolo")], [C("Call")])!;
  for (const proibido of ["por que", "por quê", "você esqueceu", "não fez", "atrasad", "!"]) {
    assert(!msg.toLowerCase().includes(proibido), `mensagem tem "${proibido}": ${msg}`);
  }
});
