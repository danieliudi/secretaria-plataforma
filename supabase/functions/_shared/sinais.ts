// Sinais de mercado a partir de FONTE PRIMÁRIA, não de manchete.
//
// POR QUE ISTO EXISTE (medido em 01/09/2026, não suposto): o bloco de notícias
// do resumo da manhã perguntava ao Google Notícias "alguém escreveu uma
// manchete sobre isto?". Com os termos que a gente usava, a resposta foi ZERO
// manchetes — e não era o Google fora do ar, era a pergunta errada. Uma
// Circular DECOM, um edital de resíduo classe I, uma suspensão de certificado
// no INMETRO quase nunca viram notícia. O evento acontece num registro
// público e morre lá.
//
// Aqui a pergunta muda pra "isto ACONTECEU?", contra registro primário:
//   - PNCP    → editais de contratação pública (Lei 14.133)
//   - BCB     → PTAX, dólar de fechamento do dia útil
//   - Google  → mantido só pro que só existe em manchete (movimento de
//               concorrente), com os termos encurtados
//
// Desenho pensado pra crescer: cada fonte é independente e falha sozinha.
// Adicionar DOU, ProdCert ou Comex Stat depois é escrever mais uma função de
// busca e registrar na lista — não é refazer este arquivo.
import { semDadoPessoal } from "./log-seguro.ts";

/**
 * Um sinal já normalizado, pronto pra virar texto.
 *
 * `frente` é OBRIGATÓRIO por decisão de desenho, não por conveniência: sinal
 * sem dono de frente é o que faz material de uma marca sair com dado de outra.
 */
export interface Sinal {
  fonte: string;
  frente: string;
  titulo: string;
  detalhe: string;
  link?: string;
}

/**
 * Teto de páginas lidas por UF num tique.
 *
 * 12 e não 6: medido em 01/09/2026 numa janela de 24h, SP sozinho publicou
 * 432 pregões = 9 páginas. Um teto de 6 cortaria SP no meio — justamente a UF
 * com 65% da carteira. 12 dá folga pro dia atípico sem virar varredura
 * infinita. As 5 UFs somadas dão ~28 páginas/dia, o que é barato.
 */
export const MAX_PAGINAS_POR_UF = 12;
const PNCP_TAM_PAGINA = 50;
/** Pregão eletrônico — a modalidade que concentra o volume. */
const PNCP_MODALIDADE_PREGAO = 6;
/** Teto de editais no bloco. Acima disso vira ruído no WhatsApp. */
export const MAX_EDITAIS_NO_BLOCO = 5;

/**
 * Termos que indicam resíduo CLASSE I (perigoso) — o que a Resibag embala.
 *
 * Calibrado contra amostra real do PNCP: dos 3 editais de "resíduo" achados
 * em 200 registros de SP, só 1 servia (lixo hospitalar). Os outros dois eram
 * resíduo VEGETAL (poda, galho, jardinagem) — volume alto e valor zero pra
 * esta frente. Sem esta separação, o bloco viraria dois terços de lixo verde.
 */
const TERMOS_CLASSE_I = [
  "perigoso",
  // COM ESPAÇO À FRENTE, e nunca "classe i" solto: "classe i" é substring de
  // "CLASSIFICADOS", e foi assim que um edital que diz textualmente
  // "resíduos Classe 2 - NÃO PERIGOSOS" passou no filtro no primeiro teste
  // com dado real (Iaras/SP, 01/09/2026). Substring casual em português é
  // armadilha silenciosa: aceita o oposto do que se queria.
  " classe i ",
  " classe i,",
  " classe i.",
  "classe 1",
  "hospitalar",
  "infectante",
  "de saúde",
  "de saude",
  "ambulatorial",
  "químico",
  "quimico",
  "contaminad",
  "oleoso",
  "borra",
  "lodo",
  "efluente",
  "lâmpada",
  "lampada",
  "eletroeletrônic",
  "eletroeletronic",
  "pilha e bateria",
  "amianto",
  "asbesto",
  // Achados como FALSO NEGATIVO no primeiro teste com dado real: Nova Santa
  // Rita/RS, R$ 1,49 mi, "hidrojateamento e sucção de resíduos de fossas
  // sépticas e de caixas de gordura". É classe I e o filtro rejeitava.
  "fossa séptica",
  "fossa septica",
  "caixa de gordura",
  "hidrojateamento",
  "sucção de resíduo",
  "succao de residuo",
];

