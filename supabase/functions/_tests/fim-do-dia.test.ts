import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CompromissoDoDia,
  type LembreteDoDia,
  montaMensagemFimDoDia,
  RECAP_DIA_LIMPO,
  RECAP_MAX_ITENS,
} from "../_shared/fim-do-dia.ts";

const T = (name: string, frente = "resibag", list?: string) => ({ name, frente, list });
const C = (titulo: string, hora = "15:00"): CompromissoDoDia => ({ titulo, hora });
const L = (texto: string, hora = "11:00"): LembreteDoDia => ({ texto, hora });

Deno.test("as TRÊS fontes vazias devolvem o texto de dia limpo, não silêncio", () => {
  assertEquals(montaMensagemFimDoDia([], [], []), RECAP_DIA_LIMPO);
});

Deno.test("o texto de dia limpo não fala só de tarefa — cita as três fontes", () => {
  // O texto antigo era "Nada com prazo hoje na sua lista", que descrevia a
  // fonte de TAREFAS e por isso soava verdadeiro mesmo num dia com lembrete.
  assertStringIncludes(RECAP_DIA_LIMPO, "tarefa");
  assertStringIncludes(RECAP_DIA_LIMPO, "compromisso");
  assertStringIncludes(RECAP_DIA_LIMPO, "lembrete");
});

// ── O caso da Erika (01/09/2026) ────────────────────────────────────────────
// Ela não tem tarefa nem agenda. Recebeu "Lembra de procurar o bolo 🎂" às 11h
// e, às 19h, "Dia limpo" — da mesma secretária, no mesmo chat. Este é o teste
// que impede a volta disso.
Deno.test("só lembrete, sem tarefa nem agenda: o dia NÃO é limpo", () => {
  const msg = montaMensagemFimDoDia([], [], [L("Procurar o bolo 🎂", "11:00")]);
  assert(msg !== RECAP_DIA_LIMPO, "voltou a dizer que o dia estava limpo");
  assertStringIncludes(msg, "Lembretes que te mandei");
  assertStringIncludes(msg, "• Procurar o bolo 🎂 — 11:00");
});

Deno.test("seção sem item é omitida — nem o cabeçalho aparece", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb")], [], []);
  assertStringIncludes(msg, "Tarefas com prazo hoje");
  assert(!msg.includes("Agenda"), msg);
  assert(!msg.includes("Lembretes"), msg);
});

Deno.test("as três seções juntas, cada uma com seu marcador", () => {
  const msg = montaMensagemFimDoDia(
    [T("Mandar a proposta revisada")],
    [C("Call com o Takahiro", "15:00")],
    [L("Procurar o bolo 🎂", "11:00")],
  );
  assertStringIncludes(msg, "☐ Mandar a proposta revisada");
  assertStringIncludes(msg, "• Call com o Takahiro, 15:00");
  assertStringIncludes(msg, "• Procurar o bolo 🎂 — 11:00");
});

Deno.test("pergunta aberta e oferta de empurrar pra amanhã — é o que fecha o ciclo", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar o retorno da Locaweb")], [], []);
  assertStringIncludes(msg, "O que andou hoje?");
  assertStringIncludes(msg, "passo pra amanhã");
});

Deno.test("uma frente só: nenhum rótulo de frente polui a lista", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb"), T("Renovar o certificado")], [], []);
  assert(!msg.includes("resibag"), msg);
});

Deno.test("várias frentes: cada linha diz de qual frente é", () => {
  const msg = montaMensagemFimDoDia(
    [T("Cobrar a Locaweb", "resibag"), T("Fechar o orçamento", "sanwey", "Pauta")],
    [],
    [],
  );
  assertStringIncludes(msg, "☐ Cobrar a Locaweb · resibag");
  assertStringIncludes(msg, "☐ Fechar o orçamento · sanwey/Pauta");
});

Deno.test("o teto vale pro conjunto das três seções", () => {
  const tarefas = Array.from({ length: RECAP_MAX_ITENS }, (_, i) => T(`Tarefa ${i + 1}`));
  const msg = montaMensagemFimDoDia(tarefas, [C("Call extra")], [L("Lembrete extra")]);

  const itens = msg.split("\n").filter((l) => l.startsWith("☐") || l.startsWith("•"));
  assertEquals(itens.length, RECAP_MAX_ITENS);
  assertStringIncludes(msg, `(mostrei ${RECAP_MAX_ITENS} de ${RECAP_MAX_ITENS + 2})`);
});

Deno.test("no teto exato não aparece rodapé de corte", () => {
  const exatas = Array.from({ length: RECAP_MAX_ITENS }, (_, i) => T(`Tarefa ${i + 1}`));
  const msg = montaMensagemFimDoDia(exatas, [], []);
  assert(!msg.includes("mostrei"), msg);
});

// ── Concluídas: reconhecimento, não pergunta ────────────────────────────────
Deno.test("tarefa fechada no dia vira linha de fechamento, não item de pergunta", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb")], [], [], ["Atualizar SWOT"]);
  assertStringIncludes(msg, "Já fechado hoje: Atualizar SWOT ✅");
  // Não pode virar mais um "☐" — pedir confirmação de algo já resolvido é
  // exatamente o ruído que faz a pessoa parar de responder.
  assert(!msg.includes("☐ Atualizar SWOT"), msg);
});

Deno.test("muitas concluídas viram contagem em vez de parede de nomes", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb")], [], [], ["A", "B", "C", "D", "E"]);
  assertStringIncludes(msg, "Já fechado hoje: A, B, C e mais 2 ✅");
});

Deno.test("só concluídas, nada em aberto: não pergunta o que andou", () => {
  const msg = montaMensagemFimDoDia([], [], [], ["Atualizar SWOT"]);
  assertStringIncludes(msg, "Já fechado hoje: Atualizar SWOT ✅");
  assert(!msg.includes("O que andou hoje?"), msg);
  assert(!msg.includes("passo pra amanhã"), msg);
});

// ── Formatação que precisa funcionar nos DOIS canais ────────────────────────
Deno.test("sem marcador de negrito — a mesma string vai pro WhatsApp e pro Telegram", () => {
  // WhatsApp faz negrito com *um*, Telegram (toTelegramHtml) só com **dois**.
  // Qualquer um dos dois aparece cru no outro canal.
  const msg = montaMensagemFimDoDia(
    [T("Cobrar a Locaweb")],
    [C("Call com o Takahiro")],
    [L("Procurar o bolo")],
    ["Atualizar SWOT"],
  );
  assert(!msg.includes("*"), `mensagem tem asterisco: ${msg}`);
  assert(!msg.includes("_"), `mensagem tem underscore: ${msg}`);
});

Deno.test("texto gigante vindo de fora é cortado, não vira parede", () => {
  const msg = montaMensagemFimDoDia([], [], [L("x".repeat(400), "11:00")]);
  const linha = msg.split("\n").find((l) => l.startsWith("•"))!;
  assert(linha.length < 140, `linha com ${linha.length} caracteres`);
  assertStringIncludes(linha, "…");
});

Deno.test("não cobra, não julga, não vira coach", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb")], [], [L("Procurar o bolo")]);
  for (const proibido of ["por que", "por quê", "você consegue", "atrasad", "pendênc", "!"]) {
    assert(!msg.toLowerCase().includes(proibido), `mensagem tem "${proibido}": ${msg}`);
  }
});
