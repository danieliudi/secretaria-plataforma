// Testes do portão de templates. Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque este módulo é a fronteira entre "a secretária preenche um
// texto aprovado" e "a secretária escreve o que quiser pra um estranho". O
// segundo é o comportamento que a Meta bloqueia conta por fazer, e o teste que
// mais importa aqui é o que garante que nome desconhecido NÃO vira envio.
//
// A segunda metade cobre as regras de variável da Meta (sem quebra de linha,
// sem tab, sem 5+ espaços). Violar essas não dá erro nosso: a mensagem sai,
// a Meta rejeita uma a uma, e a falha só aparece do lado de lá.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MAX_VARIAVEL, montaTemplate, TEMPLATES } from "../_shared/templates-wa.ts";

const TEL = "5511988887777";
const CONF = {
  destinatario: "Ana",
  remetente: "Daniel",
  compromisso: "Alinhamento Comercial",
  dia: "amanhã",
  hora: "14h",
};

// ─── o portão ───────────────────────────────────────────────────────────────

Deno.test("template desconhecido é RECUSADO, não enviado", () => {
  // O teste central do arquivo. Se isto passar a devolver ok:true um dia, a
  // plataforma ganhou um caminho pra mandar texto livre pra terceiro.
  const r = montaTemplate("cobranca_orcamento", TEL, { qualquer: "coisa" });
  assertEquals(r.ok, false);
  if (!r.ok) assertStringIncludes(r.motivo, "link");
});

Deno.test("nome vazio ou estranho não passa", () => {
  for (const n of ["", " ", "confirmacao", "CONFIRMACAO_COMPROMISSO", "__proto__", "constructor"]) {
    assertEquals(montaTemplate(n, TEL, CONF).ok, false, `passou: "${n}"`);
  }
});

Deno.test("todo template do catálogo é utility", () => {
  // Marketing exige opt-in prévio e custa ~9x. Se um dia entrar um template
  // marketing aqui, ele herda silenciosamente as regras de utility.
  for (const def of Object.values(TEMPLATES)) {
    assertEquals(def.categoria, "utility", `${def.nome} não é utility`);
  }
});

// ─── caminho feliz ──────────────────────────────────────────────────────────

Deno.test("monta o payload no formato do Cloud API", () => {
  const r = montaTemplate("confirmacao_compromisso", TEL, CONF);
  if (!r.ok) throw new Error(`esperava sucesso: ${r.motivo}`);
  assertEquals(r.payload.messaging_product, "whatsapp");
  assertEquals(r.payload.to, TEL);
  assertEquals(r.payload.type, "template");
  assertEquals(r.payload.template.name, "confirmacao_compromisso");
  assertEquals(r.payload.template.language.code, "pt_BR");
  assertEquals(r.payload.template.components[0].parameters.map((p) => p.text), [
    "Ana",
    "Daniel",
    "Alinhamento Comercial",
    "amanhã",
    "14h",
  ]);
});

Deno.test("a ordem das variáveis segue o catálogo, não o objeto", () => {
  // Objeto em JS não garante ordem entre chaves numéricas e de texto, e a Meta
  // posiciona por índice: trocar a ordem manda o nome no lugar da hora.
  const embaralhado = {
    hora: "14h",
    destinatario: "Ana",
    dia: "amanhã",
    remetente: "Daniel",
    compromisso: "Alinhamento Comercial",
  };
  const r = montaTemplate("confirmacao_compromisso", TEL, embaralhado);
  if (!r.ok) throw new Error("esperava sucesso");
  assertEquals(r.payload.template.components[0].parameters[0].text, "Ana");
  assertEquals(r.payload.template.components[0].parameters[4].text, "14h");
});

Deno.test("a prévia substitui tudo e traz o rodapé de saída", () => {
  const r = montaTemplate("confirmacao_compromisso", TEL, CONF);
  if (!r.ok) throw new Error("esperava sucesso");
  assertStringIncludes(r.previa, "Oi Ana, aqui é a secretária do Daniel.");
  assertStringIncludes(r.previa, "Alinhamento Comercial, amanhã às 14h.");
  assertStringIncludes(r.previa, "Responda SAIR");
  // Nenhum marcador sobrando — marcador na prévia significa marcador na
  // mensagem que o cliente recebe.
  if (/\{\{\d+\}\}/.test(r.previa)) throw new Error(`sobrou marcador: ${r.previa}`);
});

