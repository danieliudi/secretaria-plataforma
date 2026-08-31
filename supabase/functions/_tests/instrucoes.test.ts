// Memória editável. Três coisas que estes testes travam:
//
//   1. O CORPO NUNCA ENTRA NO PROMPT. É a razão de ser do desenho inteiro —
//      se o texto vazar pro bloco do system prompt, a memória volta a custar
//      cache write em toda conversa e o recurso perde o sentido.
//   2. PROPOSTA NASCE DESLIGADA. A Mia escreve, nunca ativa. Instrução ativa
//      muda toda resposta futura; uma que ela ligou sozinha contamina tudo em
//      silêncio.
//   3. Abrir conta uso, mas contador quebrado não impede a instrução de abrir.

import { assert, assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  abreInstrucao,
  buildInstrucoesSystemBlock,
  type Instrucao,
  type InstrucoesDeps,
  MAX_NOME,
  MAX_QUANDO_USAR,
  MAX_TEXTO,
  propoeInstrucao,
  slugDoNome,
} from "../_shared/instrucoes.ts";

const TENANT = "11111111-1111-1111-1111-111111111111";

const CORPO_SECRETO =
  "Tom direto, sem adjetivo de vendedor. Nunca prometer prazo sem confirmar antes.";

function deps(opts: {
  instrucao?: Instrucao | null;
  usoFalha?: boolean;
} = {}) {
  const usosRegistrados: string[] = [];
  const criadas: Array<{ slug: string; nome: string; quando_usar: string; texto: string }> = [];
  const d: InstrucoesDeps = {
    carregaIndice: () =>
      Promise.resolve([
        { slug: "como-eu-escrevo", nome: "Como eu escrevo", quando_usar: "Quando eu pedir pra redigir e-mail." },
      ]),
    carregaTexto: () => Promise.resolve(opts.instrucao ?? null),
    registraUso: (_t, slug) => {
      if (opts.usoFalha) return Promise.reject(new Error("banco fora do ar"));
      usosRegistrados.push(slug);
      return Promise.resolve();
    },
    criaProposta: (_t, inst) => {
      criadas.push(inst);
      return Promise.resolve();
    },
  };
  return { deps: d, usosRegistrados, criadas };
}

// ─── O bloco do prompt ──────────────────────────────────────────────────────

Deno.test("bloco do prompt leva só nome e gatilho — o corpo NUNCA", () => {
  const bloco = buildInstrucoesSystemBlock([
    { slug: "como-eu-escrevo", nome: "Como eu escrevo", quando_usar: "Quando eu pedir pra redigir e-mail." },
  ]);
  assertStringIncludes(bloco, "Como eu escrevo");
  assertStringIncludes(bloco, "Quando eu pedir pra redigir e-mail.");
  assertStringIncludes(bloco, "como-eu-escrevo");
  // O corpo não é nem parâmetro da função — mas o teste existe pra travar isso
  // se alguém "melhorar" a assinatura pra receber a instrução inteira.
  assert(!bloco.includes(CORPO_SECRETO), "o corpo vazou pro system prompt");
});

Deno.test("sem instrução ativa, o bloco é vazio — quem não escreveu não paga nada", () => {
  assertEquals(buildInstrucoesSystemBlock([]), "");
});

Deno.test("o bloco diz que ela não pode ativar sozinha", () => {
  const bloco = buildInstrucoesSystemBlock([
    { slug: "x", nome: "X", quando_usar: "quando Y" },
  ]);
  assertStringIncludes(bloco, "DESLIGADA");
  assertStringIncludes(bloco, "não pode ligar");
});

Deno.test("o bloco manda ela dizer qual instrução usou", () => {
  const bloco = buildInstrucoesSystemBlock([{ slug: "x", nome: "X", quando_usar: "quando Y" }]);
  assertStringIncludes(bloco, "diga em UMA linha");
});

// ─── Abrir ──────────────────────────────────────────────────────────────────

const INSTRUCAO: Instrucao = {
  slug: "como-eu-escrevo",
  nome: "Como eu escrevo",
  quando_usar: "Quando eu pedir pra redigir e-mail.",
  texto: CORPO_SECRETO,
};

Deno.test("abrir devolve o corpo e conta o uso", async () => {
  const { deps: d, usosRegistrados } = deps({ instrucao: INSTRUCAO });
  const inst = await abreInstrucao(TENANT, "como-eu-escrevo", d);
  assertEquals(inst?.texto, CORPO_SECRETO);
  assertEquals(usosRegistrados, ["como-eu-escrevo"]);
});