/** Resíduo que NÃO é classe I. Só descarta quando nenhum termo de classe I bate. */
const TERMOS_NAO_PERIGOSO = [
  "vegetal",
  "poda",
  "galho",
  "jardinagem",
  "arborização",
  "arborizacao",
  "capina",
  "roçada",
  "rocada",
  "entulho",
  "construção civil",
  "construcao civil",
  "recicláve",
  "reciclave",
];

function normaliza(s: string): string {
  return (s ?? "").toLowerCase();
}

/**
 * O objeto do edital é de resíduo perigoso?
 *
 * Regra: precisa falar de resíduo E de algo classe I. Um termo de
 * não-perigoso sozinho não basta pra descartar — "coleta de resíduos
 * recicláveis e resíduos de serviço de saúde" tem os dois e É relevante.
 */
export function ehEditalRelevante(objeto: string): boolean {
  const o = normaliza(objeto);
  if (!o.includes("resídu") && !o.includes("residu")) return false;
  // Declaração EXPLÍCITA de não-periculosidade manda em tudo. Edital sério
  // cita a NBR 10.004 e diz a classe com todas as letras — quando ele diz que
  // NÃO é perigoso, acreditar nele é mais confiável que qualquer palpite por
  // palavra-chave. Foi o que separou o falso positivo de Iaras/SP.
  const declaraNaoPerigoso = ["não perigoso", "nao perigoso", "classe 2", "classe ii"]
    .some((t) => o.includes(t));
  if (declaraNaoPerigoso) return false;

  const temClasseI = TERMOS_CLASSE_I.some((t) => o.includes(t));
  if (temClasseI) return true;
  // Sem marcador de classe I: só passa se também não for claramente do balde
  // de resíduo comum. Na dúvida, FICA DE FORA — o custo de um falso positivo
  // no WhatsApp é o chefe parar de ler o bloco.
  return false;
}

/** Corta texto sem cortar no meio de palavra, pra caber numa bolha. */
export function resume(texto: string, max: number): string {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const ultimoEspaco = corte.lastIndexOf(" ");
  return `${(ultimoEspaco > max * 0.6 ? corte.slice(0, ultimoEspaco) : corte).trim()}…`;
}

/** "R$ 36.810" — sem centavos, que não mudam decisão nenhuma. */
export function formataValor(bruto: unknown): string | null {
  const n = typeof bruto === "number" ? bruto : Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
}

/** UF válida — entrada de configuração de tenant, tratada como não confiável. */
export function ufValida(uf: unknown): uf is string {
  return typeof uf === "string" && /^[A-Z]{2}$/.test(uf.trim().toUpperCase());
}

export function normalizaUfs(brutas: unknown): string[] {
  if (!Array.isArray(brutas)) return [];
  const vistas = new Set<string>();
  for (const u of brutas) {
    if (!ufValida(u)) continue;
    vistas.add(String(u).trim().toUpperCase());
  }
  return [...vistas];
}

