import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { criarLote, MAX_ITENS_LOTE } from "../fast/tools/lote.ts";
import type { CreateTaskInput, TaskItem } from "../_shared/task-provider.ts";

function deps(opts: { falharEm?: string } = {}) {
  const criadas: CreateTaskInput[] = [];
  const notas: string[] = [];
  return {
    criadas,
    notas,
    createTask: (input: CreateTaskInput): Promise<TaskItem> => {
      if (opts.falharEm && input.title.includes(opts.falharEm)) {
        return Promise.reject(new Error("frente não existe no gerenciador"));
      }
      criadas.push(input);
      return Promise.resolve({
        id: "1", name: input.title, status: "aberta", due_date: input.due_date ?? null,
        url: "https://app.exemplo/1",
      });
    },
    saveQuickCapture: (n: { text: string }) => {
      notas.push(n.text);
      return Promise.resolve({});
    },
  };
}

const AMANHA = "2026-09-01T09:00:00-03:00";

Deno.test("item com frente e data vira tarefa", async () => {
  const d = deps();
  const r = await criarLote({ itens: [{ titulo: "Mandar a proposta", frente: "sanwey", due_date: AMANHA }] }, d);
  assertEquals(r.criadas.length, 1);
  assertEquals(r.anotadas.length, 0);
  assertEquals(d.criadas[0].title, "Mandar a proposta");
});

// A regra central da feature: prazo inventado é pior que nenhum, porque some
// no meio das tarefas reais e envenena o aviso de atrasadas.
Deno.test("item SEM data vai pro inbox, não vira tarefa com prazo inventado", async () => {
  const d = deps();
  const r = await criarLote({ itens: [{ titulo: "Ideia do banho: post sobre o IBAMA", frente: "resibag" }] }, d);
  assertEquals(r.criadas.length, 0);
  assertEquals(r.anotadas.map((a) => a.texto), ["Ideia do banho: post sobre o IBAMA"]);
  assertEquals(d.criadas.length, 0);
});

Deno.test("item sem frente vai pro inbox mesmo tendo data", async () => {
  const d = deps();
  const r = await criarLote({ itens: [{ titulo: "Coisa solta", due_date: AMANHA }] }, d);
  assertEquals(r.anotadas.length, 1);
  assertEquals(d.criadas.length, 0);
});

// Best-effort por item: a pessoa já falou tudo uma vez e não vai falar de novo.
Deno.test("um item falhando não derruba os outros", async () => {
  const d = deps({ falharEm: "quebrada" });
  const r = await criarLote({
    itens: [
      { titulo: "Primeira", frente: "sanwey", due_date: AMANHA },
      { titulo: "A quebrada", frente: "inexistente", due_date: AMANHA },
      { titulo: "Terceira", frente: "resibag", due_date: AMANHA },
    ],
  }, d);
  assertEquals(r.criadas.map((c) => c.titulo), ["Primeira", "Terceira"]);
  assertEquals(r.falharam.length, 1);
  assertEquals(r.falharam[0].titulo, "A quebrada");
});

Deno.test("motivo da falha não vaza URL", async () => {
  const d = {
    createTask: () => Promise.reject(new Error("POST https://api.clickup.com/v2/list/999/task deu 401")),
    saveQuickCapture: () => Promise.resolve({}),
  };
  const r = await criarLote({ itens: [{ titulo: "X", frente: "a", due_date: AMANHA }] }, d);
  assertEquals(r.falharam[0].motivo.includes("clickup.com"), false);
  assertEquals(r.falharam[0].motivo.includes("[url]"), true);
});

Deno.test("lote acima do teto é cortado e avisa", async () => {
  const d = deps();
  const itens = Array.from({ length: MAX_ITENS_LOTE + 5 }, (_, i) => ({
    titulo: `Item ${i}`, frente: "sanwey", due_date: AMANHA,
  }));
  const r = await criarLote({ itens }, d);
  assertEquals(r.criadas.length, MAX_ITENS_LOTE);
  assertEquals(r.truncado, true);
});

Deno.test("dentro do teto não marca truncado", async () => {
  const r = await criarLote({ itens: [{ titulo: "Só uma", frente: "a", due_date: AMANHA }] }, deps());
  assertEquals(r.truncado, false);
});

Deno.test("título vazio é ignorado, não vira nota em branco", async () => {
  const d = deps();
  const r = await criarLote({ itens: [{ titulo: "   " }, { titulo: "" }] }, d);
  assertEquals(r.criadas.length + r.anotadas.length + r.falharam.length, 0);
  assertEquals(d.notas.length, 0);
});

Deno.test("lista vazia ou ausente não quebra", async () => {
  assertEquals((await criarLote({ itens: [] }, deps())).criadas.length, 0);
  // deno-lint-ignore no-explicit-any
  assertEquals((await criarLote({} as any, deps())).anotadas.length, 0);
});

Deno.test("título gigante é cortado sem partir emoji ao meio", async () => {
  const d = deps();
  await criarLote({ itens: [{ titulo: "x".repeat(400) + "😀", frente: "a", due_date: AMANHA }] }, d);
  const titulo = d.criadas[0].title;
  assertEquals(titulo.length <= 200, true);
  // Se tivesse cortado no meio do par substituto, isto seria um caractere solto.
  assertEquals(titulo.endsWith("\uD83D"), false);
});
