// Guarda contra a classe de erro mais cara do projeto, agora na vitrine.
//
// Em 13/09/2026 eu publiquei em lib/exemplos.ts a frase "☀️ quinta, 13/09 —
// 2 pra decidir". 13/09/2026 é DOMINGO. O par dia-da-semana + data estava
// errado no site público, na mesma sessão em que a causa raiz do mesmo erro
// dentro da Mia foi corrigida — e passou por mockup aprovado, tsc, build,
// screenshot revisada e CI verde, porque nenhum deles compara as duas metades.
//
// É o mesmo buraco de sempre: a frase carrega o NOME do dia, o calendário
// carrega a DATA, e nada confronta os dois. Dentro da secretária isso virou
// _shared/dia-semana.ts. Aqui vira este teste.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

/**
 * O ano em que os pares de lib/exemplos.ts foram conferidos.
 *
 * Quando virar o ano, este teste falha de propósito: "17/09" só é quinta em
 * 2026. Não suba o número sem olhar — troque a DATA na vitrine por uma que
 * caia no dia da semana que a frase afirma, e só então atualize aqui.
 */
const ANO_DE_REFERENCIA = 2026;

const NOMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "quinta, 17/09" e "quinta-feira, 17/09" — as duas formas que a gente escreve. */
const PAR_DIA_DATA = /(domingo|segunda|terça|quarta|quinta|sexta|sábado)(?:-feira)?,\s*(\d{2})\/(\d{2})/g;

function diaDaSemanaEm(ano: number, mes: number, dia: number): string {
  // Meio-dia UTC: longe de qualquer borda de fuso, o mesmo cuidado de
  // _shared/dia-semana.ts.
  const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  return NOMES[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

const CAMINHO = new URL("../../../lib/exemplos.ts", import.meta.url);

Deno.test("todo par 'dia da semana, DD/MM' da vitrine confere de verdade", async () => {
  const fonte = await Deno.readTextFile(CAMINHO);
  const pares = [...fonte.matchAll(PAR_DIA_DATA)];

  // Se um dia não houver par nenhum, o teste não tem o que provar — mas
  // silêncio aqui seria verde vazio, então ele diz quantos examinou.
  const erros: string[] = [];
  for (const [trecho, nome, dd, mm] of pares) {
    const real = diaDaSemanaEm(ANO_DE_REFERENCIA, Number(mm), Number(dd));
    if (real !== nome) {
      erros.push(
        `"${trecho}" — ${dd}/${mm}/${ANO_DE_REFERENCIA} é ${real}, não ${nome}`,
      );
    }
  }

  assertEquals(
    erros,
    [],
    `${pares.length} par(es) examinado(s) em lib/exemplos.ts`,
  );
});

Deno.test("o regex ainda acha os pares que existem hoje", () => {
  // Sem isto, apagar acidentalmente o padrão da vitrine (ou mudar a forma da
  // frase) deixaria o teste acima verde sem examinar nada — que é exatamente
  // o modo de falha do stub de asserção de 03/09/2026.
  const amostra = '"☀️ quinta, 17/09 — 2 pra decidir" e "domingo, 20/09"';
  assertEquals([...amostra.matchAll(PAR_DIA_DATA)].length, 2);
});