/** AAAAMMDD, formato que o PNCP exige. */
export function dataPncp(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${
    String(d.getUTCDate()).padStart(2, "0")
  }`;
}

interface EditalPncp {
  objetoCompra?: unknown;
  valorTotalEstimado?: unknown;
  orgaoEntidade?: { razaoSocial?: unknown };
  unidadeOrgao?: { ufSigla?: unknown; municipioNome?: unknown };
  linkSistemaOrigem?: unknown;
  dataEncerramentoProposta?: unknown;
}

/** Um edital cru do PNCP vira Sinal, ou null se não interessa. */
export function editalParaSinal(bruto: EditalPncp, frente: string): Sinal | null {
  const objeto = typeof bruto.objetoCompra === "string" ? bruto.objetoCompra : "";
  if (!ehEditalRelevante(objeto)) return null;

  const orgao = typeof bruto.orgaoEntidade?.razaoSocial === "string" ? bruto.orgaoEntidade.razaoSocial : "";
  const uf = typeof bruto.unidadeOrgao?.ufSigla === "string" ? bruto.unidadeOrgao.ufSigla : "";
  const valor = formataValor(bruto.valorTotalEstimado);
  const prazo = typeof bruto.dataEncerramentoProposta === "string"
    ? bruto.dataEncerramentoProposta.slice(0, 10)
    : null;

  const partes = [orgao && resume(orgao, 60), uf, valor, prazo && `propostas até ${prazo}`]
    .filter(Boolean);

  return {
    fonte: "PNCP",
    frente,
    titulo: resume(objeto, 140),
    detalhe: partes.join(" · "),
    link: typeof bruto.linkSistemaOrigem === "string" ? bruto.linkSistemaOrigem : undefined,
  };
}

export type FetchLike = (url: string) => Promise<Response>;

/**
 * Editais de resíduo perigoso publicados na janela, nas UFs do tenant.
 *
 * Falha de UMA UF não derruba as outras — mesmo princípio do bloco de
 * notícias antigo, que era a única coisa boa do desenho anterior.
 */
export async function buscaEditais(
  ufs: string[],
  de: Date,
  ate: Date,
  frente: string,
  fetchImpl: FetchLike = fetch,
): Promise<Sinal[]> {
  const dataInicial = dataPncp(de);
  const dataFinal = dataPncp(ate);
  const achados: Sinal[] = [];

  for (const uf of normalizaUfs(ufs)) {
    try {
      for (let pagina = 1; pagina <= MAX_PAGINAS_POR_UF; pagina++) {
        const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao` +
          `?dataInicial=${dataInicial}&dataFinal=${dataFinal}` +
          `&codigoModalidadeContratacao=${PNCP_MODALIDADE_PREGAO}` +
          `&uf=${uf}&pagina=${pagina}&tamanhoPagina=${PNCP_TAM_PAGINA}`;
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`PNCP ${res.status}`);
        const corpo = await res.json() as { data?: EditalPncp[]; totalPaginas?: number };
        for (const item of corpo.data ?? []) {
          const sinal = editalParaSinal(item, frente);
          if (sinal) achados.push(sinal);
        }
        if (pagina >= (corpo.totalPaginas ?? 1)) break;
      }
    } catch (err) {
      // A UF que falhou some do bloco; as outras seguem. Nunca o objeto do
      // edital no log — é texto público, mas o log é pra diagnóstico, não pra
      // guardar conteúdo de terceiro.
      console.error(`[sinais] PNCP '${uf}' falhou: ${semDadoPessoal(err)}`);
    }
  }
  return achados;
}

// ─── Câmbio ─────────────────────────────────────────────────────────────────
//
// LIMIARES MEDIDOS, não escolhidos no olho (02/09/2026). Série PTAX de venda,
// 127 pregões entre março e setembro de 2026:
//
//   mediana do dia .... 0,36%      amplitude no período ... 7,4%
//   média ............. 0,48%      (4,8973 → 5,2599)
//   percentil 90 ...... 1,10%      deriva média em 15 pregões ... 1,83%
//   maior salto ....... 1,92%
//
// Quantos dias cada limiar diário pegaria, em 127 pregões: 0,5% → 47 (um a
// cada 2,7 dias, vira ruído); 1,0% → 14 (~2/mês); 1,5% → 4; 2,0% → NENHUM.
//
// Por que DUAS regras e não uma: pra quem usa o dólar como INSUMO (resina
// indexada), um dia de 1% não muda preço — o que muda é o patamar. E o
// patamar andou 7,4% no período sem nenhum salto diário de 2%. A deriva de 15
// pregões ≥3% dispararia 6 vezes em 6 meses (10/04, 27/04, 29/05, 09/06,
// 24/06 e 14/08), ~1 por mês.
//
// A deriva FICA LIGADA por dias seguidos — foram 16 dias acima de 3%, em 6
// episódios. Por isso `chave` identifica o EPISÓDIO (o dia em que a deriva
// cruzou o limiar), não o dia: quem chama grava em `avisos_enviados` e o
// segundo dia do mesmo episódio não vira mensagem nova.

