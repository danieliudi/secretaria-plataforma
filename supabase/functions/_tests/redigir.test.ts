// Testes da orquestração de "redigir, não enviar".
// Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque os dois modos de falha aqui são caros e mudos:
//
// 1. VAZAMENTO ENTRE TENANTS — contato é lista de telefone de terceiro. Uma
//    consulta que esqueça `tenant_id` devolve o contato de OUTRO cliente e o
//    usuário manda a mensagem dele pra um desconhecido. O fake abaixo explode
//    se a tool consultar sem tenant.
//
// 2. CHUTE DE TELEFONE — quando o contato não existe, a única resposta correta
//    é pedir o número. Qualquer heurística ("pega o contato mais parecido")
//    manda a mensagem pra pessoa errada, e ninguém fica sabendo.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ContatoRow,
  montarLinkParaContato,
  type RedigirDeps,
} from "../fast/tools/redigir.ts";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

type Salvo = { tenantId: string; nome: string; telefone_e164: string; email?: string };

/**
 * Agenda falsa com isolamento REAL por tenant: guarda por (tenant, nome) e só
 * devolve o que pertence ao tenant consultado. Se a tool passar o tenant errado
 * — ou não passar —, o teste falha por não achar o contato.
 */
function fakeDeps(inicial: Array<{ tenantId: string; contato: ContatoRow }> = []) {
  const agenda = new Map<string, ContatoRow>();
  for (const { tenantId, contato } of inicial) {
    agenda.set(`${tenantId}::${contato.nome.toLowerCase()}`, contato);
  }
  const salvos: Salvo[] = [];

  const deps: RedigirDeps = {
    buscaContatoPorNome(tenantId, nome) {
      if (!tenantId) throw new Error("busca sem tenant_id");
      return Promise.resolve(agenda.get(`${tenantId}::${nome.trim().toLowerCase()}`) ?? null);
    },
    salvaContato(tenantId, _userId, dados) {
      if (!tenantId) throw new Error("gravação sem tenant_id");
      salvos.push({ tenantId, ...dados });
      agenda.set(`${tenantId}::${dados.nome.toLowerCase()}`, {
        id: "novo",
        nome: dados.nome,
        telefone_e164: dados.telefone_e164,
        email: dados.email ?? null,
      });
      return Promise.resolve();
    },
  };
  return { deps, salvos };
}

const ANA: ContatoRow = {
  id: "c1",
  nome: "Ana",
  telefone_e164: "5511988887777",
  email: "ana@exemplo.com.br",
};

// ─── caminho feliz ──────────────────────────────────────────────────────────

Deno.test("usa o telefone da agenda quando o usuário não informa", async () => {
  const { deps } = fakeDeps([{ tenantId: TENANT_A, contato: ANA }]);
  const r = await montarLinkParaContato(
    TENANT_A,
    null,
    { nome: "Ana", texto: "Confirmando amanhã 14h." },
    deps,
  );
  if (!r.ok) throw new Error(`esperava sucesso: ${r.motivo}`);
  assertStringIncludes(r.url, "wa.me/5511988887777");
  assertEquals(r.contato_novo, false);
});

Deno.test("busca por nome ignora caixa e espaço", async () => {
  const { deps } = fakeDeps([{ tenantId: TENANT_A, contato: ANA }]);
  const r = await montarLinkParaContato(
    TENANT_A,
    null,
    { nome: "  ANA  ", texto: "Oi" },
    deps,
  );
  assertEquals(r.ok, true);
});

Deno.test("telefone informado é normalizado e guardado", async () => {
  const { deps, salvos } = fakeDeps();
  const r = await montarLinkParaContato(
    TENANT_A,
    "tg:123",
    { nome: "Bruno", telefone: "(11) 3333-4444", texto: "Confirmando." },
    deps,
  );
  if (!r.ok) throw new Error(`esperava sucesso: ${r.motivo}`);
  assertStringIncludes(r.url, "wa.me/551133334444");
  assertEquals(r.contato_novo, true);
  assertEquals(salvos.length, 1);
  // Guarda em E.164, nunca o que o usuário digitou.
  assertEquals(salvos[0].telefone_e164, "551133334444");
  assertEquals(salvos[0].tenantId, TENANT_A);
});

Deno.test("contato conhecido com o mesmo número não é anunciado como novo", async () => {
  const { deps } = fakeDeps([{ tenantId: TENANT_A, contato: ANA }]);
  const r = await montarLinkParaContato(
    TENANT_A,
    null,
    { nome: "Ana", telefone: "11988887777", texto: "Oi" },
    deps,
  );
  if (!r.ok) throw new Error("esperava sucesso");
  assertEquals(r.contato_novo, false);
});

