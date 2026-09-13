// Dias úteis do tenant e feriados nacionais.
//
// Existe porque a Mia falava três vezes por dia, todo dia, sem saber se a
// pessoa trabalhava naquele dia. Sábado de manhã ela mandava o mesmo
// "☀️ sábado, 19/09 — 2 pra decidir" que mandaria numa terça.
//
// Duas decisões que valem a leitura:
//
// FERIADO NACIONAL NÃO VEM DE API. São 9 datas fixas e 4 derivadas da Páscoa,
// e a Páscoa é calculável por algoritmo fechado pra qualquer ano. Trocar 40
// linhas determinísticas por uma dependência de rede que pode cair — num dado
// que muda uma vez por década — seria piorar de propósito.
//
// FERIADO MUNICIPAL E ESTADUAL FICA DE FORA, decisão de 13/09/2026. Não existe
// registro nacional: cada um dos 5.570 municípios define por lei local. Quem
// mora onde 20/01 é feriado vai receber brief nesse dia, e isso é conhecido.

/** Índice = getUTCDay(). Domingo = 0. */
export const DOMINGO = 0;
export const SABADO = 6;

/** Segunda a sexta — o padrão de quem não disse nada. */
export const DIAS_UTEIS_PADRAO: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Um feriado que o código conhece.
 *
 * `legal` separa o que é feriado nacional por lei do que é ponto facultativo
 * tratado como feriado na prática (Carnaval e Corpus Christi). A distinção não
 * muda o comportamento hoje — os dois suspendem as mensagens — mas quem for
 * mexer nisso precisa saber que a segunda categoria é costume, não lei.
 */
export interface Feriado {
  /** "MM-DD" quando fixo, ISO completo quando calculado. */
  iso: string;
  nome: string;
  legal: boolean;
}

/**
 * Feriados nacionais de data fixa.
 *
 * Base: Lei 662/1949 e Lei 6.802/1980 (Aparecida). O 20 de novembro entrou
 * pela Lei 14.759/2024 e vale a partir de 2025 — por isso `desde`.
 *
 * NÃO CONFERIDO CONTRA FONTE PRIMÁRIA nesta sessão: o proxy do container
 * bloqueia saída HTTP, então isto saiu do meu conhecimento, não de consulta.
 * Vale uma conferência antes de confiar em 20/11 e na Sexta-feira Santa.
 */
const FIXOS: ReadonlyArray<{ mesDia: string; nome: string; desde?: number }> = [
  { mesDia: "01-01", nome: "Confraternização Universal" },
  { mesDia: "04-21", nome: "Tiradentes" },
  { mesDia: "05-01", nome: "Dia do Trabalho" },
  { mesDia: "09-07", nome: "Independência" },
  { mesDia: "10-12", nome: "Nossa Senhora Aparecida" },
  { mesDia: "11-02", nome: "Finados" },
  { mesDia: "11-15", nome: "Proclamação da República" },
  { mesDia: "11-20", nome: "Consciência Negra", desde: 2025 },
  { mesDia: "12-25", nome: "Natal" },
];

/** Derivados da Páscoa: deslocamento em dias e se é feriado legal. */
const MOVEIS: ReadonlyArray<{ offset: number; nome: string; legal: boolean }> = [
  { offset: -48, nome: "Carnaval (segunda)", legal: false },
  { offset: -47, nome: "Carnaval", legal: false },
  { offset: -2, nome: "Sexta-feira Santa", legal: true },
  { offset: 60, nome: "Corpus Christi", legal: false },
];

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Domingo de Páscoa do ano, como "YYYY-MM-DD".
 *
 * Algoritmo gregoriano anônimo (Meeus/Jones/Butcher). Só aritmética inteira —
 * nenhuma data é construída no meio do cálculo, justamente pra não haver fuso
 * nenhum envolvido.
 */
