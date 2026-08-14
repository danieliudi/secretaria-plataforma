// Testes da fronteira de confiança do webhook da Meta.
// Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque este é o único endpoint nosso que a internet aberta pode
// chamar sem credencial. Sem a verificação de assinatura, qualquer um forja
// "a Ana respondeu SAIR" e remove contatos alheios da lista de um tenant —
// ou forja respostas que a Yuka trata como reais.
//
// Os dois testes que mais importam são os que garantem que ausência de
// segredo NÃO vira modo aberto, e que assinatura errada NÃO passa. Os dois
// são a diferença entre um webhook e um endpoint público de escrita.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assinaturaValida,
  extraiMensagens,
  respostaDeVerificacao,
} from "../_shared/meta-webhook.ts";

const SEGREDO = "app-secret-de-teste";

/** Assina como a Meta assina, pra não testar contra a nossa própria conta. */
async function assina(corpo: string, segredo: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

// ─── assinatura ─────────────────────────────────────────────────────────────

Deno.test("assinatura correta passa", async () => {
  const corpo = '{"object":"whatsapp_business_account"}';
  assertEquals(await assinaturaValida(corpo, await assina(corpo, SEGREDO), SEGREDO), true);
});

Deno.test("SEM segredo configurado nada passa", async () => {
  // Tratar ausência de segredo como "modo aberto" transformaria uma
  // configuração incompleta num endpoint público de escrita.
  const corpo = "{}";
  assertEquals(await assinaturaValida(corpo, await assina(corpo, SEGREDO), undefined), false);
  assertEquals(await assinaturaValida(corpo, await assina(corpo, SEGREDO), ""), false);
});

Deno.test("assinatura de outro segredo não passa", async () => {
  const corpo = '{"a":1}';
  assertEquals(await assinaturaValida(corpo, await assina(corpo, "outro-segredo"), SEGREDO), false);
});

Deno.test("corpo alterado invalida a assinatura", async () => {
  // O caso real: alguém intercepta e troca o telefone que pediu pra sair.
  const original = '{"de":"5511988887777"}';
  const adulterado = '{"de":"5511911112222"}';
  const sig = await assina(original, SEGREDO);
  assertEquals(await assinaturaValida(adulterado, sig, SEGREDO), false);
});

Deno.test("cabeçalho ausente, vazio ou malformado não passa", async () => {
  const corpo = "{}";
  for (const c of [null, "", "sha256=", "sha1=abc", "abc", "sha256=zz", "Bearer x"]) {
    assertEquals(await assinaturaValida(corpo, c, SEGREDO), false, `passou: ${c}`);
  }
});

Deno.test("hex com tamanho errado não passa", async () => {
  assertEquals(await assinaturaValida("{}", "sha256=" + "a".repeat(63), SEGREDO), false);
  assertEquals(await assinaturaValida("{}", "sha256=" + "a".repeat(65), SEGREDO), false);
});

Deno.test("assinatura em MAIÚSCULA passa", async () => {
  // A Meta manda minúscula, mas normalizar evita uma falha inexplicável se
  // isso mudar — e não afrouxa nada.
  const corpo = '{"x":1}';
  const sig = (await assina(corpo, SEGREDO)).toUpperCase().replace("SHA256=", "sha256=");
  assertEquals(await assinaturaValida(corpo, sig, SEGREDO), true);
});

Deno.test("re-serializar o corpo quebraria a assinatura", async () => {
  // Documenta por que o endpoint precisa usar req.text() e NUNCA
  // JSON.stringify(await req.json()).
  //
  // O motivo é o ESPAÇAMENTO, não a ordem das chaves: JS preserva a ordem de
  // inserção de chaves de texto, então `{"b":2,"a":1}` sobrevive a um
  // parse+stringify intacto — foi o que esta asserção provou quando eu a
  // escrevi errada. O que a Meta manda é indentado, e o stringify devolve
  // compacto: bytes diferentes, assinatura morta.
  const cru = '{\n  "object": "whatsapp_business_account",\n  "entry": []\n}';
  const sig = await assina(cru, SEGREDO);
  const reserializado = JSON.stringify(JSON.parse(cru));
  assertEquals(await assinaturaValida(cru, sig, SEGREDO), true);
  assertEquals(await assinaturaValida(reserializado, sig, SEGREDO), false);

  // Chave NUMÉRICA é o caso em que a ordem muda de verdade.
  const numericas = '{"2":"b","1":"a"}';
  assertEquals(JSON.stringify(JSON.parse(numericas)), '{"1":"a","2":"b"}');
});

// ─── handshake de verificação ───────────────────────────────────────────────

Deno.test("handshake correto devolve o desafio", () => {
  const u = new URL("https://x/wa-webhook?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=12345");
  assertEquals(respostaDeVerificacao(u, "tok"), "12345");
});

Deno.test("handshake com token errado, ausente ou sem segredo é recusado", () => {
  const base = "https://x/wa-webhook?hub.mode=subscribe&hub.challenge=12345";
  assertEquals(respostaDeVerificacao(new URL(`${base}&hub.verify_token=errado`), "tok"), null);
  assertEquals(respostaDeVerificacao(new URL(base), "tok"), null);
  assertEquals(respostaDeVerificacao(new URL(`${base}&hub.verify_token=tok`), undefined), null);
});

Deno.test("modo diferente de subscribe é recusado", () => {
  const u = new URL("https://x/w?hub.mode=unsubscribe&hub.verify_token=tok&hub.challenge=1");
  assertEquals(respostaDeVerificacao(u, "tok"), null);
});

// ─── leitura do payload ─────────────────────────────────────────────────────

const PAYLOAD_TEXTO = {
  object: "whatsapp_business_account",
  entry: [{
    id: "waba-1",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        messages: [{ from: "5511988887777", id: "wamid.ABC", type: "text", text: { body: "SAIR" } }],
      },
    }],
  }],
};

