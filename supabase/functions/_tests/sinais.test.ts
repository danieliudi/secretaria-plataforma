import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buscaCambio,
  buscaEditais,
  dataPncp,
  editalParaSinal,
  ehEditalRelevante,
  formataValor,
  montaBlocoSinais,
  normalizaUfs,
  resume,
  ufValida,
} from "../_shared/sinais.ts";

// Os três objetos abaixo são TEXTO REAL colhido do PNCP em 01/09/2026, na
// amostra que motivou o filtro. Se o filtro mudar e estes casos virarem, é
// regressão de verdade — não teste inventado.
const REAL_HOSPITALAR =
  "[Portal de Compras Públicas] - REGISTRO DE PREÇOS DE COLETA, TRANSPORTE, TRATAMENTO E DESTINAÇÃO FINAL DE RESÍDUOS (LIXO HOSPITALAR) DAS UNIDADES DE SAÚDE DESTE MUNICÍPIO.";
const REAL_TRITURADOR =
  "AQUISIÇÃO DE TRITURADOR DE GALHOS PARA O PROCESSAMENTO DE RESÍDUOS VEGETAIS PROVENIENTES DOS SERVIÇOS PODA SUPRESSÃO E DE MANUTENÇÃO DA ARBORIZAÇÃO URBANA DO MUNICÍPIO DE SANTA BRANCA/SP.";
const REAL_JARDINAGEM =
  "Contratacao de empresa para a prestacao de servicos de jardinagem  compreendendo a execucao de poda de arvores em altura  rocada de areas publicas  bem como o recolhimento  acondicionamento  transport";

Deno.test("caso real: lixo hospitalar É relevante (classe I)", () => {
  assert(ehEditalRelevante(REAL_HOSPITALAR));
});

Deno.test("casos reais: resíduo vegetal NÃO é relevante", () => {
  // Os dois falsos positivos que o filtro existe pra barrar. Sem isso, dois
  // terços do bloco seriam poda de árvore.
  assertEquals(ehEditalRelevante(REAL_TRITURADOR), false);
  assertEquals(ehEditalRelevante(REAL_JARDINAGEM), false);
});

// ── Dois casos que o PRIMEIRO teste com dado real do PNCP (01/09/2026)
// mostrou que o filtro errava. Ambos vieram de edital de verdade.

Deno.test("edital que se declara Classe 2 é RECUSADO, mesmo com palavra parecida", () => {
  // Falso positivo real (Iaras/SP, R$ 288.495): passava porque "classe i" é
  // substring de "CLASSIFICADOS". O edital diz, com todas as letras, que os
  // resíduos são "Classe 2 – não perigosos".
  const iaras =
    "Contratação de empresa especializada para a prestação de serviços de recebimento, " +
    "tratamento e destinação final ambientalmente adequada de resíduos sólidos domiciliares " +
    "e comerciais, classificados quanto à periculosidade como resíduos Classe 2 – não perigosos, " +
    "nos termos da ABNT NBR 10004-1:2024 e da ABNT NBR 10004-2:2024";
  assertEquals(ehEditalRelevante(iaras), false);
});

Deno.test("fossa séptica e caixa de gordura SÃO relevantes", () => {
  // Falso negativo real (Nova Santa Rita/RS, R$ 1.490.590): resíduo de fossa
  // e de caixa de gordura é classe I, e o filtro original rejeitava.
  const novaSantaRita =
    "REGISTRO DE PREÇOS PARA CONTRATAÇÃO DE EMPRESA ESPECIALIZADA PARA PRESTAÇÃO EVENTUAL " +
    "DE SERVIÇOS DE HIDROJATEAMENTO E SUCÇÃO DE RESÍDUOS DE FOSSAS SÉPTICAS E DE CAIXAS DE GORDURA.";
  assert(ehEditalRelevante(novaSantaRita));
});

Deno.test("declaração de não-periculosidade vence outro termo que casaria", () => {
  // Mesmo com "hospitalar" no texto, se o edital declara Classe 2 ele sai.
  assertEquals(
    ehEditalRelevante("coleta de resíduos de unidade hospitalar, classe 2 - não perigosos"),
    false,
  );
});