Deno.test("lembrete monta com suas três variáveis", () => {
  const r = montaTemplate("lembrete_compromisso", TEL, {
    destinatario: "Ana",
    compromisso: "Alinhamento Comercial",
    hora: "14h",
  });
  if (!r.ok) throw new Error(`esperava sucesso: ${r.motivo}`);
  assertEquals(r.payload.template.components[0].parameters.length, 3);
});

// ─── variáveis: as regras da Meta ───────────────────────────────────────────

Deno.test("quebra de linha na variável é barrada ANTES do envio", () => {
  const r = montaTemplate("confirmacao_compromisso", TEL, {
    ...CONF,
    compromisso: "Alinhamento\nComercial",
  });
  assertEquals(r.ok, false);
});

Deno.test("tab e espaçamento longo também são barrados", () => {
  assertEquals(montaTemplate("confirmacao_compromisso", TEL, { ...CONF, dia: "a\tmanhã" }).ok, false);
  assertEquals(
    montaTemplate("confirmacao_compromisso", TEL, { ...CONF, compromisso: "A     B" }).ok,
    false,
  );
});

Deno.test("variável vazia ou só espaço é barrada", () => {
  assertEquals(montaTemplate("confirmacao_compromisso", TEL, { ...CONF, hora: "" }).ok, false);
  assertEquals(montaTemplate("confirmacao_compromisso", TEL, { ...CONF, hora: "   " }).ok, false);
});

Deno.test("variável no teto passa, acima não", () => {
  const noTeto = { ...CONF, compromisso: "a".repeat(MAX_VARIAVEL) };
  const acima = { ...CONF, compromisso: "a".repeat(MAX_VARIAVEL + 1) };
  assertEquals(montaTemplate("confirmacao_compromisso", TEL, noTeto).ok, true);
  assertEquals(montaTemplate("confirmacao_compromisso", TEL, acima).ok, false);
});

Deno.test("variável faltando é recusada", () => {
  const { hora: _, ...semHora } = CONF;
  assertEquals(montaTemplate("confirmacao_compromisso", TEL, semHora).ok, false);
});

Deno.test("variável a mais é recusada", () => {
  // Sinal de que o template mudou na Meta e o código não acompanhou.
  const r = montaTemplate("confirmacao_compromisso", TEL, { ...CONF, valor: "R$ 400" });
  assertEquals(r.ok, false);
});

// ─── telefone e segurança ───────────────────────────────────────────────────

Deno.test("telefone fora de E.164 brasileiro é recusado", () => {
  for (const t of ["11988887777", "+5511988887777", "5511", "", "551198888777a"]) {
    assertEquals(montaTemplate("confirmacao_compromisso", t, CONF).ok, false, `passou: ${t}`);
  }
});

Deno.test("motivo de erro não vaza telefone nem conteúdo", () => {
  // DDD começando em 0 quebra o `[1-9]` do padrão. A validação de DDD REAL é do
  // telefone.ts — aqui só se checa formato, e confundir os dois foi o que fez
  // este teste passar telefone válido achando que era inválido.
  const r = montaTemplate("confirmacao_compromisso", "5500988887777", CONF);
  if (r.ok) throw new Error("deveria falhar");
  for (const t of ["8888", "777", "Ana", "Daniel"]) {
    if (r.motivo.includes(t)) throw new Error(`motivo vazou "${t}"`);
  }
});

Deno.test("conteúdo de variável não escapa pra estrutura do payload", () => {
  // Texto hostil vindo de título de evento (que vem da agenda, não de nós).
  const r = montaTemplate("confirmacao_compromisso", TEL, {
    ...CONF,
    compromisso: '"}],"template":{"name":"outro',
  });
  if (!r.ok) throw new Error("esperava sucesso — aspas são texto legítimo");
  // Continua sendo UM parâmetro de texto, não estrutura nova.
  assertEquals(r.payload.template.components.length, 1);
  assertEquals(r.payload.template.components[0].parameters.length, 5);
  assertEquals(r.payload.template.name, "confirmacao_compromisso");
});
