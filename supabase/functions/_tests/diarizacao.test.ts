import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  erroSeguroDeProvedor,
  formataTempo,
  parseFalantes,
  turnosParaTexto,
} from "../_shared/diarizacao.ts";

// parseFalantes é a fronteira onde a saída do modelo vira "quem disse isto".
// Errar aqui atribui uma frase à pessoa errada numa ata de reunião real, então
// os testes cobrem principalmente o que ela precisa RECUSAR.

Deno.test("parseFalantes: lê o formato esperado", () => {
  assertEquals(parseFalantes("A = Daniel\nB = Everton"), { A: "Daniel", B: "Everton" });
});

Deno.test("parseFalantes: tolera espaço extra e linhas em branco", () => {
  assertEquals(parseFalantes("\n  A   =   Daniel Iudi  \n\n"), { A: "Daniel Iudi" });
});

Deno.test("parseFalantes: '?' não vira nome", () => {
  assertEquals(parseFalantes("A = Daniel\nC = ?"), { A: "Daniel" });
});

Deno.test("parseFalantes: o rótulo cru não se disfarça de nome", () => {
  assertEquals(parseFalantes("A = Falante A\nB = falante desconhecido"), {});
});

Deno.test("parseFalantes: linha fora do formato é ignorada, não adivinhada", () => {
  assertEquals(
    parseFalantes("Acho que o A é o Daniel\nB: Everton\n- C = Marina"),
    {},
  );
});

Deno.test("parseFalantes: nome degenerado é cortado em 60 caracteres", () => {
  const enorme = "x".repeat(300);
  const mapa = parseFalantes(`A = ${enorme}`);
  // O regex já recusa linha acima de 60 — a proteção é dupla de propósito.
  assertEquals(Object.keys(mapa).length === 0 || mapa.A.length <= 60, true);
});

Deno.test("parseFalantes: bloco vazio devolve mapa vazio", () => {
  assertEquals(parseFalantes(""), {});
});

Deno.test("formataTempo: minutos e horas", () => {
  assertEquals(formataTempo(0), "00:00");
  assertEquals(formataTempo(31_000), "00:31");
  assertEquals(formataTempo(8 * 60_000 + 12_000), "08:12");
  assertEquals(formataTempo(3600_000 + 7 * 60_000 + 4_000), "1:07:04");
});

Deno.test("formataTempo: valor negativo não vira tempo negativo", () => {
  assertEquals(formataTempo(-5000), "00:00");
});

Deno.test("turnosParaTexto: marca o falante e o tempo de cada turno", () => {
  const texto = turnosParaTexto([
    { falante: "A", texto: "Fecho com o fotógrafo até sexta.", inicio_ms: 31_000, fim_ms: 35_000 },
    { falante: "B", texto: "Combinado.", inicio_ms: 36_000, fim_ms: 37_000 },
  ]);
  assertEquals(texto, "Falante A [00:31]: Fecho com o fotógrafo até sexta.\nFalante B [00:36]: Combinado.");
});

Deno.test("turnosParaTexto: corta no teto sem estourar o contexto do modelo", () => {
  const turnos = Array.from({ length: 500 }, (_, i) => ({
    falante: "A",
    texto: "palavra ".repeat(20),
    inicio_ms: i * 1000,
    fim_ms: i * 1000 + 900,
  }));
  const texto = turnosParaTexto(turnos, 1000);
  assertEquals(texto.length <= 1000, true);
});

// erroSeguroDeProvedor é o que impede a URL assinada do áudio de acabar
// gravada em texto puro numa coluna que a tela lê.

Deno.test("erroSeguroDeProvedor: some com a URL assinada", () => {
  // Token deliberadamente falso e óbvio — não imita o formato de um real, pra
  // não disparar varredura de segredo em nenhum commit futuro.
  const bruto =
    "Download error: https://exemplo.supabase.co/storage/v1/object/sign/reunioes/abc/def.m4a?token=TOKEN_FALSO_DE_TESTE returned 404";
  const limpo = erroSeguroDeProvedor(bruto);
  assertEquals(limpo.includes("token="), false);
  assertEquals(limpo.includes("supabase.co"), false);
  assertEquals(limpo.includes("[url removida]"), true);
  assertEquals(limpo.startsWith("Download error:"), true);
});

Deno.test("erroSeguroDeProvedor: pega mais de uma URL na mesma mensagem", () => {
  const limpo = erroSeguroDeProvedor("tentei http://a.com/x?t=1 e depois https://b.com/y?t=2");
  assertEquals(limpo, "tentei [url removida] e depois [url removida]");
});

Deno.test("erroSeguroDeProvedor: mensagem sem URL passa intacta", () => {
  assertEquals(erroSeguroDeProvedor("audio muito curto"), "audio muito curto");
});

Deno.test("erroSeguroDeProvedor: corta em 500 caracteres", () => {
  assertEquals(erroSeguroDeProvedor("x".repeat(900)).length, 500);
});
