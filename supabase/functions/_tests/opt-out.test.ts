// Testes da detecção de pedido de saída.
// Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque os dois erros aqui são graves, opostos, e nenhum dos dois
// aparece em log:
//
// FALSO NEGATIVO — a pessoa pediu pra sair e continuamos mandando. Vira
// descumprimento do direito de oposição com prova documental: a mensagem dela
// pedindo está no nosso banco.
//
// FALSO POSITIVO — "vou sair do escritório às 18h" remove um cliente pra
// sempre. Ninguém é avisado. O tenant perde o canal e nunca sabe por quê.
//
// A segunda metade deste arquivo existe só pra travar o falso positivo, que é
// o que um `includes("sair")` ingênuo produz — e é a primeira implementação que
// qualquer um escreve.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectaPedidoDeSaida } from "../_shared/opt-out.ts";

function saiu(texto: string, esperado: boolean, nota?: string) {
  assertEquals(
    detectaPedidoDeSaida(texto),
    esperado,
    `"${texto}" deveria ${esperado ? "" : "NÃO "}ser saída${nota ? ` — ${nota}` : ""}`,
  );
}

// ─── deve reconhecer ────────────────────────────────────────────────────────

Deno.test("a palavra sozinha, em qualquer caixa", () => {
  for (const t of ["sair", "SAIR", "Sair", "  sair  "]) saiu(t, true);
});

Deno.test("com pontuação e emoji em volta", () => {
  // O rodapé diz "Responda SAIR" — muita gente responde com ênfase.
  for (const t of ["SAIR!", "sair.", "SAIR!!!", "sair 🙏", "*SAIR*", "“sair”"]) saiu(t, true);
});

Deno.test("variantes de uma palavra", () => {
  for (const t of ["parar", "pare", "cancelar", "descadastrar", "remover", "stop", "unsubscribe"]) {
    saiu(t, true);
  }
});

Deno.test("a forma educada de uma palavra a mais", () => {
  for (const t of ["sair por favor", "sair pf", "parar por favor", "cancelar obrigado"]) {
    saiu(t, true);
  }
});

Deno.test("frases compostas, em qualquer posição", () => {
  saiu("não quero mais receber", true);
  saiu("nao quero mais receber essas mensagens", true);
  saiu("oi, por favor me tira da lista", true);
  saiu("pare de me mandar isso", true);
  saiu("não me manda mais nada por aqui", true);
  saiu("boa tarde, não quero receber, obrigada", true);
});

Deno.test("acento não atrapalha", () => {
  saiu("não me mande mais", true);
  saiu("nao me mande mais", true);
});

// ─── NÃO pode reconhecer ────────────────────────────────────────────────────

Deno.test("'sair' dentro de frase comum NÃO é pedido de saída", () => {
  // O caso que motivou o módulo inteiro.
  saiu("vou sair do escritório às 18h", false);
  saiu("posso sair antes?", false);
  saiu("vamos sair pra almoçar depois", false);
  saiu("tenho que sair correndo, mas confirmo sim", false);
  saiu("ela acabou de sair da reunião", false);
});

Deno.test("'parar' e 'para' dentro de frase NÃO contam", () => {
  // "para" é preposição — a palavra mais comum do português nesse contexto.
  saiu("para que horas mesmo?", false);
  saiu("confirmo para amanhã", false);
  saiu("vou parar no posto e chego às 14h", false);
  saiu("isso é para o Daniel?", false);
});

Deno.test("respostas normais nunca removem ninguém", () => {
  for (
    const t of [
      "confirmado",
      "sim",
      "não",
      "nao",
      "de pé sim",
      "ok",
      "beleza",
      "pode ser",
      "tudo certo 👍",
      "quem é?",
      "não posso amanhã, remarca?",
    ]
  ) saiu(t, false);
});

Deno.test("'não' sozinho é resposta à pergunta, não saída", () => {
  // A mensagem termina em "Segue de pé?". Tratar "não" como saída removeria
  // exatamente quem respondeu o que foi perguntado.
  saiu("não", false);
  saiu("nao", false);
  saiu("Não!", false);
});

Deno.test("cancelamento de compromisso não é cancelamento de contato", () => {
  // "cancelar" sozinho é saída; "cancelar a reunião" é assunto.
  saiu("preciso cancelar a reunião de amanhã", false);
  saiu("cancela lá pra mim", false);
});

// ─── entrada hostil ─────────────────────────────────────────────────────────

Deno.test("entrada inválida não explode nem remove", () => {
  assertEquals(detectaPedidoDeSaida(""), false);
  assertEquals(detectaPedidoDeSaida("   "), false);
  assertEquals(detectaPedidoDeSaida(null), false);
  assertEquals(detectaPedidoDeSaida(undefined), false);
  assertEquals(detectaPedidoDeSaida(42), false);
  assertEquals(detectaPedidoDeSaida({ texto: "sair" }), false);
  assertEquals(detectaPedidoDeSaida("🙂🙂🙂"), false);
});

Deno.test("texto gigante é recusado sem varrer", () => {
  // Alguém colando um livro com a palavra "sair" no meio não remove ninguém.
  assertEquals(detectaPedidoDeSaida("sair " + "x".repeat(5000)), false);
});

Deno.test("na dúvida, não remove", () => {
  // Frases ambíguas de propósito. Pedido não reconhecido ainda pode ser tratado
  // por uma pessoa; remoção equivocada é silenciosa.
  saiu("acho que quero sair disso aqui", false, "ambígua — humano decide");
  saiu("me tira daqui", false, "não é a frase da lista");
});
