// Despesas / reembolso — captura ESTRUTURADA do que hoje vira texto solto.
//
// Como o dado chega: a pessoa fotografa a nota fiscal. No WhatsApp a descrição
// da imagem é montada no n8n (fora deste repo); no Telegram, por
// _shared/vision.ts. Nos DOIS casos o que chega no /fast é TEXTO — daí a
// extração morar aqui, numa tool que o modelo chama com os campos que ele leu
// da descrição, em vez de mexer no prompt de visão. Assim funciona igual nos
// dois canais e não depende do n8n.
//
// Regra de ouro: valor lido de foto erra. NADA é gravado sem o usuário
// confirmar — a instrução está no TOOLS_INSTRUCTIONS_TEMPLATE (fast/index.ts).

import { getSupabaseClient } from "../../_shared/supabase.ts";

/** Uma despesa como o banco guarda (valor já em centavos). */
export interface DespesaRow {
  id: string;
  valor_centavos: number;
  data_despesa: string;
  estabelecimento: string;
  categoria: string | null;
  frente: string | null;
  status: string;
}

export interface RegistrarDespesaInput {
  /** Aceita número (400.5) ou texto pt-BR ("R$ 400,50"). Ver parseValorCentavos. */
  valor: unknown;
  /** Data DO RECIBO em YYYY-MM-DD. */
  data: string;
  estabelecimento: string;
  categoria?: string;
  frente?: string;
  /** Descrição original da visão, pra auditoria. */
  origem_texto?: string;
}

export interface RegistrarDespesaResult {
  id: string;
  valor_centavos: number;
  data_despesa: string;
  estabelecimento: string;
  /** Total do mês DA DESPESA (não do mês corrente), já incluindo esta. */
  total_mes_centavos: number;
  qtd_mes: number;
}

export interface ListarDespesasInput {
  /** "YYYY-MM". Ausente = mês corrente em São Paulo. */
  mes?: string;
}

export interface ListarDespesasResult {
  mes: string;
  total_centavos: number;
  despesas: DespesaRow[];
  /** Quantas ainda estão sem frente definida — ela usa isso pra perguntar. */
  sem_frente: number;
}

export interface FecharMesInput {
  mes: string;
}

export interface FecharMesResult {
  mes: string;
  total_centavos: number;
  qtd: number;
}

export interface DespesasDeps {
  inserir: (row: Record<string, unknown>) => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  listarMes: (inicio: string, fim: string) => Promise<{ data: DespesaRow[] | null; error: { message: string } | null }>;
  fecharMes: (inicio: string, fim: string) => Promise<{ data: DespesaRow[] | null; error: { message: string } | null }>;
  now: () => Date;
}

/**
 * `tenantId` é OBRIGATÓRIO — mesma razão do quick_capture: sem ele a tabela
 * vira pilha única e o total de reembolso de um usuário aparece pra outro.
 * `userId` é opcional (nem todo caminho tem), serve pra saber quem lançou.
 */
export function defaultDespesasDeps(tenantId: string, userId?: string): DespesasDeps {
  if (!tenantId) throw new Error("despesas: tenantId obrigatório");
  const sb = () => getSupabaseClient();
  return {
    inserir: (row) =>
      sb()
        .from("despesas")
        .insert({ ...row, tenant_id: tenantId, user_id: userId ?? null })
        .select("id")
        .single() as unknown as ReturnType<DespesasDeps["inserir"]>,
    listarMes: (inicio, fim) =>
      sb()
        .from("despesas")
        .select("id, valor_centavos, data_despesa, estabelecimento, categoria, frente, status")
        .eq("tenant_id", tenantId)
        .gte("data_despesa", inicio)
        .lt("data_despesa", fim)
        .order("data_despesa", { ascending: true }) as unknown as ReturnType<DespesasDeps["listarMes"]>,
    fecharMes: (inicio, fim) =>
      sb()
        .from("despesas")
        .update({ status: "fechada", fechado_em: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("status", "pendente")
        .gte("data_despesa", inicio)
        .lt("data_despesa", fim)
        .select("id, valor_centavos, data_despesa, estabelecimento, categoria, frente, status") as unknown as ReturnType<
          DespesasDeps["fecharMes"]
        >,
    now: () => new Date(),
  };
}

// ─── parsing ────────────────────────────────────────────────────────────────

const TETO_CENTAVOS = 100_000_000; // R$ 1.000.000,00 — mesmo teto do check no banco

/**
 * Converte valor pra centavos aceitando o que o modelo realmente manda:
 * número (400.5) ou texto pt-BR ("R$ 1.234,56", "400,00", "82.49").
 *
 * O nó do problema é que pt-BR usa vírgula decimal e ponto de milhar, o
 * inverso do en-US — "1.234,56" são mil duzentos e trinta e quatro reais, e
 * um parseFloat ingênuo leria 1.234. A regra abaixo decide pelo ÚLTIMO
 * separador: se for vírgula, é decimal pt-BR; se for ponto E houver vírgula
 * antes, o ponto é milhar.
 */
export function parseValorCentavos(bruto: unknown): number {
  if (typeof bruto === "number") {
    if (!Number.isFinite(bruto)) throw new Error("valor inválido");
    return arredondaCentavos(bruto * 100);
  }
  if (typeof bruto !== "string") throw new Error("valor ausente ou de tipo inesperado");

  // Tira "R$", espaços (inclusive não-quebrável) e qualquer coisa que não seja
  // dígito, vírgula, ponto ou sinal.
  const limpo = bruto.replace(/[^\d.,-]/g, "").trim();
  if (!limpo) throw new Error("valor vazio");

  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");

  let normalizado: string;
  if (ultimaVirgula > ultimoPonto) {
    // "1.234,56" ou "400,00" → vírgula é o decimal; pontos são milhar.
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (ultimoPonto > -1) {
    // "1,234.56" (en-US) ou "82.49" → ponto é o decimal; vírgulas são milhar.
    normalizado = limpo.replace(/,/g, "");
  } else {
    // Só dígitos: "400" = quatrocentos reais.
    normalizado = limpo;
  }

  const n = Number(normalizado);
  if (!Number.isFinite(n)) throw new Error("valor não numérico");
  return arredondaCentavos(n * 100);
}

function arredondaCentavos(centavos: number): number {
  // Math.round mata o resíduo binário de (82.49 * 100 = 8248.999...).
  const v = Math.round(centavos);
  if (v <= 0) throw new Error("valor precisa ser maior que zero");
  if (v > TETO_CENTAVOS) throw new Error("valor acima do teto plausível — confira a leitura");
  return v;
}

/** "YYYY-MM" do mês corrente em São Paulo (não em UTC — vira o mês um dia antes). */
export function mesCorrenteSP(now: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  });
  return fmt.format(now).slice(0, 7);
}

/** Valida "YYYY-MM" e devolve o intervalo semiaberto [início, fim) pra filtrar. */
export function intervaloDoMes(mes: string): { inicio: string; fim: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(mes.trim());
  if (!m) throw new Error(`mês inválido: use YYYY-MM (recebido: '${mes.slice(0, 20)}')`);
  const ano = Number(m[1]);
  const mesNum = Number(m[2]);
  if (mesNum < 1 || mesNum > 12) throw new Error(`mês inválido: ${mes}`);
  const inicio = `${m[1]}-${m[2]}-01`;
  const proxAno = mesNum === 12 ? ano + 1 : ano;
  const proxMes = mesNum === 12 ? 1 : mesNum + 1;
  const fim = `${proxAno}-${String(proxMes).padStart(2, "0")}-01`;
  return { inicio, fim };
}

function validaData(data: string): string {
  const d = data.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`data inválida: use YYYY-MM-DD (recebido: '${d.slice(0, 20)}')`);
  }
  return d;
}