Deno.test("extrai mensagem de texto", () => {
  const m = extraiMensagens(PAYLOAD_TEXTO);
  assertEquals(m.length, 1);
  assertEquals(m[0].de, "5511988887777");
  assertEquals(m[0].texto, "SAIR");
  assertEquals(m[0].id, "wamid.ABC");
});

Deno.test("evento de status não vira mensagem", () => {
  // A Meta manda MUITO mais status (entregue, lido) do que mensagem. Se cada
  // um virasse uma linha, o processamento rodaria à toa o dia inteiro.
  const status = {
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.X", status: "delivered" }] } }] }],
  };
  assertEquals(extraiMensagens(status).length, 0);
});

Deno.test("mensagem que não é texto vem com texto vazio, não some", () => {
  // Precisa aparecer pra ser marcada como processada (idempotência), mas não
  // tem como conter "SAIR".
  const audio = {
    entry: [{
      changes: [{ value: { messages: [{ from: "5511988887777", id: "wamid.A", type: "audio" }] } }],
    }],
  };
  const m = extraiMensagens(audio);
  assertEquals(m.length, 1);
  assertEquals(m[0].texto, "");
});

Deno.test("payload torto devolve lista vazia em vez de explodir", () => {
  // Webhook que responde 500 é webhook que a Meta desativa depois de algumas
  // tentativas — e aí o opt-out para de funcionar em silêncio.
  for (
    const p of [
      null,
      undefined,
      {},
      { entry: null },
      { entry: "x" },
      { entry: [{}] },
      { entry: [{ changes: null }] },
      { entry: [{ changes: [{}] }] },
      { entry: [{ changes: [{ value: {} }] }] },
      { entry: [{ changes: [{ value: { messages: "x" } }] }] },
      { entry: [{ changes: [{ value: { messages: [{}] } }] }] },
      { entry: [{ changes: [{ value: { messages: [{ from: 55, id: 1 }] } }] }] },
      "string",
      42,
    ]
  ) {
    assertEquals(extraiMensagens(p).length, 0, `explodiu ou extraiu: ${JSON.stringify(p)}`);
  }
});

Deno.test("várias mensagens em lote são todas extraídas", () => {
  const lote = {
    entry: [{
      changes: [{
        value: {
          messages: [
            { from: "5511900000001", id: "w1", type: "text", text: { body: "sair" } },
            { from: "5511900000002", id: "w2", type: "text", text: { body: "ok" } },
          ],
        },
      }],
    }],
  };
  assertEquals(extraiMensagens(lote).map((m) => m.id), ["w1", "w2"]);
});