Deno.test("objeto sem a palavra resíduo nunca entra", () => {
  assertEquals(ehEditalRelevante("AQUISIÇÃO DE MERENDA ESCOLAR"), false);
  assertEquals(ehEditalRelevante(""), false);
});

Deno.test("reconhece os marcadores de classe I", () => {
  for (const o of [
    "coleta de resíduos perigosos classe I",
    "destinação de resíduo infectante",
    "transporte de resíduos químicos industriais",
    "remoção de resíduos contaminados por óleo",
    "coleta de resíduos de serviços de saúde",
    "descarte de resíduos de lâmpadas fluorescentes",
  ]) {
    assert(ehEditalRelevante(o), `deveria aceitar: ${o}`);
  }
});

Deno.test("edital misto (reciclável + saúde) entra — o termo forte ganha", () => {
  // "recicláveis" sozinho seria descartado; com "serviços de saúde" junto o
  // edital é relevante. Descartar por causa do termo fraco perderia o lead.
  assert(ehEditalRelevante("coleta de resíduos recicláveis e resíduos de serviços de saúde"));
});

Deno.test("editalParaSinal monta o sinal completo e respeita a frente", () => {
  const s = editalParaSinal({
    objetoCompra: REAL_HOSPITALAR,
    valorTotalEstimado: 36810,
    orgaoEntidade: { razaoSocial: "MUNICIPIO DE CAMPOS NOVOS PAULISTA" },
    unidadeOrgao: { ufSigla: "SP" },
    dataEncerramentoProposta: "2026-09-15T09:00:00",
  }, "Resibag");
  assert(s);
  assertEquals(s.fonte, "PNCP");
  assertEquals(s.frente, "Resibag");
  assertStringIncludes(s.detalhe, "SP");
  assertStringIncludes(s.detalhe, "R$ 36.810");
  assertStringIncludes(s.detalhe, "propostas até 2026-09-15");
});

Deno.test("editalParaSinal devolve null pro que não interessa", () => {
  assertEquals(editalParaSinal({ objetoCompra: REAL_TRITURADOR }, "Resibag"), null);
});

Deno.test("editalParaSinal sobrevive a campos ausentes ou de tipo errado", () => {
  // Corpo de API externa é entrada hostil: nada aqui pode lançar.
  const s = editalParaSinal({
    objetoCompra: "coleta de resíduo perigoso",
    valorTotalEstimado: "não é número",
    orgaoEntidade: { razaoSocial: 42 as unknown as string },
    unidadeOrgao: undefined,
  }, "Resibag");
  assert(s);
  assertEquals(s.detalhe, "");
});

Deno.test("formataValor descarta valor inválido em vez de mostrar NaN", () => {
  assertEquals(formataValor(36810), "R$ 36.810");
  assertEquals(formataValor("36810.55"), "R$ 36.811");
  assertEquals(formataValor(0), null);
  assertEquals(formataValor(-5), null);
  assertEquals(formataValor("abc"), null);
  assertEquals(formataValor(null), null);
  assertEquals(formataValor(undefined), null);
});

Deno.test("resume corta em palavra inteira e marca o corte", () => {
  assertEquals(resume("abc", 10), "abc");
  const r = resume("palavra outra terceira quarta", 15);
  assert(r.endsWith("…"));
  assert(r.length <= 16);
  assert(!r.includes("  "));
});

Deno.test("ufValida e normalizaUfs recusam configuração torta", () => {
  assert(ufValida("SP"));
  assert(ufValida("sp"));
  assertEquals(ufValida("São Paulo"), false);
  assertEquals(ufValida("S"), false);
  assertEquals(ufValida(42), false);
  // Normaliza caixa, tira duplicata, ignora lixo — sem lançar.
  assertEquals(normalizaUfs(["sp", "SP", "mg", "São Paulo", 7, null]), ["SP", "MG"]);
  assertEquals(normalizaUfs("SP"), []);
  assertEquals(normalizaUfs(null), []);
});