/** Corta texto vindo de OCR/modelo no limite que o banco aceita. */
function limita(texto: string | undefined, max: number): string | undefined {
  if (texto === undefined) return undefined;
  const t = texto.trim();
  return t ? t.slice(0, max) : undefined;
}

function somaCentavos(linhas: DespesaRow[]): number {
  return linhas.reduce((acc, l) => acc + (l.valor_centavos ?? 0), 0);
}

// ─── API pública ────────────────────────────────────────────────────────────

export async function registrarDespesa(
  input: RegistrarDespesaInput,
  deps: DespesasDeps,
): Promise<RegistrarDespesaResult> {
  const valorCentavos = parseValorCentavos(input.valor);
  const dataDespesa = validaData(input.data);

  const estabelecimento = limita(input.estabelecimento, 200);
  if (!estabelecimento) throw new Error("estabelecimento é obrigatório");

  const inserido = await deps.inserir({
    valor_centavos: valorCentavos,
    data_despesa: dataDespesa,
    estabelecimento,
    categoria: limita(input.categoria, 80) ?? null,
    frente: limita(input.frente, 80) ?? null,
    origem_texto: limita(input.origem_texto, 2000) ?? null,
  });
  if (inserido.error) throw new Error(`despesa insert falhou: ${inserido.error.message}`);

  // Total do mês DA DESPESA — se ele manda em julho um recibo de junho, o
  // acumulado que interessa é o de junho.
  const { inicio, fim } = intervaloDoMes(dataDespesa.slice(0, 7));
  const doMes = await deps.listarMes(inicio, fim);
  const linhas = doMes.data ?? [];

  return {
    id: inserido.data?.id ?? "",
    valor_centavos: valorCentavos,
    data_despesa: dataDespesa,
    estabelecimento,
    total_mes_centavos: somaCentavos(linhas),
    qtd_mes: linhas.length,
  };
}

export async function listarDespesas(
  input: ListarDespesasInput,
  deps: DespesasDeps,
): Promise<ListarDespesasResult> {
  const mes = input.mes?.trim() || mesCorrenteSP(deps.now());
  const { inicio, fim } = intervaloDoMes(mes);

  const res = await deps.listarMes(inicio, fim);
  if (res.error) throw new Error(`despesas list falhou: ${res.error.message}`);
  const linhas = res.data ?? [];

  return {
    mes,
    total_centavos: somaCentavos(linhas),
    despesas: linhas,
    sem_frente: linhas.filter((l) => !l.frente).length,
  };
}

/**
 * Marca as pendentes do mês como fechadas. Idempotente por construção: só pega
 * `status = 'pendente'`, então fechar duas vezes não duplica nem reabre nada —
 * a segunda chamada simplesmente não acha linha.
 */
export async function fecharMesDespesas(
  input: FecharMesInput,
  deps: DespesasDeps,
): Promise<FecharMesResult> {
  const { inicio, fim } = intervaloDoMes(input.mes);

  const res = await deps.fecharMes(inicio, fim);
  if (res.error) throw new Error(`despesas fechamento falhou: ${res.error.message}`);
  const linhas = res.data ?? [];

  return {
    mes: input.mes.trim(),
    total_centavos: somaCentavos(linhas),
    qtd: linhas.length,
  };
}
