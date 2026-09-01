// "Lugar novo". O modo de falha que importa NÃO é deixar passar um lugar
// inédito — é dizer "você nunca foi aí" sobre o escritório onde a pessoa vai
// toda semana. O primeiro é silêncio; o segundo queima a confiança na feature
// inteira. Por isso a maior parte destes testes empurra pro lado de "conhecido".

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dicasDoLugar,
  ehVirtual,
  jaEsteve,
  mesmoLugar,
  montaAvisoLugarNovo,
  normalizaLocal,
} from "../_shared/lugar-novo.ts";

// ─── O mesmo lugar escrito de jeitos diferentes ─────────────────────────────

Deno.test("mesmo endereço com e sem CEP, acento e abreviação", () => {
  assert(mesmoLugar(
    "Av. Paulista, 1000 - Bela Vista, São Paulo - SP, 01310-100",
    "Avenida Paulista 1000, Sao Paulo",
  ));
  assert(mesmoLugar("Rua Titã, 400 - Diadema", "R. Tita 400, Diadema - SP"));
});

Deno.test("nome curto do lugar casa com o endereço completo", () => {
  assert(mesmoLugar(
    "Titã Diadema",
    "Rua das Indústrias, 400 - Diadema, Titã",
  ));
});

Deno.test("mesmo prédio, sala diferente, continua sendo o mesmo lugar", () => {
  assert(mesmoLugar(
    "Ed. Berrini One, Av. Chucri Zaidan 1240 - sala 502",
    "Av Chucri Zaidan 1240, Berrini One, andar 12",
  ));
});

// ─── Lugares diferentes de verdade ──────────────────────────────────────────

// DECIDIDO em 01/09/2026: número diferente na mesma rua É lugar novo, e a Mia
// deve avisar. Augusta 100 e Augusta 2500 são 2 km de distância. Antes disso o
// número era ignorado e os dois casavam por rua + cidade.
//
// A implementação veta pelo número ANTES dos atalhos generosos, mas só quando
// os dois lados têm número de LOGRADOURO — os três testes logo acima seguem
// passando, e é isso que impede o veto de virar barulho.
Deno.test("mesma rua, número diferente, não é o mesmo lugar", () => {
  assert(!mesmoLugar("Rua Augusta, 100 - São Paulo", "Rua Augusta, 2500 - São Paulo"));
});

// As duas regressões que o veto pelo número podia causar — e que ele não causa.
// Sem elas, um aperto futuro nesta regra quebraria em produção, não aqui.
Deno.test("número de andar/sala não conta como número do logradouro", () => {
  // Mesmo prédio: um lado escrito pelo nome + andar, outro pelo endereço. Se o
  // "12" de "andar 12" contasse, viraria um "lugar novo" falso.
  assert(mesmoLugar("Berrini One - andar 12", "Ed. Berrini One, Av. Chucri Zaidan 1240"));
});

Deno.test("número que é substring de outro não casa por acidente", () => {
  // "rua augusta 100" é substring literal de "rua augusta 1000", e o atalho de
  // substring casava os dois antes do veto.
  assert(!mesmoLugar("Rua Augusta, 100", "Rua Augusta, 1000"));
});

Deno.test("ruas diferentes na mesma cidade não casam por causa de 'rua' e 'sp'", () => {
  assert(!mesmoLugar("Rua Haddock Lobo, 50 - SP", "Rua Oscar Freire, 900 - SP"));
});

// ─── Virtual não é lugar ────────────────────────────────────────────────────

Deno.test("link de reunião e sala vazia nunca viram lugar novo", () => {
  for (const l of [
    null,
    "",
    "   ",
    "https://meet.google.com/abc-defg-hij",
    "https://us02web.zoom.us/j/123",
    "Microsoft Teams Meeting",
    "Online",
    "a definir",
  ]) {
    assert(ehVirtual(l), `deveria ser virtual: ${l}`);
  }
});

Deno.test("endereço de verdade não é confundido com virtual", () => {
  assert(!ehVirtual("Rua Titã, 400 - Diadema"));
});

// ─── jaEsteve ───────────────────────────────────────────────────────────────

Deno.test("lugar que aparece no histórico não vira aviso", () => {
  const historico = [
    "Av. Paulista, 1000 - São Paulo",
    "Rua Augusta, 2500",
  ];
  assert(jaEsteve("Avenida Paulista 1000, Sao Paulo - SP", historico));
});

Deno.test("lugar inédito é reconhecido como inédito", () => {
  const historico = ["Av. Paulista, 1000 - São Paulo"];
  assert(!jaEsteve("Rua das Indústrias, 400 - Diadema", historico));
});

