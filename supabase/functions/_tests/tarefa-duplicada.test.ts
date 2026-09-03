import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { achaTarefasParecidas, normalizaTitulo, type TarefaExistente } from "../_shared/tarefa-duplicada.ts";

const t = (name: string, status = "a_fazer"): TarefaExistente => ({ name, status });

// ── O caso real de 02/09 ────────────────────────────────────────────────────

Deno.test("02/09: o reenvio da mesma mensagem não vira segunda tarefa", () => {
  const jaExiste = [t("Mandar pesquisa de satisfação pra clientes")];
  const parecidas = achaTarefasParecidas("Mandar pesquisa de satisfação pra clientes", jaExiste);
  assertEquals(parecidas.length, 1);
});

// O pedido tinha cauda ("da Resibag e pesquisa, se possível") que o título
// gravado não tinha. Sem casar por trecho, isso passaria como tarefa nova.
Deno.test("título com cauda casa com o que já existe", () => {
  const jaExiste = [t("Mandar pesquisa de satisfação pra clientes")];
  const parecidas = achaTarefasParecidas(
    "Mandar pesquisa de satisfação pra clientes da Resibag e pesquisa, se possível",
    jaExiste,
  );
  assertEquals(parecidas.length, 1);
});

// ── Normalização ────────────────────────────────────────────────────────────

Deno.test("acento, caixa, pontuação e espaço sobrando não criam tarefa nova", () => {
  assertEquals(normalizaTitulo("  Mandar   PESQUISA de satisfação!  "), "mandar pesquisa de satisfacao");
  const parecidas = achaTarefasParecidas("mandar  pesquisa de SATISFACAO...", [t("Mandar pesquisa de satisfação")]);
  assertEquals(parecidas.length, 1);
});

// ── Onde a guarda tem que SAIR do caminho ───────────────────────────────────

Deno.test("tarefa já concluída não bloqueia — recorrente tem que poder voltar", () => {
  for (const status of ["concluido", "feito", "done", "Completed", "Fechado", "cancelado"]) {
    assertEquals(
      achaTarefasParecidas("Relatório semanal", [t("Relatório semanal", status)]).length,
      0,
      `status '${status}' bloqueou indevidamente`,
    );
  }
});

// Cada provider nomeia status do seu jeito. Status que a gente não conhece tem
// que contar como ABERTO — errar pro lado de perguntar é o lado certo.
Deno.test("status desconhecido conta como aberto", () => {
  assertEquals(achaTarefasParecidas("Relatório semanal", [t("Relatório semanal", "Em revisão")]).length, 1);
});

Deno.test("título diferente não casa", () => {
  assertEquals(achaTarefasParecidas("Ligar pro João", [t("Ligar pra Maria")]).length, 0);
});

// "Ligar" dentro de "Ligar pro João sobre o contrato" acusaria quase tudo.
Deno.test("trecho curto não casa por conter — só igualdade exata vale", () => {
  assertEquals(achaTarefasParecidas("Ligar", [t("Ligar pro João sobre o contrato")]).length, 0);
  assertEquals(achaTarefasParecidas("Ligar", [t("Ligar")]).length, 1);
});

Deno.test("título vazio ou só espaço nunca casa com nada", () => {
  assertEquals(achaTarefasParecidas("", [t("Qualquer coisa")]).length, 0);
  assertEquals(achaTarefasParecidas("   ", [t("Qualquer coisa")]).length, 0);
  assertEquals(achaTarefasParecidas("Qualquer coisa", [t("")]).length, 0);
});

Deno.test("lista vazia devolve vazio", () => {
  assertEquals(achaTarefasParecidas("Qualquer coisa", []).length, 0);
});

Deno.test("devolve TODAS as parecidas, não só a primeira", () => {
  const parecidas = achaTarefasParecidas("Mandar pesquisa", [
    t("Mandar pesquisa"),
    t("Mandar pesquisa"),
    t("Outra coisa"),
  ]);
  assertEquals(parecidas.length, 2);
});

Deno.test("prazo não entra no critério — mesmo nome aberto é duplicata em qualquer data", () => {
  const parecidas = achaTarefasParecidas("Fazer relatório da AGCO", [
    { name: "Fazer relatório da AGCO", status: "a_fazer", due_date: "2026-12-31" },
  ]);
  assert(parecidas.length === 1);
});