/** Salto de um pregão pro outro que merece uma linha no resumo do dia. */
export const CAMBIO_SALTO_DIA_PCT = 1.0;
/** Janela da deriva, em pregões (≈3 semanas corridas). */
export const CAMBIO_DERIVA_PREGOES = 15;
/** Deriva acumulada na janela que indica mudança de patamar. */
export const CAMBIO_DERIVA_PCT = 3.0;

export interface CotacaoPtax {
  /** AAAA-MM-DD */
  dia: string;
  venda: number;
}

export interface AlertaCambio {
  tipo: "salto" | "deriva";
  sinal: Sinal;
  /** Identidade do episódio, pra deduplicar em `avisos_enviados`. */
  chave: string;
}

function dataBcb(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
}

function pct(a: number, b: number): number {
  return Math.abs(a / b - 1) * 100;
}

function reais(v: number): string {
  return v.toFixed(4).replace(".", ",");
}

/**
 * A série PTAX de venda da janela, em ordem cronológica.
 *
 * UMA chamada, em vez do laço dia-a-dia que existia antes: além de mais
 * barato, remove um bug real — o `catch` do laço fazia `return null`, então um
 * 503 num único dia abortava a busca inteira em vez de tentar o dia anterior.
 * Devolve [] em vez de lançar; fim de semana e feriado simplesmente não vêm.
 */