Deno.test("histórico vazio não faz tudo virar lugar novo por acidente de comparação", () => {
  assert(!jaEsteve("Rua Titã, 400", []));
});

// ─── Dicas ──────────────────────────────────────────────────────────────────

Deno.test("planta industrial rende dica de sapato e crachá", () => {
  const dicas = dicasDoLugar("Visita técnica na Titã", "Planta industrial - Diadema");
  assert(dicas.some((d) => d.includes("sapato fechado")));
  assert(dicas.some((d) => d.toLowerCase().includes("crachá")));
});

Deno.test("órgão público rende dica de documento original", () => {
  const dicas = dicasDoLugar("Cartório", "Cartório do 3º Ofício");
  assert(dicas.some((d) => d.includes("ORIGINAL")));
});

Deno.test("lugar que nenhuma regra reconhece não inventa dica", () => {
  assertEquals(dicasDoLugar("Almoço", "Rua Qualquer, 12"), []);
});

Deno.test("gatilho funciona com acento no título", () => {
  assert(dicasDoLugar("Visita à fábrica", "Rua X, 1").length > 0);
});

// ─── A mensagem ─────────────────────────────────────────────────────────────

Deno.test("a mensagem NUNCA fala de previsão do tempo — não temos esse dado", () => {
  const msg = montaAvisoLugarNovo({
    titulo: "Visita técnica na Titã",
    hora: "14:00",
    local: "Rua das Indústrias, 400 - Diadema",
    temConvite: true,
  });
  for (const proibido of ["chuv", "tempo", "guarda-chuva", "sol", "temperatura", "graus"]) {
    assert(!msg.toLowerCase().includes(proibido), `mensagem fala de tempo ("${proibido}"): ${msg}`);
  }
});

Deno.test("a mensagem diz a hora, o lugar e que é a primeira vez", () => {
  const msg = montaAvisoLugarNovo({
    titulo: "Visita técnica na Titã",
    hora: "14:00",
    local: "Rua das Indústrias, 400 - Diadema",
    temConvite: false,
  });
  assertStringIncludes(msg, "14:00");
  assertStringIncludes(msg, "Diadema");
  assertStringIncludes(msg, "primeira vez");
});

Deno.test("sem convidado, não oferece procurar o convite que não existe", () => {
  const msg = montaAvisoLugarNovo({
    titulo: "Visita",
    hora: "09:00",
    local: "Rua X, 1",
    temConvite: false,
  });
  assert(!msg.includes("convite"));
});

Deno.test("com convidado, oferece procurar o contato", () => {
  const msg = montaAvisoLugarNovo({
    titulo: "Visita",
    hora: "09:00",
    local: "Rua X, 1",
    temConvite: true,
  });
  assertStringIncludes(msg, "convite");
});

Deno.test("evento de dia inteiro sai sem hora, sem traço solto", () => {
  const msg = montaAvisoLugarNovo({
    titulo: "Feira Fispal",
    hora: null,
    local: "Expo Center Norte",
    temConvite: false,
  });
  assert(!msg.includes(" — Feira"), msg);
  assertStringIncludes(msg, "Feira Fispal");
});

Deno.test("normalizaLocal tira CEP e pontuação", () => {
  assertEquals(normalizaLocal("Av. Paulista, 1000 - SP, 01310-100"), "av paulista 1000 sp");
});

// ─── Entrada não confiável ──────────────────────────────────────────────────

Deno.test("título gigante de convite de terceiro não vira parede de texto", () => {
  const msg = montaAvisoLugarNovo({
    titulo: "Reunião ".repeat(400),
    hora: "10:00",
    local: "Rua X, 1 - Diadema",
    temConvite: false,
  });
  // Cabeçalho + linha do título + linha do local, todas curtas.
  const maiorLinha = Math.max(...msg.split("\n").map((l) => l.length));
  assert(maiorLinha < 200, `linha de ${maiorLinha} chars: ${maiorLinha}`);
});

Deno.test("endereço gigante também é cortado", () => {
  const msg = montaAvisoLugarNovo({
    titulo: "Visita",
    hora: "10:00",
    local: "Av. Muito Longa ".repeat(200),
    temConvite: false,
  });
  assert(msg.length < 600, `mensagem de ${msg.length} chars`);
  assertStringIncludes(msg, "…");
});

Deno.test("título e endereço normais passam inteiros, sem reticências", () => {
  const msg = montaAvisoLugarNovo({
    titulo: "Visita técnica na Titã",
    hora: "14:00",
    local: "Rua das Indústrias, 400 - Diadema, SP",
    temConvite: false,
  });
  assertStringIncludes(msg, "Visita técnica na Titã");
  assertStringIncludes(msg, "Rua das Indústrias, 400 - Diadema, SP");
  assert(!msg.includes("…"));
});
