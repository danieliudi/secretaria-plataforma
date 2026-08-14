// Normalização de telefone brasileiro para E.164.
//
// POR QUE EXISTE: o link `wa.me` só funciona com o número em E.164 sem sinais
// (`5511988887777`). Se a normalização erra um dígito, o WhatsApp abre uma
// conversa com DESCONHECIDO — ou pior, com a pessoa errada, e o usuário manda
// "confirmando nosso alinhamento amanhã 14h" pra um estranho. Isso não dá erro
// em lugar nenhum: o link é válido, a tela abre, a falha só aparece do outro
// lado. É exatamente o tipo de bug silencioso que motivou o caminho de teste
// primeiro.
//
// As três armadilhas do número brasileiro, todas cobertas em teste:
//
// 1. NONO DÍGITO — contato salvo antes de ~2016 tem celular de 8 dígitos
//    (`11 8888-7777`). Hoje precisa do 9 na frente. Mas fixo TAMBÉM tem 8
//    dígitos e NÃO leva 9. O que separa os dois é o primeiro dígito: fixo
//    começa em 2–5, celular em 6–9.
//
// 2. DDD 55 vs DDI 55 — o DDD de Santa Maria (RS) é 55, igual ao código do
//    Brasil. `55988887777` é celular do RS, não número sem DDD. Só o
//    COMPRIMENTO desempata, nunca o prefixo isolado.
//
// 3. DDD INVENTADO — `(10)` e `(23)` não existem. Aceitar leva o usuário a
//    mandar mensagem pro vazio sem nunca saber. Validamos contra a lista real.
//
// Este módulo NÃO loga nada. Telefone é dado pessoal e a auditoria de 12/08/2026
// já achou 191 linhas com número em texto puro em `async_debug`. Erro daqui sai
// como motivo genérico, sem ecoar a entrada.

/** DDDs que existem de fato no plano de numeração brasileiro. */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF/GO
  62, 64, // GO
  63, // TO
  65, 66, // MT
  67, // MS
  68, // AC
  69, // RO
  71, 73, 74, 75, 77, // BA
  79, // SE
  81, 87, // PE
  82, // AL
  83, // PB
  84, // RN
  85, 88, // CE
  86, 89, // PI
  91, 93, 94, // PA
  92, 97, // AM
  95, // RR
  96, // AP
  98, 99, // MA
]);

export type TelefoneOk = {
  ok: true;
  /** Formato E.164 sem o "+", que é o que o wa.me consome: `5511988887777`. */
  e164: string;
  ddd: string;
  movel: boolean;
};

export type TelefoneErro = {
  ok: false;
  /**
   * Motivo em pt-BR, pronto pra Yuka repetir ao usuário. NUNCA inclui a entrada
   * — senão o número vaza pra log no primeiro `console.error(resultado.motivo)`.
   */
  motivo: string;
};

export type TelefoneNormalizado = TelefoneOk | TelefoneErro;

/** Teto de entrada. Texto de usuário é hostil até prova em contrário. */
const MAX_ENTRADA = 40;

/**
 * Converte um telefone brasileiro escrito de qualquer jeito em E.164.
 *
 * Aceita `(11) 98888-7777`, `11988887777`, `+55 11 9 8888 7777`,
 * `5511988887777` e o formato antigo de 8 dígitos (que ganha o nono).
 */
export function normalizaTelefoneBr(entrada: string): TelefoneNormalizado {
  if (typeof entrada !== "string" || entrada.trim() === "") {
    return { ok: false, motivo: "Não recebi nenhum número." };
  }

  if (entrada.length > MAX_ENTRADA) {
    return { ok: false, motivo: "Esse número veio grande demais pra ser um telefone." };
  }

  let d = entrada.replace(/\D/g, "");

  if (d.length === 0) {
    return { ok: false, motivo: "Não achei dígito nenhum nesse número." };
  }

  // DDI. Só tiramos o 55 da frente quando o comprimento prova que é código de
  // país — 12 (fixo) ou 13 (celular). Em 11 dígitos, `55` é o DDD de Santa
  // Maria e retirá-lo destruiria o número.
  if (d.length === 12 || d.length === 13) {
    if (!d.startsWith("55")) {
      return { ok: false, motivo: "Só consigo montar link pra número do Brasil." };
    }
    d = d.slice(2);
  } else if (d.length > 13) {
    return { ok: false, motivo: "Esse número tem dígitos demais." };
  }

  if (d.length < 10) {
    // 9 dígitos ou menos = veio sem DDD. Não dá pra adivinhar: chutar o DDD do
    // tenant mandaria mensagem pra pessoa errada em outro estado.
    return { ok: false, motivo: "Faltou o DDD — me manda com o código da cidade." };
  }

  const ddd = d.slice(0, 2);
  let numero = d.slice(2);

  if (!DDDS_VALIDOS.has(Number(ddd))) {
    return { ok: false, motivo: "Esse DDD não existe. Confere pra mim?" };
  }

  if (numero.length === 8) {
    const primeiro = numero[0];
    if (primeiro >= "6" && primeiro <= "9") {
      // Celular no formato antigo: ganha o nono dígito.
      numero = "9" + numero;
    } else if (primeiro < "2") {
      // 0 e 1 não iniciam assinante — 0 é prefixo de operadora, 1 é serviço.
      return { ok: false, motivo: "Esse número não parece válido." };
    }
    // 2–5: fixo legítimo de 8 dígitos, fica como está.
  } else if (numero.length === 9) {
    if (numero[0] !== "9") {
      // 9 dígitos que não começam com 9 não existem no plano brasileiro.
      return { ok: false, motivo: "Esse número não parece válido." };
    }
  } else {
    return { ok: false, motivo: "Esse número não tem a quantidade certa de dígitos." };
  }

  return {
    ok: true,
    e164: "55" + ddd + numero,
    ddd,
    movel: numero.length === 9,
  };
}