// ─── isolamento entre tenants ───────────────────────────────────────────────

Deno.test("NÃO enxerga contato de outro tenant", async () => {
  // A Ana está cadastrada no tenant A. O tenant B pede "manda pra Ana".
  // Se vazasse, o usuário de B mandaria a mensagem dele pro telefone de um
  // terceiro que ele nunca viu.
  const { deps } = fakeDeps([{ tenantId: TENANT_A, contato: ANA }]);
  const r = await montarLinkParaContato(
    TENANT_B,
    null,
    { nome: "Ana", texto: "Confirmando amanhã 14h." },
    deps,
  );
  assertEquals(r.ok, false);
  if (!r.ok) assertStringIncludes(r.motivo, "Não tenho o WhatsApp");
});

Deno.test("contato salvo por um tenant não aparece pro outro", async () => {
  const { deps } = fakeDeps();
  await montarLinkParaContato(
    TENANT_A,
    null,
    { nome: "Carla", telefone: "11987654321", texto: "Oi" },
    deps,
  );
  const r = await montarLinkParaContato(TENANT_B, null, { nome: "Carla", texto: "Oi" }, deps);
  assertEquals(r.ok, false);
});

// ─── recusas ────────────────────────────────────────────────────────────────

Deno.test("sem contato e sem telefone, PEDE o número em vez de chutar", async () => {
  const { deps } = fakeDeps([{ tenantId: TENANT_A, contato: ANA }]);
  const r = await montarLinkParaContato(
    TENANT_A,
    null,
    { nome: "Roberto", texto: "Confirmando." },
    deps,
  );
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertStringIncludes(r.motivo, "Roberto");
    assertStringIncludes(r.motivo, "número");
  }
});

Deno.test("telefone inválido não vira contato gravado", async () => {
  const { deps, salvos } = fakeDeps();
  const r = await montarLinkParaContato(
    TENANT_A,
    null,
    { nome: "Diego", telefone: "(10) 98888-7777", texto: "Oi" },
    deps,
  );
  assertEquals(r.ok, false);
  // Nada foi persistido: DDD inválido barra antes da gravação.
  assertEquals(salvos.length, 0);
});

Deno.test("nome vazio é recusado", async () => {
  const { deps } = fakeDeps();
  const r = await montarLinkParaContato(TENANT_A, null, { nome: "   ", texto: "Oi" }, deps);
  assertEquals(r.ok, false);
});

Deno.test("texto vazio é recusado mesmo com contato conhecido", async () => {
  const { deps } = fakeDeps([{ tenantId: TENANT_A, contato: ANA }]);
  const r = await montarLinkParaContato(TENANT_A, null, { nome: "Ana", texto: "" }, deps);
  assertEquals(r.ok, false);
});

Deno.test("nome absurdamente longo é recusado antes de consultar o banco", async () => {
  let consultou = false;
  const deps: RedigirDeps = {
    buscaContatoPorNome() {
      consultou = true;
      return Promise.resolve(null);
    },
    salvaContato() {
      return Promise.resolve();
    },
  };
  const r = await montarLinkParaContato(
    TENANT_A,
    null,
    { nome: "a".repeat(500), texto: "Oi" },
    deps,
  );
  assertEquals(r.ok, false);
  assertEquals(consultou, false);
});

// ─── segurança ──────────────────────────────────────────────────────────────

Deno.test("motivo de erro não vaza telefone", async () => {
  const { deps } = fakeDeps();
  const r = await montarLinkParaContato(
    TENANT_A,
    null,
    { nome: "Elis", telefone: "(10) 98888-7777", texto: "Oi" },
    deps,
  );
  if (r.ok) throw new Error("deveria falhar");
  for (const trecho of ["8888", "7777"]) {
    if (r.motivo.includes(trecho)) throw new Error(`motivo vazou "${trecho}"`);
  }
});

Deno.test("texto da mensagem não escapa da query string do link", async () => {
  const { deps } = fakeDeps([{ tenantId: TENANT_A, contato: ANA }]);
  const texto = "confirma?&text=outro&x=https://evil.example/";
  const r = await montarLinkParaContato(TENANT_A, null, { nome: "Ana", texto }, deps);
  if (!r.ok) throw new Error("esperava sucesso");
  const u = new URL(r.url);
  assertEquals(u.host, "wa.me");
  assertEquals([...u.searchParams.keys()], ["text"]);
  assertEquals(u.searchParams.get("text"), texto);
});
