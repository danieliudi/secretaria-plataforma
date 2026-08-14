// Testes da voz da secretária. Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque as falhas aqui são todas SILENCIOSAS e todas caras:
//
// - rótulo desconhecido virando `undefined` no prompt: a secretária perde a
//   instrução de voz inteira e volta a falar de um jeito genérico, sem que
//   ninguém receba erro;
// - degrau de formalidade invertido: o cliente do usuário recebe emoji numa
//   cobrança, ou o usuário recebe "Prezado(a)" da própria secretária;
// - preset novo adicionado no tipo mas esquecido num dos mapas: quebra só pra
//   quem escolheu aquele preset, meses depois.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  instrucaoConversa,
  instrucaoRedacao,
  normalizaPersonalidade,
  PERSONALIDADE_PADRAO,
  PERSONALIDADES,
  subirUmDegrau,
  type Personalidade,
} from "../_shared/personalidade.ts";

// ─── normalização ───────────────────────────────────────────────────────────

Deno.test("aceita os quatro presets", () => {
  for (const p of PERSONALIDADES) {
    assertEquals(normalizaPersonalidade(p), p);
  }
});

Deno.test("normaliza caixa e espaço", () => {
  assertEquals(normalizaPersonalidade("  FORMAL "), "formal");
  assertEquals(normalizaPersonalidade("Leve"), "leve");
});

Deno.test("valor desconhecido cai no padrão em vez de virar undefined", () => {
  // Se isto voltasse `undefined`, `instrucaoConversa(undefined)` colocaria a
  // string "undefined" no prompt de sistema e a voz sumiria em silêncio.
  assertEquals(normalizaPersonalidade("simpática"), PERSONALIDADE_PADRAO);
  assertEquals(normalizaPersonalidade(""), PERSONALIDADE_PADRAO);
  assertEquals(normalizaPersonalidade(null), PERSONALIDADE_PADRAO);
  assertEquals(normalizaPersonalidade(undefined), PERSONALIDADE_PADRAO);
  assertEquals(normalizaPersonalidade(42), PERSONALIDADE_PADRAO);
  assertEquals(normalizaPersonalidade({ p: "formal" }), PERSONALIDADE_PADRAO);
});

Deno.test("o padrão do módulo é o mesmo default da migration", () => {
  // A migration cria a coluna com default 'cordial'. Se um dos dois mudar sem o
  // outro, tenant novo e tenant antigo passam a falar diferente.
  assertEquals(PERSONALIDADE_PADRAO, "cordial");
});

// ─── degrau de formalidade ──────────────────────────────────────────────────

Deno.test("leve sobe pra cordial", () => assertEquals(subirUmDegrau("leve"), "cordial"));
Deno.test("cordial sobe pra formal", () => assertEquals(subirUmDegrau("cordial"), "formal"));
Deno.test("formal é o teto", () => assertEquals(subirUmDegrau("formal"), "formal"));

Deno.test("direta NÃO sobe — é eixo de brevidade, não de informalidade", () => {
  // Decisão de projeto explícita. Empurrar `direta` pra `cordial` devolveria a
  // saudação e o fecho que a pessoa escolheu justamente não ter.
  assertEquals(subirUmDegrau("direta"), "direta");
});

Deno.test("a escada converge e não cicla", () => {
  // `instrucaoRedacao` aplica o degrau UMA vez só, então idempotência imediata
  // não é a propriedade certa — `leve` sobe pra `cordial`, que ainda subiria pra
  // `formal`. O que precisa valer é que a escada TERMINA: aplicando em sequência
  // se chega a um ponto fixo em poucos passos, sem ciclo infinito.
  for (const p of PERSONALIDADES) {
    let atual = p;
    let passos = 0;
    while (subirUmDegrau(atual) !== atual) {
      atual = subirUmDegrau(atual);
      if (++passos > 3) throw new Error(`escada de ${p} não converge`);
    }
    // Só existem dois pontos fixos: `formal` (teto de formalidade) e `direta`
    // (que não participa da escada, por ser eixo de brevidade).
    if (atual !== "formal" && atual !== "direta") {
      throw new Error(`${p} convergiu pra ponto fixo inesperado: ${atual}`);
    }
  }
});

// ─── completude dos mapas ───────────────────────────────────────────────────

Deno.test("todo preset tem instrução de conversa e de redação, não vazias", () => {
  // Pega o preset novo que entrou no tipo e foi esquecido num dos mapas.
  for (const p of PERSONALIDADES) {
    const conversa = instrucaoConversa(p);
    const redacao = instrucaoRedacao(p);
    assertEquals(typeof conversa, "string", `conversa de ${p}`);
    assertEquals(typeof redacao, "string", `redação de ${p}`);
    if (conversa.trim().length < 20) throw new Error(`instrução de conversa de ${p} vazia demais`);
    if (redacao.trim().length < 20) throw new Error(`instrução de redação de ${p} vazia demais`);
    if (conversa.includes("undefined")) throw new Error(`${p} vazou undefined na conversa`);
    if (redacao.includes("undefined")) throw new Error(`${p} vazou undefined na redação`);
  }
});

// ─── conteúdo que não pode se perder ────────────────────────────────────────

Deno.test("só o preset leve autoriza emoji na conversa", () => {
  assertStringIncludes(instrucaoConversa("direta"), "Nunca use emoji");
  assertStringIncludes(instrucaoConversa("cordial"), "Nunca use emoji");
  assertStringIncludes(instrucaoConversa("formal"), "sem emoji");
  assertStringIncludes(instrucaoConversa("leve"), "emoji");
});

Deno.test("redação avisa que o texto sai na voz do usuário", () => {
  // Sem isto o modelo escreve "Olá, sou a assistente do Daniel e gostaria de
  // confirmar..." — e quem envia é o Daniel, do número dele.
  for (const p of PERSONALIDADES) {
    const r = instrucaoRedacao(p);
    assertStringIncludes(r, "voz dele");
    assertStringIncludes(r, "nunca se apresente");
  }
});

Deno.test("quem escolhe leve não recebe rascunho com emoji", () => {
  // O caso que motivou o degrau: emoji em cobrança de cliente.
  const r = instrucaoRedacao("leve");
  assertStringIncludes(r, "Sem emoji");
});

Deno.test("quem escolhe cordial recebe rascunho formal", () => {
  assertStringIncludes(instrucaoRedacao("cordial"), "Prezado(a)");
});

Deno.test("quem escolhe direta recebe rascunho enxuto, sem saudação", () => {
  const r = instrucaoRedacao("direta");
  assertStringIncludes(r, "Sem saudação");
});

// ─── tipagem exaustiva em tempo de execução ─────────────────────────────────

Deno.test("subirUmDegrau devolve sempre um preset conhecido", () => {
  for (const p of PERSONALIDADES) {
    const alvo: Personalidade = subirUmDegrau(p);
    if (!(PERSONALIDADES as readonly string[]).includes(alvo)) {
      throw new Error(`${p} subiu pra valor fora do conjunto: ${alvo}`);
    }
  }
});