Deno.test("dataPncp usa AAAAMMDD com zero à esquerda", () => {
  assertEquals(dataPncp(new Date(Date.UTC(2026, 8, 1))), "20260901");
  assertEquals(dataPncp(new Date(Date.UTC(2026, 11, 25))), "20261225");
});

Deno.test("montaBlocoSinais agrupa por frente e nunca mistura no mesmo bloco", () => {
  const bloco = montaBlocoSinais([
    { fonte: "PNCP", frente: "Resibag", titulo: "edital A", detalhe: "SP" },
    { fonte: "BCB", frente: "Sanwey", titulo: "Dólar 5,2005", detalhe: "PTAX de 28/08" },
  ]);
  const linhas = bloco.split("\n");
  const iRbg = linhas.findIndex((l) => l.trim().startsWith("Resibag:"));
  const iSw = linhas.findIndex((l) => l.trim().startsWith("Sanwey:"));
  assert(iRbg >= 0 && iSw >= 0);
  // Nenhuma linha carrega as duas frentes — regra de não-vazamento.
  for (const l of linhas) {
    assert(!(l.includes("Resibag") && l.includes("Sanwey")), `linha mistura frentes: ${l}`);
  }
});

Deno.test("montaBlocoSinais volta vazio sem sinal — e não uma seção vazia", () => {
  // Isto é o conserto do bug de 01/09: seção vazia fazia o modelo inventar
  // um motivo ("as fontes estão indisponíveis"). Sem seção, ele não inventa.
  assertEquals(montaBlocoSinais([]), "");
});

Deno.test("montaBlocoSinais aplica teto e diz quantos ficaram de fora", () => {
  const muitos = Array.from({ length: 9 }, (_, i) => ({
    fonte: "PNCP",
    frente: "Resibag",
    titulo: `edital ${i}`,
    detalhe: "",
  }));
  const bloco = montaBlocoSinais(muitos);
  assertStringIncludes(bloco, "(+4 não listados)");
  assertEquals(bloco.split("\n").filter((l) => l.includes("edital ")).length, 5);
});

Deno.test("buscaEditais: falha de uma UF não derruba as outras", async () => {
  const fake = (url: string): Promise<Response> => {
    if (url.includes("uf=MG")) return Promise.resolve(new Response("erro", { status: 500 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          totalPaginas: 1,
          data: [{ objetoCompra: "coleta de resíduo perigoso", orgaoEntidade: { razaoSocial: "X" } }],
        }),
        { status: 200 },
      ),
    );
  };
  const r = await buscaEditais(["SP", "MG"], new Date(), new Date(), "Resibag", fake);
  assertEquals(r.length, 1); // só SP; MG falhou e sumiu sem derrubar
});

Deno.test("buscaEditais respeita o teto de páginas", async () => {
  let chamadas = 0;
  const fake = (): Promise<Response> => {
    chamadas++;
    // totalPaginas altíssimo de propósito: sem teto isto rodaria pra sempre.
    return Promise.resolve(
      new Response(JSON.stringify({ totalPaginas: 9999, data: [] }), { status: 200 }),
    );
  };
  await buscaEditais(["SP"], new Date(), new Date(), "Resibag", fake);
  assertEquals(chamadas, 12);
});

Deno.test("buscaCambio anda pra trás até achar dia útil", async () => {
  let tentativas = 0;
  const fake = (): Promise<Response> => {
    tentativas++;
    // Os dois primeiros são fim de semana (value vazio), o terceiro tem dado.
    const value = tentativas >= 3 ? [{ cotacaoVenda: 5.2005 }] : [];
    return Promise.resolve(new Response(JSON.stringify({ value }), { status: 200 }));
  };
  const s = await buscaCambio(new Date(), "Sanwey", fake);
  assert(s);
  assertStringIncludes(s.titulo, "5,2005");
  // Data no corpo é obrigatória: número de câmbio sem data vira citação errada.
  assertStringIncludes(s.detalhe, "fechamento de");
});

Deno.test("buscaCambio devolve null em vez de lançar quando o BCB cai", async () => {
  const fake = (): Promise<Response> => Promise.resolve(new Response("", { status: 503 }));
  assertEquals(await buscaCambio(new Date(), "Sanwey", fake), null);
});
