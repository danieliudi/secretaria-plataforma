// O formato da pergunta das 19h. Função pura, roda offline.
//
// Cada teste aqui trava uma decisão tomada olhando um caso real de 01/09/2026,
// e que sem teste volta na primeira mexida: as três fontes (o caso da Erika),
// atrasada é pendência (o "Tinha 1 coisa hoje"), evento de dia inteiro existe,
// fonte que falhou aparece, e nenhum marcador de negrito — a mesma string vai
// pro WhatsApp e pro Telegram.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CompromissoDoDia,
  type LembreteDoDia,
  listaDeFontes,
  montaMensagemFimDoDia,
  RECAP_DIA_LIMPO,
  RECAP_MAX_ITENS,
  type TarefaDoDia,
} from "../_shared/fim-do-dia.ts";

const T = (name: string, frente = "resibag", atrasada = false, list?: string): TarefaDoDia => ({
  name,
  frente,
  list,
  atrasada,
});
const C = (titulo: string, hora: string | null = "15:00"): CompromissoDoDia => ({ titulo, hora });
const L = (texto: string, hora = "11:00"): LembreteDoDia => ({ texto, hora });

/** Os itens numerados da mensagem ("3. ☐ ..."). */
const itensDe = (msg: string) => msg.split("\n").filter((l) => /^\d+\. ☐ /.test(l));

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
  assertStringIncludes(msg, "1. ☐ Procurar o bolo 🎂 — 11:00");
});

// ── O caso do Daniel (01/09/2026) ───────────────────────────────────────────
// Quatro tarefas em aberto, todas vencidas em dias anteriores, e a mensagem
// disse "Tinha 1 coisa hoje" porque só entrava o que vencia exatamente hoje.
Deno.test("atrasada é pendência: entra na lista e diz que está atrasada", () => {
  const msg = montaMensagemFimDoDia(
    [T("Finalizar plano de vendas", "Resibag", true), T("Enviar NF", "Resibag")],
    [],
    [],
  );
  assertStringIncludes(msg, "1. ☐ Finalizar plano de vendas (atrasada)");
  assertStringIncludes(msg, "2. ☐ Enviar NF");
  assertEquals(itensDe(msg).length, 2);
});

Deno.test("evento de dia inteiro aparece, e sem horário inventado", () => {
  const msg = montaMensagemFimDoDia([], [C("TROCAR FILTRO CHUVEIRO", null)], []);
  assertStringIncludes(msg, "☐ TROCAR FILTRO CHUVEIRO, dia todo");
  assert(!msg.includes("00:00"), msg);
});

Deno.test("seção sem item é omitida — nem o cabeçalho aparece", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb")], [], []);
  assertStringIncludes(msg, "Pendências");
  assert(!msg.includes("Agenda"), msg);
  assert(!msg.includes("Lembretes"), msg);
});

Deno.test("as três seções juntas, numeradas em sequência contínua", () => {
  // Contínua porque numeração que reinicia por seção torna "fiz a 2" ambíguo,
  // e ambiguidade aqui vira complete_task no item errado.
  const msg = montaMensagemFimDoDia(
    [T("Mandar a proposta revisada")],
    [C("Call com o Takahiro", "15:00")],
    [L("Procurar o bolo 🎂", "11:00")],
  );
  assertStringIncludes(msg, "1. ☐ Mandar a proposta revisada");
  assertStringIncludes(msg, "2. ☐ Call com o Takahiro, 15:00");
  assertStringIncludes(msg, "3. ☐ Procurar o bolo 🎂 — 11:00");
});

Deno.test("pergunta aberta e oferta de empurrar pra amanhã — é o que fecha o ciclo", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar o retorno da Locaweb")], [], []);
  assertStringIncludes(msg, "O que andou hoje?");
  assertStringIncludes(msg, "passo pra amanhã");
});

Deno.test("o exemplo de resposta acompanha o tamanho da lista", () => {
  assertStringIncludes(montaMensagemFimDoDia([T("Só essa")], [], []), '"fiz" já resolve');
  assertStringIncludes(montaMensagemFimDoDia([T("Uma"), T("Duas")], [], []), '"fiz a 1" já resolve');
  assertStringIncludes(
    montaMensagemFimDoDia([T("Uma"), T("Duas"), T("Três")], [], []),
    '"fiz a 1 e a 3" já resolve',
  );
});

Deno.test("uma frente só: nenhum rótulo de frente polui a lista", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb"), T("Renovar o certificado")], [], []);
  assert(!msg.includes("resibag"), msg);
});