Deno.test("contador quebrado não impede a instrução de abrir", async () => {
  const { deps: d } = deps({ instrucao: INSTRUCAO, usoFalha: true });
  const inst = await abreInstrucao(TENANT, "como-eu-escrevo", d);
  assertEquals(inst?.texto, CORPO_SECRETO);
});

Deno.test("slug desconhecido devolve null — o modelo diz que não achou", async () => {
  const { deps: d, usosRegistrados } = deps({ instrucao: null });
  assertEquals(await abreInstrucao(TENANT, "nao-existe", d), null);
  assertEquals(usosRegistrados.length, 0);
});

Deno.test("nome com acento e maiúscula chega no banco como slug", async () => {
  let pedido = "";
  const d: InstrucoesDeps = {
    carregaIndice: () => Promise.resolve([]),
    carregaTexto: (_t, slug) => {
      pedido = slug;
      return Promise.resolve(null);
    },
    registraUso: () => Promise.resolve(),
    criaProposta: () => Promise.resolve(),
  };
  await abreInstrucao(TENANT, "Como Eu Escrevo Pra Cliente Industrial", d);
  assertEquals(pedido, "como-eu-escrevo-pra-cliente-industrial");
});

// ─── Propor ─────────────────────────────────────────────────────────────────

Deno.test("proposta da Mia é gravada, e a tool não tem como ligá-la", async () => {
  const { deps: d, criadas } = deps();
  const { slug } = await propoeInstrucao(TENANT, {
    nome: "Onde eu encaixo reunião",
    quando_usar: "Sempre que eu for sugerir horário.",
    texto: "Reunião é de manhã.",
  }, d);

  assertEquals(slug, "onde-eu-encaixo-reuniao");
  assertEquals(criadas.length, 1);
  // `ativo` não é campo da proposta: o único jeito de ligar é a rota do /app,
  // que exige sessão do dono. Nem a tool nem esta função têm como.
  assert(!("ativo" in criadas[0]), "proposta não pode carregar `ativo`");
});

Deno.test("proposta sem gatilho é recusada — sem ele a instrução nunca abriria", async () => {
  const { deps: d, criadas } = deps();
  await assertRejects(
    () => propoeInstrucao(TENANT, { nome: "X", quando_usar: "   ", texto: "algo" }, d),
    Error,
    "quando_usar vazio",
  );
  assertEquals(criadas.length, 0);
});

Deno.test("proposta sem nome ou sem texto é recusada", async () => {
  const { deps: d, criadas } = deps();
  await assertRejects(
    () => propoeInstrucao(TENANT, { nome: "  ", quando_usar: "quando X", texto: "algo" }, d),
    Error,
    "nome vazio",
  );
  await assertRejects(
    () => propoeInstrucao(TENANT, { nome: "X", quando_usar: "quando X", texto: "" }, d),
    Error,
    "texto vazio",
  );
  assertEquals(criadas.length, 0);
});

Deno.test("nome só de pontuação não vira instrução sem identificador", async () => {
  const { deps: d, criadas } = deps();
  await assertRejects(
    () => propoeInstrucao(TENANT, { nome: "!!! ???", quando_usar: "quando X", texto: "algo" }, d),
    Error,
    "identificador válido",
  );
  assertEquals(criadas.length, 0);
});

Deno.test("texto gigante do modelo é cortado, não recusado nem gravado inteiro", async () => {
  const { deps: d, criadas } = deps();
  await propoeInstrucao(TENANT, {
    nome: "N".repeat(200),
    quando_usar: "Q".repeat(400),
    texto: "T".repeat(20_000),
  }, d);
  assertEquals(criadas[0].nome.length, MAX_NOME);
  assertEquals(criadas[0].quando_usar.length, MAX_QUANDO_USAR);
  assertEquals(criadas[0].texto.length, MAX_TEXTO);
});

// ─── Slug ───────────────────────────────────────────────────────────────────

Deno.test("slug é estável e seguro pra URL", () => {
  assertEquals(slugDoNome("Como eu escrevo pra Cliente Industrial"), "como-eu-escrevo-pra-cliente-industrial");
  assertEquals(slugDoNome("  Reunião com o Takahiro!  "), "reuniao-com-o-takahiro");
  assertEquals(slugDoNome("a/../b"), "a-b");
  assertEquals(slugDoNome("!!!"), "");
  assert(slugDoNome("x".repeat(200)).length <= 60);
});
