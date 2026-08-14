// Testes da decisão de envio. Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque este módulo é o único lugar do sistema autorizado a dizer
// "pode mandar mensagem pra um terceiro". Todo caminho que devolve `envio`
// precisa ter passado por quatro perguntas, e a regressão perigosa não é uma
// que quebra — é uma que faz o `envio` sair mais fácil do que deveria.
//
// A parte mais importante é a de FALHA: se a consulta de opt-out cair, o
// resultado tem que ser `link`. Um envio que não pôde ser verificado é um
// envio que não deve acontecer, e "banco fora do ar" não é justificativa pra
// contatar quem pediu pra sair.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type DecisaoDeps, decideEnvio, type PedidoDeEnvio } from "../_shared/envio-decisao.ts";

const TENANT = "11111111-1111-1111-1111-111111111111";

function pedido(over: Partial<PedidoDeEnvio> = {}): PedidoDeEnvio {
  return {
    tenantId: TENANT,
    tenantLigouEnvio: true,
    telefoneE164: "5511988887777",
    template: "confirmacao_compromisso",
    variaveis: {
      destinatario: "Ana",
      remetente: "Daniel",
      compromisso: "Alinhamento Comercial",
      dia: "amanhã",
      hora: "14h",
    },
    origemContato: "participante_evento",
    eventoId: "ev-123",
    ...over,
  };
}

function deps(over: Partial<DecisaoDeps> = {}): DecisaoDeps {
  return {
    estaForaDaLista: () => Promise.resolve(false),
    jaEnviou: () => Promise.resolve(false),
    temCredencial: () => true,
    ...over,
  };
}

// ─── o único caminho que envia ──────────────────────────────────────────────

Deno.test("com tudo em ordem, envia", () => {
  return decideEnvio(pedido(), deps()).then((d) => {
    assertEquals(d.via, "envio");
    if (d.via === "envio") {
      assertEquals(d.payload.template.name, "confirmacao_compromisso");
      assertStringIncludes(d.previa, "Responda SAIR");
    }
  });
});

// ─── as quatro perguntas, uma a uma ─────────────────────────────────────────

Deno.test("tenant com envio desligado cai no link", async () => {
  const d = await decideEnvio(pedido({ tenantLigouEnvio: false }), deps());
  assertEquals(d.via, "link");
});

Deno.test("sem credencial da Meta cai no link", async () => {
  // O estado de hoje: código no ar, nada configurado. Precisa ser inofensivo.
  const d = await decideEnvio(pedido(), deps({ temCredencial: () => false }));
  assertEquals(d.via, "link");
});

Deno.test("template desconhecido cai no link, nunca em envio", async () => {
  const d = await decideEnvio(pedido({ template: "cobranca_orcamento" }), deps());
  assertEquals(d.via, "link");
});

Deno.test("quem pediu pra sair nunca recebe", async () => {
  const d = await decideEnvio(pedido(), deps({ estaForaDaLista: () => Promise.resolve(true) }));
  assertEquals(d.via, "link");
  if (d.via === "link") assertStringIncludes(d.motivo, "pediu pra não receber");
});

Deno.test("aviso repetido é PULADO, não vira link", async () => {
  // Oferecer link pro que já foi enviado faria o usuário mandar de novo — o
  // destinatário receberia duas vezes por caminhos diferentes.
  const d = await decideEnvio(pedido(), deps({ jaEnviou: () => Promise.resolve(true) }));
  assertEquals(d.via, "pular");
});

// ─── falha de infraestrutura: precisa fechar, não abrir ─────────────────────

Deno.test("erro ao consultar opt-out vira link, JAMAIS envio", async () => {
  // O teste que mais importa do arquivo. Banco fora do ar não é justificativa
  // pra contatar quem pediu pra sair.
  const d = await decideEnvio(
    pedido(),
    deps({ estaForaDaLista: () => Promise.reject(new Error("timeout")) }),
  );
  assertEquals(d.via, "link");
  if (d.via === "link") assertStringIncludes(d.motivo, "lista de saída");
});

Deno.test("erro ao consultar histórico vira link, não envio", async () => {
  const d = await decideEnvio(
    pedido(),
    deps({ jaEnviou: () => Promise.reject(new Error("timeout")) }),
  );
  assertEquals(d.via, "link");
});

Deno.test("nenhuma falha de dependência propaga exceção", async () => {
  // O chamador é o cron e o /fast. Exceção aqui derrubaria o resumo da manhã
  // inteiro por causa de um convidado.
  const quebrado = deps({
    estaForaDaLista: () => Promise.reject(new Error("x")),
    jaEnviou: () => Promise.reject(new Error("y")),
  });
  const d = await decideEnvio(pedido(), quebrado);
  assertEquals(d.via, "link");
});

// ─── ordem das perguntas ────────────────────────────────────────────────────

Deno.test("tenant desligado não consulta o banco", async () => {
  // Sem isto, cada mensagem de cada tenant desligado geraria duas consultas
  // inúteis — e, pior, tocaria a lista de saída de gente que não íamos contatar.
  let tocou = false;
  const d = await decideEnvio(pedido({ tenantLigouEnvio: false }), deps({
    estaForaDaLista: () => {
      tocou = true;
      return Promise.resolve(false);
    },
    jaEnviou: () => {
      tocou = true;
      return Promise.resolve(false);
    },
  }));
  assertEquals(d.via, "link");
  assertEquals(tocou, false);
});

Deno.test("template inválido não consulta o banco", async () => {
  let tocou = false;
  await decideEnvio(pedido({ template: "inexistente" }), deps({
    estaForaDaLista: () => {
      tocou = true;
      return Promise.resolve(false);
    },
  }));
  assertEquals(tocou, false);
});

Deno.test("opt-out é checado ANTES do histórico", async () => {
  // Quem saiu não deve nem aparecer numa consulta de histórico de envio.
  const ordem: string[] = [];
  await decideEnvio(pedido(), deps({
    estaForaDaLista: () => {
      ordem.push("optout");
      return Promise.resolve(true);
    },
    jaEnviou: () => {
      ordem.push("historico");
      return Promise.resolve(false);
    },
  }));
  assertEquals(ordem, ["optout"]);
});

// ─── dados que chegam à consulta ────────────────────────────────────────────

Deno.test("a consulta de opt-out recebe o telefone, sem tenant", async () => {
  // Opt-out é global. Se um dia a assinatura ganhar tenantId, o isolamento
  // volta e a pessoa precisa pedir saída de novo pra cada cliente nosso.
  let visto = "";
  await decideEnvio(pedido(), deps({
    estaForaDaLista: (tel) => {
      visto = tel;
      return Promise.resolve(false);
    },
  }));
  assertEquals(visto, "5511988887777");
});

Deno.test("a checagem de repetição amarra tenant, telefone, template e evento", async () => {
  const visto: string[] = [];
  await decideEnvio(pedido(), deps({
    jaEnviou: (t, tel, tpl, ev) => {
      visto.push(t, tel, tpl, ev ?? "");
      return Promise.resolve(false);
    },
  }));
  assertEquals(visto, [TENANT, "5511988887777", "confirmacao_compromisso", "ev-123"]);
});

Deno.test("variável inválida impede o envio mesmo com tudo ligado", async () => {
  const d = await decideEnvio(
    pedido({ variaveis: { destinatario: "Ana", remetente: "Daniel", compromisso: "A\nB", dia: "amanhã", hora: "14h" } }),
    deps(),
  );
  assertEquals(d.via, "link");
});