export async function buscaSeriePtax(
  ate: Date,
  diasCorridos = 40,
  fetchImpl: FetchLike = fetch,
): Promise<CotacaoPtax[]> {
  const de = new Date(ate.getTime() - diasCorridos * 86400000);
  const url = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@dataInicial='${dataBcb(de)}'&@dataFinalCotacao='${dataBcb(ate)}'` +
    "&$format=json&$select=cotacaoVenda,dataHoraCotacao";
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`BCB ${res.status}`);
    const corpo = await res.json() as {
      value?: Array<{ cotacaoVenda?: number; dataHoraCotacao?: string }>;
    };
    return (corpo.value ?? [])
      .filter((r) => typeof r.cotacaoVenda === "number" && r.cotacaoVenda > 0 && r.dataHoraCotacao)
      .map((r) => ({ dia: r.dataHoraCotacao!.slice(0, 10), venda: r.cotacaoVenda! }))
      .sort((a, b) => a.dia.localeCompare(b.dia));
  } catch (err) {
    console.error(`[sinais] série PTAX falhou: ${semDadoPessoal(err)}`);
    return [];
  }
}

/**
 * A cotação de fechamento mais recente da série — o número que o panorama
 * SEMANAL carrega sempre, sem depender de limiar.
 */
export function cambioAtual(serie: CotacaoPtax[], frente: string): Sinal | null {
  const ultima = serie[serie.length - 1];
  if (!ultima) return null;
  return {
    fonte: "BCB",
    frente,
    titulo: `Dólar ${reais(ultima.venda)}`,
    // A DATA É OBRIGATÓRIA no corpo: número de câmbio sem data vira citação
    // errada pro cliente semanas depois.
    detalhe: `PTAX de venda, fechamento de ${ultima.dia.slice(8, 10)}/${ultima.dia.slice(5, 7)}`,
  };
}

/**
 * O câmbio merece uma linha no resumo de HOJE? Só quando um dos dois limiares
 * medidos acima é cruzado — senão devolve null e o diário não fala de dólar.
 *
 * Salto ganha da deriva quando os dois disparam: é a notícia mais fresca, e a
 * deriva quase sempre continua verdadeira amanhã.
 */
export function avaliaCambio(serie: CotacaoPtax[], frente: string): AlertaCambio | null {
  if (serie.length < 2) return null;
  const hoje = serie[serie.length - 1];
  const ontem = serie[serie.length - 2];

  const salto = pct(hoje.venda, ontem.venda);
  if (salto >= CAMBIO_SALTO_DIA_PCT) {
    const subiu = hoje.venda > ontem.venda;
    return {
      tipo: "salto",
      chave: `cambio-salto-${hoje.dia}`,
      sinal: {
        fonte: "BCB",
        frente,
        titulo: `Dólar ${subiu ? "subiu" : "caiu"} ${salto.toFixed(1).replace(".", ",")}% em um pregão, pra ${reais(hoje.venda)}`,
        detalhe: `PTAX de venda, ${hoje.dia.slice(8, 10)}/${hoje.dia.slice(5, 7)} — vinha de ${reais(ontem.venda)}`,
      },
    };
  }

  const base = serie[serie.length - 1 - CAMBIO_DERIVA_PREGOES];
  if (!base) return null;
  const deriva = pct(hoje.venda, base.venda);
  if (deriva < CAMBIO_DERIVA_PCT) return null;

  // O episódio começou no primeiro pregão em que a deriva cruzou o limiar e
  // não desceu desde então. É essa data que vira a chave — assim o segundo dia
  // do mesmo movimento não gera mensagem nova.
  let inicio = serie.length - 1;
  for (let i = serie.length - 1; i - CAMBIO_DERIVA_PREGOES >= 0; i--) {
    const anterior = serie[i - CAMBIO_DERIVA_PREGOES];
    if (pct(serie[i].venda, anterior.venda) < CAMBIO_DERIVA_PCT) break;
    inicio = i;
  }

  const subiu = hoje.venda > base.venda;
  return {
    tipo: "deriva",
    chave: `cambio-deriva-${serie[inicio].dia}`,
    sinal: {
      fonte: "BCB",
      frente,
      titulo: `Dólar ${subiu ? "acumula alta" : "acumula queda"} de ${deriva.toFixed(1).replace(".", ",")}% em ${CAMBIO_DERIVA_PREGOES} pregões, pra ${reais(hoje.venda)}`,
      detalhe: `PTAX de venda, ${hoje.dia.slice(8, 10)}/${hoje.dia.slice(5, 7)} — estava ${reais(base.venda)} em ${base.dia.slice(8, 10)}/${base.dia.slice(5, 7)}`,
    },
  };
}

/**
 * Monta o bloco de texto que entra no prompt do resumo da manhã.
 *
 * Devolve "" quando não há sinal nenhum — e aí o prompt simplesmente não
 * ganha a seção, em vez de ganhar uma seção vazia que o modelo preenche
 * inventando um motivo.
 */
export function montaBlocoSinais(sinais: Sinal[]): string {
  if (sinais.length === 0) return "";

  const porFrente = new Map<string, Sinal[]>();
  for (const s of sinais) {
    const lista = porFrente.get(s.frente) ?? [];
    lista.push(s);
    porFrente.set(s.frente, lista);
  }

  const blocos: string[] = [];
  for (const [frente, lista] of porFrente) {
    const linhas = lista.slice(0, MAX_EDITAIS_NO_BLOCO).map((s) => {
      const cauda = s.detalhe ? ` — ${s.detalhe}` : "";
      return `    - [${s.fonte}] ${s.titulo}${cauda}`;
    });
    const sobra = lista.length - linhas.length;
    if (sobra > 0) linhas.push(`    - (+${sobra} não listados)`);
    blocos.push(`  ${frente}:\n${linhas.join("\n")}`);
  }
  return blocos.join("\n");
}
