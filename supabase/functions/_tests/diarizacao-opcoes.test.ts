import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MAX_PESSOAS,
  MAX_VOCABULARIO,
  MIN_PESSOAS,
  montaVocabulario,
  validaPessoasEsperadas,
} from "../_shared/diarizacao.ts";

// ── Quantas pessoas ─────────────────────────────────────────────────────────
//
// O parâmetro só ajuda quando está certo. Com número errado ele ATRAPALHA:
// força o modelo a espremer ou esticar as vozes pra caber numa contagem que
// ninguém confirmou. Por isso tudo que é duvidoso vira `undefined` — deixar o
// provedor decidir é melhor que mandar um chute.

Deno.test("número na faixa passa como veio", () => {
  for (const n of [MIN_PESSOAS, 3, 4, 7, MAX_PESSOAS]) {
    assertEquals(validaPessoasEsperadas(n), n);
  }
});

Deno.test("fora da faixa vira undefined, nunca um default", () => {
  for (const n of [0, 1, MAX_PESSOAS + 1, 999, -3]) {
    assertEquals(validaPessoasEsperadas(n), undefined, `aceitou ${n}`);
  }
});

Deno.test("não-inteiro e lixo viram undefined", () => {
  for (const v of [2.5, NaN, Infinity, null, undefined, "", "muitas", {}, []]) {
    assertEquals(validaPessoasEsperadas(v), undefined, `aceitou ${JSON.stringify(v)}`);
  }
});

// A tela manda string ("4" de um <input>), e isso tem que funcionar sem a
// rota precisar lembrar de converter.
Deno.test("string numérica da tela é aceita", () => {
  assertEquals(validaPessoasEsperadas("4"), 4);
  assertEquals(validaPessoasEsperadas(" 6 "), 6);
});

// ── Vocabulário ─────────────────────────────────────────────────────────────

Deno.test("frentes do tenant viram o vocabulário", () => {
  assertEquals(montaVocabulario(["Resibag", "Sanwey"]), ["Resibag", "Sanwey"]);
});

// Termo curto colide com palavra comum — "IA" dentro de "dia", "RH" dentro de
// qualquer coisa. O ganho não paga o falso positivo.
Deno.test("termo curto demais fica de fora", () => {
  assertEquals(montaVocabulario(["IA", "RH", "ok", "Resibag"]), ["Resibag"]);
});

Deno.test("duplicata não entra duas vezes, mesmo com caixa diferente", () => {
  assertEquals(montaVocabulario(["Resibag", "resibag", "RESIBAG"]), ["Resibag"]);
});

Deno.test("espaço sobrando é normalizado, não vira termo novo", () => {
  assertEquals(montaVocabulario(["  Grupo   Sanwey  "]), ["Grupo Sanwey"]);
});

// Lista longa dilui: o provedor passa a "ouvir" o termo em qualquer ruído
// parecido, e aí piora em vez de melhorar.
Deno.test("teto de termos é respeitado", () => {
  const muitas = Array.from({ length: MAX_VOCABULARIO + 15 }, (_, i) => `Frente${i}`);
  assertEquals(montaVocabulario(muitas).length, MAX_VOCABULARIO);
});

Deno.test("tenant sem frente devolve lista vazia — e não um vocabulário de outro", () => {
  assertEquals(montaVocabulario([]), []);
  assertEquals(montaVocabulario(["", "   "]), []);
});

// O caminho que existia antes da tela de gravação: reunião compartilhada não
// tem como responder quantas pessoas. Precisa seguir funcionando sem o campo.
Deno.test("reunião sem o campo não quebra nada", () => {
  const opcoes = {
    pessoasEsperadas: validaPessoasEsperadas(null),
    vocabulario: montaVocabulario([]),
  };
  assertEquals(opcoes.pessoasEsperadas, undefined);
  assert(opcoes.vocabulario.length === 0);
});
