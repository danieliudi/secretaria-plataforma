// "Cancelado 👍" sobre um evento que continuou na agenda (31/08/2026).
//
// A causa não foi o modelo inventar: `deleteEvent` devolvia `void`, o
// executeTool traduzia em `{ ok: true }`, e "ok" era tudo que ele tinha pra ir.
// Um resultado que afirma sucesso sem ter olhado é pior que um erro — o usuário
// confia e só descobre dias depois.
//
// Estes testes travam a propriedade nova: sucesso só é devolvido quando a
// agenda CONFIRMA que o evento sumiu.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deleteEvent } from "../fast/tools/calendar-write.ts";

const ID = "abc123_20260902T120000Z";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `getRespostas` recebe (metodo, nEsimaChamada) e devolve a resposta. Guarda
 * as chamadas pra inspeção.
 */
function deps(handler: (metodo: string, n: number) => Response) {
  const chamadas: string[] = [];
  return {
    chamadas,
    deps: {
      getAccessToken: () => Promise.resolve("token-de-teste"),
      fetch: (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const metodo = init?.method ?? "GET";
        chamadas.push(metodo);
        return Promise.resolve(handler(metodo, chamadas.length));
      },
    },
  };
}

Deno.test("apagou de verdade: devolve o título que sumiu", async () => {
  const { chamadas, deps: d } = deps((metodo, n) => {
    if (metodo === "DELETE") return new Response(null, { status: 204 });
    // 1ª leitura: o evento existe. 2ª (verificação): já era.
    return n === 1
      ? json({ summary: "Resibag · Alinhamento diário" })
      : json({ error: "not found" }, 404);
  });

  // deno-lint-ignore no-explicit-any
  const r = await deleteEvent(ID, d as any);
  assertEquals(r.titulo, "Resibag · Alinhamento diário");
  assertEquals(r.id, ID);
  // Leitura, DELETE, leitura de verificação.
  assertEquals(chamadas, ["GET", "DELETE", "GET"]);
});

Deno.test("o BUG: Google aceita o DELETE mas o evento continua lá → erro, não sucesso", async () => {
  const { deps: d } = deps((metodo) => {
    if (metodo === "DELETE") return new Response(null, { status: 204 });
    // Nas DUAS leituras o evento existe: nada sumiu.
    return json({ summary: "Resibag · Alinhamento diário" });
  });

  await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => deleteEvent(ID, d as any),
    Error,
    "continua na agenda",
  );
});

Deno.test("ocorrência cancelada de série conta como sumida", async () => {
  const { deps: d } = deps((metodo, n) => {
    if (metodo === "DELETE") return new Response(null, { status: 204 });
    // O Google mantém a ocorrência legível, com status "cancelled".
    return n === 1
      ? json({ summary: "Alinhamento", status: "confirmed" })
      : json({ summary: "Alinhamento", status: "cancelled" });
  });

  // deno-lint-ignore no-explicit-any
  const r = await deleteEvent(ID, d as any);
  assertEquals(r.titulo, "Alinhamento");
});

Deno.test("evento que já não existia: titulo null, sem erro", async () => {
  const { deps: d } = deps((metodo) => {
    if (metodo === "DELETE") return new Response(null, { status: 410 });
    return json({ error: "gone" }, 410);
  });

  // deno-lint-ignore no-explicit-any
  const r = await deleteEvent(ID, d as any);
  assertEquals(r.titulo, null);
});

Deno.test("falha de verdade do Google sobe como erro", async () => {
  const { deps: d } = deps((metodo) => {
    if (metodo === "DELETE") return json({ error: "boom" }, 500);
    return json({ summary: "Alinhamento" });
  });

  await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => deleteEvent(ID, d as any),
    Error,
    "Calendar delete failed: 500",
  );
});

Deno.test("403 (sem permissão) não vira sucesso silencioso", async () => {
  const { deps: d } = deps((metodo) => {
    if (metodo === "DELETE") return json({ error: "forbidden" }, 403);
    return json({ summary: "Alinhamento" });
  });

  await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => deleteEvent(ID, d as any),
    Error,
    "403",
  );
});
