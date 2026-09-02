// O formato da pergunta das 19h. Função pura, roda offline.
//
// Cada teste trava uma decisão tomada olhando o 01/09/2026, o dia em que a
// mensagem saiu como "Tinha 1 coisa hoje" num dia de seis. Sem teste, as duas
// regras que consertaram isso — atrasada é pendência, e fonte que falhou tem
// que aparecer — voltam a cair na primeira mexida.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  montaMensagemFimDoDia,
  RECAP_DIA_LIMPO,
  RECAP_MAX_ITENS,
} from "../_shared/fim-do-dia.ts";
import type { ItemAgenda, Pendencia } from "../_shared/blocos-do-dia.ts";

const P = (nome: string, frente = "resibag", atrasada = false, vence = "02/09"): Pendencia => ({
  nome,
  frente,
  vence,
  atrasada,
});
const C = (titulo: string, hora: string | null): ItemAgenda => ({ titulo, hora });

Deno.test("dia sem nada devolve o texto de dia limpo, não silêncio", () => {
  assertEquals(montaMensagemFimDoDia([], []), RECAP_DIA_LIMPO);
});

Deno.test("termina em pergunta — é o que faz o usuário responder", () => {
  const msg = montaMensagemFimDoDia([P("Cobrar o retorno da Locaweb")], []);
  assertStringIncludes(msg, "O que andou?");
});

Deno.test("conta pendências e compromissos juntos", () => {
  const msg = montaMensagemFimDoDia(
    [P("Mandar a proposta revisada"), P("Cobrar o retorno da Locaweb")],
    [C("Call com o Takahiro", "15:00")],
  );
  assertStringIncludes(msg, "Tinha 3 coisas hoje");
  assertStringIncludes(msg, "3. ☐ Call com o Takahiro, 15:00");
});

Deno.test("singular quando é uma coisa só", () => {
  const msg = montaMensagemFimDoDia([P("Renovar o certificado digital")], []);
  assertStringIncludes(msg, "Tinha 1 coisa hoje");
  assert(!msg.includes("1 coisas"));
});

Deno.test("a lista é numerada, e a numeração é o que o usuário responde", () => {
  // "fiz a 1 e a 3" só funciona se cada linha tiver um número estável.
  const msg = montaMensagemFimDoDia([P("Primeira"), P("Segunda"), P("Terceira")], []);
  assertStringIncludes(msg, "1. ☐ Primeira");
  assertStringIncludes(msg, "2. ☐ Segunda");
  assertStringIncludes(msg, "3. ☐ Terceira");
  assertStringIncludes(msg, '"fiz a 1 e a 3"');
});

Deno.test("atrasada entra na lista e diz que está atrasada", () => {
  // O ERRO DE 01/09: quatro tarefas atrasadas ficaram de fora porque não
  // venciam "exatamente hoje", e a mensagem afirmou um dia de uma coisa só.
  const msg = montaMensagemFimDoDia(
    [P("Finalizar plano de vendas", "Resibag", true, "31/08"), P("Enviar NF", "Resibag")],
    [],
  );
  assertStringIncludes(msg, "1. ☐ Finalizar plano de vendas (atrasada)");
  assertStringIncludes(msg, "2. ☐ Enviar NF");
  assertStringIncludes(msg, "Tinha 2 coisas hoje");
});

Deno.test("evento de dia inteiro aparece, e sem horário inventado", () => {
  const msg = montaMensagemFimDoDia([], [C("TROCAR FILTRO CHUVEIRO", null)]);
  assertStringIncludes(msg, "☐ TROCAR FILTRO CHUVEIRO, dia todo");
  assert(!msg.includes("00:00"), msg);
});

Deno.test("uma frente só: nenhum rótulo de frente polui a lista", () => {
  const msg = montaMensagemFimDoDia([P("Cobrar a Locaweb"), P("Renovar o certificado")], []);
  assert(!msg.includes("resibag"), msg);
});

Deno.test("várias frentes: cada linha diz de qual frente é", () => {
  const msg = montaMensagemFimDoDia(
    [P("Cobrar a Locaweb", "resibag"), P("Fechar o orçamento", "sanwey")],
    [],
  );
  assertStringIncludes(msg, "1. ☐ Cobrar a Locaweb · resibag");
  assertStringIncludes(msg, "2. ☐ Fechar o orçamento · sanwey");
});

Deno.test("acima do teto corta e diz que cortou", () => {
  const muitas = Array.from({ length: RECAP_MAX_ITENS + 4 }, (_, i) => P(`Tarefa ${i + 1}`));
  const msg = montaMensagemFimDoDia(muitas, []);

  const linhas = msg.split("\n").filter((l) => /^\d+\. ☐ /.test(l));
  assertEquals(linhas.length, RECAP_MAX_ITENS);
  assertStringIncludes(msg, `Tinha ${RECAP_MAX_ITENS + 4} coisas hoje`);
  assertStringIncludes(msg, `(mostrei ${RECAP_MAX_ITENS} de ${RECAP_MAX_ITENS + 4})`);
});

Deno.test("no teto exato não aparece rodapé de corte", () => {
  const exatas = Array.from({ length: RECAP_MAX_ITENS }, (_, i) => P(`Tarefa ${i + 1}`));
  const msg = montaMensagemFimDoDia(exatas, []);
  assert(!msg.includes("mostrei"), msg);
});

Deno.test("fonte que falhou aparece, e o total não é afirmado", () => {
  // Meia lista com cara de lista inteira é o mesmo erro de 01/09 com outra
  // causa: a pessoa lê um número e acredita nele.
  const msg = montaMensagemFimDoDia([P("Cobrar a Locaweb")], [], ["agenda"]);
  assertStringIncludes(msg, "a agenda não respondeu agora");
  assert(!msg.includes("Tinha 1 coisa"), msg);
});

Deno.test("nada lido + fonte falhando não vira dia limpo", () => {
  // Afirmar tranquilidade sobre um dia que ninguém conseguiu ler é a pior
  // versão do erro: soa exatamente igual ao caso bom.
  const msg = montaMensagemFimDoDia([], [], ["agenda", "lista de tarefas"]);
  assert(!msg.includes("Dia limpo"), msg);
  assertStringIncludes(msg, "a agenda e a lista de tarefas");
});

Deno.test("não cobra, não julga, não vira coach", () => {
  // "atrasada" continua PERMITIDO: é fato, e escondê-lo foi o que fez a
  // mensagem das 19h contradizer a das 06:00. O que segue proibido é o
  // comentário sobre a pessoa.
  const msg = montaMensagemFimDoDia([P("Cobrar a Locaweb", "resibag", true, "31/08")], []);
  for (const proibido of ["por que", "por quê", "você consegue", "não deu conta", "!"]) {
    assert(!msg.toLowerCase().includes(proibido), `mensagem tem "${proibido}": ${msg}`);
  }
});

Deno.test("o exemplo de resposta acompanha o tamanho da lista", () => {
  // "fiz a 1 e a 3" numa lista de um item só manda o usuário apontar pra uma
  // coisa que não existe — e lista curta é o normal de todo tenant novo.
  assertStringIncludes(montaMensagemFimDoDia([P("Só essa")], []), 'Só dizer "fiz"');
  assertStringIncludes(montaMensagemFimDoDia([P("Uma"), P("Duas")], []), '"fiz a 1" já resolve');
  assertStringIncludes(
    montaMensagemFimDoDia([P("Uma"), P("Duas"), P("Três")], []),
    '"fiz a 1 e a 3" já resolve',
  );
});
