import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  montaMensagemFimDoDia,
  RECAP_DIA_LIMPO,
  RECAP_MAX_ITENS,
} from "../_shared/fim-do-dia.ts";

const T = (name: string, frente = "resibag", list?: string) => ({ name, frente, list });

Deno.test("dia sem nada devolve o texto de dia limpo, não silêncio", () => {
  assertEquals(montaMensagemFimDoDia([], []), RECAP_DIA_LIMPO);
});

Deno.test("termina em pergunta — é o que faz o usuário responder", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar o retorno da Locaweb")], []);
  assertStringIncludes(msg, "O que andou?");
});

Deno.test("conta tarefas e compromissos juntos", () => {
  const msg = montaMensagemFimDoDia(
    [T("Mandar a proposta revisada"), T("Cobrar o retorno da Locaweb")],
    [{ titulo: "Call com o Takahiro", hora: "15:00" }],
  );
  assertStringIncludes(msg, "Tinha 3 coisas hoje");
  assertStringIncludes(msg, "☐ Call com o Takahiro, 15:00");
});

Deno.test("singular quando é uma coisa só", () => {
  const msg = montaMensagemFimDoDia([T("Renovar o certificado digital")], []);
  assertStringIncludes(msg, "Tinha 1 coisa hoje");
  assert(!msg.includes("1 coisas"));
});

Deno.test("uma frente só: nenhum rótulo de frente polui a lista", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb"), T("Renovar o certificado")], []);
  assert(!msg.includes("resibag"), msg);
});

Deno.test("várias frentes: cada linha diz de qual frente é", () => {
  const msg = montaMensagemFimDoDia(
    [T("Cobrar a Locaweb", "resibag"), T("Fechar o orçamento", "sanwey", "Pauta")],
    [],
  );
  assertStringIncludes(msg, "☐ Cobrar a Locaweb · resibag");
  assertStringIncludes(msg, "☐ Fechar o orçamento · sanwey/Pauta");
});

Deno.test("acima do teto corta e diz que cortou", () => {
  const muitas = Array.from({ length: RECAP_MAX_ITENS + 4 }, (_, i) => T(`Tarefa ${i + 1}`));
  const msg = montaMensagemFimDoDia(muitas, []);

  const linhas = msg.split("\n").filter((l) => l.startsWith("☐"));
  assertEquals(linhas.length, RECAP_MAX_ITENS);
  assertStringIncludes(msg, `Tinha ${RECAP_MAX_ITENS + 4} coisas hoje`);
  assertStringIncludes(msg, `(mostrei ${RECAP_MAX_ITENS} de ${RECAP_MAX_ITENS + 4})`);
});

Deno.test("no teto exato não aparece rodapé de corte", () => {
  const exatas = Array.from({ length: RECAP_MAX_ITENS }, (_, i) => T(`Tarefa ${i + 1}`));
  const msg = montaMensagemFimDoDia(exatas, []);
  assert(!msg.includes("mostrei"), msg);
});

Deno.test("não cobra, não julga, não vira coach", () => {
  const msg = montaMensagemFimDoDia([T("Cobrar a Locaweb")], []);
  for (const proibido of ["por que", "por quê", "você consegue", "atrasad", "pendênc", "!"]) {
    assert(!msg.toLowerCase().includes(proibido), `mensagem tem "${proibido}": ${msg}`);
  }
});
