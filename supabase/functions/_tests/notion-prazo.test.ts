// Criar tarefa no Notion quando o database NÃO tem coluna de data.
//
// O caso, 04/09/2026: a Erika pediu "Procurar bolo para hj às 8:30". A tarefa
// nasceu no Notion só com o título — nenhuma propriedade — e a Mia respondeu
// "Criado! A tarefa tá no Notion — 'Procurar bolo', prazo hoje 8h30".
//
// Duas falhas empilhadas, e estes testes travam as duas:
//   1. o provider descartava o prazo em silêncio quando não havia coluna de
//      data (o `rescheduleTask`, no mesmo arquivo, já recusava alto);
//   2. a confirmação repetia de volta a data que o usuário tinha acabado de
//      pedir, em vez de ler o que a escrita devolveu.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createNotionProvider } from "../_shared/providers/notion-provider.ts";

// Cada teste usa um databaseId próprio: o provider cacheia schema e
// data_source_id por database, em variáveis de módulo. Reaproveitar o mesmo id
// faria o segundo teste ler o schema do primeiro — e passar por acidente.
const envDe = (db: string) => (k: string) =>
  ({ NOTION_API_TOKEN: "t", NOTION_DATABASE_MAP: JSON.stringify({ pessoal: db }) } as Record<string, string>)[k];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Um Notion falso cujo database tem só a coluna de título — o caso da Erika. */
function notionFalso(comColunaDeData: boolean) {
  const escritas: Array<{ url: string; body: string }> = [];
  const props: Record<string, unknown> = { Nome: { type: "title" } };
  if (comColunaDeData) props["Prazo"] = { type: "date" };

  const fetchFalso = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST" && u.endsWith("/pages")) {
      escritas.push({ url: u, body: String(init.body) });
      const enviado = JSON.parse(String(init.body));
      return Promise.resolve(json({
        id: "pg1",
        url: "https://notion.so/pg1",
        properties: {
          Nome: { type: "title", title: [{ plain_text: "Procurar bolo" }] },
          ...(comColunaDeData
            ? { Prazo: { type: "date", date: enviado.properties?.Prazo?.date ?? null } }
            : {}),
        },
      }));
    }
    if (u.includes("/data_sources/")) return Promise.resolve(json({ properties: props }));
    if (u.includes("/databases/")) return Promise.resolve(json({ data_sources: [{ id: "ds1" }] }));
    return Promise.resolve(new Response("não esperado: " + u, { status: 500 }));
  }) as typeof fetch;

  return { fetch: fetchFalso, escritas };
}

Deno.test("sem coluna de data: a tarefa é criada, e o prazo perdido é DITO", async () => {
  const { fetch: f } = notionFalso(false);
  const p = createNotionProvider({ env: envDe("db-sem-data-1"), fetch: f });
  const task = await p.createTask({ frente: "pessoal", title: "Procurar bolo", due_date: "2026-09-04" });

  assertEquals(task.name, "Procurar bolo");
  assertEquals(task.due_date, null, "inventou um prazo que o Notion não guardou");
  assert(task.avisoPrazo, "criou sem prazo e não avisou — é o bug de 04/09 de volta");
  assertStringIncludes(task.avisoPrazo!, "coluna de data");
});

Deno.test("sem coluna de data, a escrita não inventa propriedade nenhuma", async () => {
  // Criar a coluna por conta própria seria mexer no espaço do usuário sem
  // pedir — a decisão do arquivo é dizer, não consertar.
  const { fetch: f, escritas } = notionFalso(false);
  const p = createNotionProvider({ env: envDe("db-sem-data-2"), fetch: f });
  await p.createTask({ frente: "pessoal", title: "Procurar bolo", due_date: "2026-09-04" });

  const corpo = JSON.parse(escritas[0].body);
  assertEquals(Object.keys(corpo.properties), ["Nome"]);
});

Deno.test("com coluna de data: grava o prazo e não avisa nada", async () => {
  const { fetch: f, escritas } = notionFalso(true);
  const p = createNotionProvider({ env: envDe("db-com-data"), fetch: f });
  const task = await p.createTask({ frente: "pessoal", title: "Procurar bolo", due_date: "2026-09-04" });

  assertEquals(task.due_date, "2026-09-04");
  assertEquals(task.avisoPrazo, undefined, "avisou de um problema que não existe");
  assertStringIncludes(escritas[0].body, '"Prazo"');
});

Deno.test("tarefa sem prazo pedido não gera aviso", async () => {
  const { fetch: f } = notionFalso(false);
  const p = createNotionProvider({ env: envDe("db-sem-data-3"), fetch: f });
  const task = await p.createTask({ frente: "pessoal", title: "Procurar bolo" });
  assertEquals(task.avisoPrazo, undefined);
});