export function domingoDePascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Soma dias a uma data ISO, sem passar por fuso: ancora ao meio-dia UTC. */
function somaDias(iso: string, dias: number): string {
  const base = Date.parse(`${iso}T12:00:00Z`);
  return new Date(base + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Todos os feriados nacionais do ano, indexados por "YYYY-MM-DD".
 *
 * Sem cache de propósito: são 13 entradas e o cálculo é aritmética pura. Um
 * Map por chamada custa menos que a complexidade de invalidar cache por ano.
 */
export function feriadosNacionais(ano: number): Map<string, Feriado> {
  const mapa = new Map<string, Feriado>();

  for (const f of FIXOS) {
    if (f.desde !== undefined && ano < f.desde) continue;
    const iso = `${ano}-${f.mesDia}`;
    mapa.set(iso, { iso, nome: f.nome, legal: true });
  }

  const pascoa = domingoDePascoa(ano);
  for (const m of MOVEIS) {
    const iso = somaDias(pascoa, m.offset);
    mapa.set(iso, { iso, nome: m.nome, legal: m.legal });
  }

  return mapa;
}

/** O feriado daquele dia, ou null. Aceita só "YYYY-MM-DD". */
export function feriadoNacionalDe(iso: string): Feriado | null {
  if (!ISO_DATA.test(iso)) return null;
  const ano = Number(iso.slice(0, 4));
  return feriadosNacionais(ano).get(iso) ?? null;
}

/**
 * Normaliza o que veio do banco num conjunto de dias úteis utilizável.
 *
 * Devolve o PADRÃO quando o valor é ausente, malformado ou vazio — e nunca
 * um conjunto vazio. Tenant sem rotina cadastrada tem que continuar recebendo
 * as mensagens de sempre; silenciar a secretária por causa de um campo nulo
 * seria uma falha que ninguém percebe, porque o sintoma é ausência.
 */
export function diasUteisDe(bruto: unknown): number[] {
  if (!Array.isArray(bruto)) return [...DIAS_UTEIS_PADRAO];
  // Teto antes de percorrer: o valor vem do banco hoje, mas vai vir de
  // formulário. Sete dias existem; qualquer coisa acima disso é lixo ou
  // tentativa, e não há motivo pra gastar CPU provando.
  const dias = [...new Set(bruto.slice(0, 64).map(paraDia).filter((d): d is number => d !== null))]
    .sort((a, b) => a - b);
  return dias.length > 0 ? dias : [...DIAS_UTEIS_PADRAO];
}

/**
 * Um item bruto vira índice de dia, ou null.
 *
 * Converte string porque `smallint[]` do Postgres chega como número mas JSON de
 * formulário chega como texto. NÃO converte o resto: `Number(null)`,
 * `Number("")` e `Number([])` são todos 0 — que é um dia válido. Sem este
 * cuidado, lixo no array viraria domingo, e o teste "lixo no meio é
 * descartado" pegou exatamente isso.
 */
function paraDia(bruto: unknown): number | null {
  const n = typeof bruto === "number"
    ? bruto
    : typeof bruto === "string" && bruto.trim() !== ""
    ? Number(bruto)
    : NaN;
  return Number.isInteger(n) && n >= DOMINGO && n <= SABADO ? n : null;
}

export interface Rotina {
  /** Índices de getUTCDay que a pessoa trabalha. */
  diasUteis: number[];
  /** Feriado nacional suspende as mensagens. Default true. */
  respeitaFeriado?: boolean;
}

export function rotinaDe(brutoDiasUteis: unknown, respeitaFeriado = true): Rotina {
  return { diasUteis: diasUteisDe(brutoDiasUteis), respeitaFeriado };
}

/** Por que aquele dia não é útil — pra mensagem poder dizer, em vez de só sumir. */
export type MotivoNaoUtil = { tipo: "folga" } | { tipo: "feriado"; feriado: Feriado };

/**
 * Diz se a pessoa trabalha naquele dia, e quando não, por quê.
 *
 * Recebe ISO de data ("YYYY-MM-DD") porque o chamador já resolveu o fuso — a
 * plataforma inteira decide "que dia é hoje" em São Paulo antes de chegar
 * aqui. Aceitar Date aqui reabriria exatamente o erro de 02/09/2026, em que
 * uma data virou o dia anterior no caminho.
 */
export function diaUtil(iso: string, rotina: Rotina): { util: boolean; motivo?: MotivoNaoUtil } {
  if (!ISO_DATA.test(iso)) return { util: true };

  if (rotina.respeitaFeriado !== false) {
    const feriado = feriadoNacionalDe(iso);
    if (feriado) return { util: false, motivo: { tipo: "feriado", feriado } };
  }

  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  if (!rotina.diasUteis.includes(dow)) return { util: false, motivo: { tipo: "folga" } };

  return { util: true };
}

export function ehDiaUtil(iso: string, rotina: Rotina): boolean {
  return diaUtil(iso, rotina).util;
}

/**
 * O dia da semana em que o planejamento acontece: a folga que antecede a maior
 * sequência corrida de trabalho.
 *
 * Para seg–sex é domingo. Para quem trabalha sábado, também domingo. Para quem
 * folga só na quarta, é quarta (a sequência qui→ter passa pela virada). Para
 * quem trabalha os sete dias, `null`: não existe folga onde encaixar o ritual,
 * e escolher um dia arbitrário mandaria o planejamento no meio do expediente.
 *
 * "Maior sequência" e não "toda folga que antecede trabalho" porque a segunda
 * definição dispara duas vezes por semana em rotina fragmentada — quem trabalha
 * só terça e quinta receberia o planejamento da semana na segunda E na quarta.
 * Empate se resolve pelo dia mais cedo, pra ser determinístico.
 */
export function diaDoPlanejamento(rotina: Rotina): number | null {
  const uteis = new Set(rotina.diasUteis);
  if (uteis.size === 0 || uteis.size === 7) return null;

  let melhor: { vespera: number; corrida: number } | null = null;

  for (let dow = 0; dow < 7; dow++) {
    // Só interessa o INÍCIO de uma sequência: dia útil cujo anterior é folga.
    if (!uteis.has(dow) || uteis.has((dow + 6) % 7)) continue;

    let corrida = 0;
    while (corrida < 7 && uteis.has((dow + corrida) % 7)) corrida++;

    const vespera = (dow + 6) % 7;
    if (melhor === null || corrida > melhor.corrida) melhor = { vespera, corrida };
  }

  return melhor?.vespera ?? null;
}

/**
 * Aquela data é a noite de planejamento?
 *
 * Olha SÓ o padrão semanal, de propósito. Feriado não cria nem move o ritual:
 * uma terça de Carnaval tem quarta útil depois, e sem este cuidado o
 * planejamento da semana chegaria no meio do Carnaval.
 */
export function vesperaDaSemana(iso: string, rotina: Rotina): boolean {
  if (!ISO_DATA.test(iso)) return false;
  const dia = diaDoPlanejamento(rotina);
  if (dia === null) return false;
  return new Date(`${iso}T12:00:00Z`).getUTCDay() === dia;
}