Deno.test("várias frentes: cada linha diz de qual frente é", () => {
  const msg = montaMensagemFimDoDia(
    [T("Cobrar a Locaweb", "resibag"), T("Fechar o orçamento", "sanwey", false, "Pauta")],
    [],
    [],
  );
  assertStringIncludes(msg, "1. ☐ Cobrar a Locaweb · resibag");
  assertStringIncludes(msg, "2. ☐ Fechar o orçamento · sanwey/Pauta");
});

Deno.test("o teto vale pro conjunto das três seções", () => {
  const tarefas = Array.from({ length: RECAP_MAX_ITENS }, (_, i) => T(`Tarefa ${i + 1}`));
  const msg = montaMensagemFimDoDia(tarefas, [C("Call extra")], [L("Lembrete extra")]);

  assertEquals(itensDe(msg).length, RECAP_MAX_ITENS);
  assertStringIncludes(msg, `(mostrei ${RECAP_MAX_ITENS} de ${RECAP_MAX_ITENS + 2})`);
});

Deno.test("a numeração nunca passa do teto nem pula número", () => {
  const tarefas = Array.from({ length: 10 }, (_, i) => T(`Tarefa ${i + 1}`));
  const compromissos = Array.from({ length: 10 }, (_, i) => C(`Reunião ${i + 1}`));
  const msg = montaMensagemFimDoDia(tarefas, compromissos, []);
  const numeros = itensDe(msg).map((l) => Number(l.split(".")[0]));
  assertEquals(numeros, Array.from({ length: RECAP_MAX_ITENS }, (_, i) => i + 1));
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
  // Não pode virar mais um item numerado — pedir confirmação de algo já
  // resolvido é exatamente o ruído que faz a pessoa parar de responder.
  assertEquals(itensDe(msg).length, 1);
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

// ── Fonte que falhou: a mensagem não pode parecer completa ──────────────────
Deno.test("fonte que falhou aparece na abertura", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb")], [], [], [], ["agenda"]);
  assertStringIncludes(msg, "a agenda não respondeu agora");
  assertStringIncludes(msg, "1. ☐ Cobrar a Locaweb");
});

Deno.test("nada lido + fonte falhando não vira dia limpo", () => {
  // Afirmar tranquilidade sobre um dia que ninguém conseguiu ler soa
  // exatamente igual ao caso bom — é a pior versão do erro.
  const msg = montaMensagemFimDoDia([], [], [], [], ["agenda", "lista de tarefas"]);
  assert(!msg.includes("Dia limpo"), msg);
  assertStringIncludes(msg, "a agenda e a lista de tarefas");
});

Deno.test("listaDeFontes escreve pra caber no meio da frase", () => {
  assertEquals(listaDeFontes([]), "");
  assertEquals(listaDeFontes(["agenda"]), "a agenda");
  assertEquals(listaDeFontes(["agenda", "lista de tarefas"]), "a agenda e a lista de tarefas");
});

// ── Formatação que precisa funcionar nos DOIS canais ────────────────────────
Deno.test("sem marcador de negrito — a mesma string vai pro WhatsApp e pro Telegram", () => {
  // WhatsApp faz negrito com *um*, Telegram (toTelegramHtml) só com **dois**.
  // Qualquer um dos dois aparece cru no outro canal.
  const msg = montaMensagemFimDoDia(
    [T("Cobrar a Locaweb", "resibag", true)],
    [C("Call com o Takahiro"), C("Trocar o filtro", null)],
    [L("Procurar o bolo")],
    ["Atualizar SWOT"],
    ["agenda"],
  );
  assert(!msg.includes("*"), `mensagem tem asterisco: ${msg}`);
  assert(!msg.includes("_"), `mensagem tem underscore: ${msg}`);
});

Deno.test("texto gigante vindo de fora é cortado, não vira parede", () => {
  const msg = montaMensagemFimDoDia([], [], [L("x".repeat(400), "11:00")]);
  const linha = itensDe(msg)[0];
  assert(linha.length < 145, `linha com ${linha.length} caracteres`);
  assertStringIncludes(linha, "…");
});

Deno.test("não cobra, não julga, não vira coach", () => {
  // "atrasada" continua PERMITIDO: é fato, e escondê-lo foi o que fez a
  // mensagem das 19h contradizer a das 06:00. O que segue proibido é o
  // comentário sobre a pessoa.
  const msg = montaMensagemFimDoDia(
    [T("Cobrar a Locaweb", "resibag", true)],
    [],
    [L("Procurar o bolo")],
  );
  for (const proibido of ["por que", "por quê", "você consegue", "não deu conta", "!"]) {
    assert(!msg.toLowerCase().includes(proibido), `mensagem tem "${proibido}": ${msg}`);
  }
});
