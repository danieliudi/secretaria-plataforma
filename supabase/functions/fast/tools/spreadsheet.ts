// Exportação de planilha sob demanda. O Sonnet escolhe o dataset, a tool
// busca os dados, gera CSV em memória e envia direto como documento — pelo
// CANAL que o usuário está usando (WhatsApp/Evolution ou Telegram), derivado
// do `to` (user_id).
//
// Datasets suportados:
//   - tasks:           tasks abertas de uma frente (todas as sub-listas ou uma),
//                       no gerenciador de tarefas configurado (TASK_PROVIDER)
//   - calendar_events: eventos de uma data ou range (start..end YYYY-MM-DD)
//   - despesas:        despesas de um mês (YYYY-MM) — o relatório de reembolso

import { type CsvColumn, toCsv, utf8ToBase64 } from "../../_shared/csv.ts";
import {
  defaultWhatsAppDeps,
  sendWhatsAppDocument,
  type WhatsAppDeps,
} from "../../_shared/whatsapp.ts";
import { defaultTelegramDeps, sendTelegramDocument, type TelegramDeps } from "../../_shared/telegram.ts";
import { channelFromUserId, telegramChatId } from "../../_shared/channel.ts";
import {
  type CalendarEvent,
  getEventsByDate as defaultGetEventsByDate,
} from "./calendar-read.ts";
import { getGoogleAccessToken } from "../../_shared/google-oauth.ts";
import { getTaskProvider } from "../../_shared/task-provider-factory.ts";
import type { ListTasksInput, TaskItem } from "../../_shared/task-provider.ts";
import type { DespesaRow, ListarDespesasResult } from "./despesas.ts";

export type SpreadsheetDataset = "tasks" | "calendar_events" | "despesas";

export interface ExportSpreadsheetInput {
  dataset: SpreadsheetDataset;
  frente?: string;
  list?: string;
  date?: string;
  end_date?: string;
  /** Só pra dataset 'despesas': mês YYYY-MM. */
  mes?: string;
  file_name?: string;
}

export interface ExportSpreadsheetResult {
  dataset: SpreadsheetDataset;
  file_name: string;
  rows: number;
}

export interface ExportSpreadsheetDeps {
  listTasks: (input: ListTasksInput) => Promise<TaskItem[]>;
  getEventsByDate: (date: string) => Promise<CalendarEvent[]>;
  /**
   * Despesas do mês. Injetada por quem monta as deps (fast/index.ts), porque
   * depende do tenant — este módulo não resolve tenant sozinho.
   */
  listarDespesas?: (mes: string) => Promise<ListarDespesasResult>;
  /** Envia o documento pro canal certo (derivado de `to`). `content` é o CSV cru. */
  sendDocument: (
    to: string,
    fileName: string,
    mimeType: string,
    content: string,
  ) => Promise<void>;
  now: () => Date;
}

/**
 * `env` opcional (tenant-scoped, ver _shared/tenant.ts) — sem ele, cai no
 * env global (Deno.env.get), comportamento de sempre.
 */
export function defaultExportSpreadsheetDeps(
  env: (key: string) => string | undefined = (k) => Deno.env.get(k),
): ExportSpreadsheetDeps {
  const whatsDeps: WhatsAppDeps = { ...defaultWhatsAppDeps(), env };
  const telegramDeps: TelegramDeps = { ...defaultTelegramDeps(), env };
  const getAccessToken = () => getGoogleAccessToken({ env, fetch });
  return {
    listTasks: (input) => getTaskProvider(env).listTasks(input),
    getEventsByDate: (date) => defaultGetEventsByDate(date, { getAccessToken, fetch, now: () => new Date() }),
    sendDocument: async (to, fileName, mimeType, content) => {
      if (channelFromUserId(to) === "telegram") {
        await sendTelegramDocument(
          telegramChatId(to),
          fileName,
          mimeType,
          new TextEncoder().encode(content),
          telegramDeps,
        );
      } else {
        await sendWhatsAppDocument(
          to,
          { fileName, mimeType, base64: utf8ToBase64(content) },
          whatsDeps,
        );
      }
    },
    now: () => new Date(),
  };
}

const TASK_COLUMNS: CsvColumn<TaskItem>[] = [
  { label: "List", pick: (t) => t.list ?? "" },
  { label: "Task", pick: (t) => t.name },
  { label: "Status", pick: (t) => t.status },
  {
    label: "Prazo",
    pick: (t) =>
      t.due_date
        ? new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Sao_Paulo",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(new Date(t.due_date))
        : "",
  },
  { label: "URL", pick: (t) => t.url },
];

const CALENDAR_COLUMNS: CsvColumn<CalendarEvent & { date: string }>[] = [
  { label: "Data", pick: (e) => e.date },
  { label: "Hora", pick: (e) => e.time ?? "(dia inteiro)" },
  { label: "Evento", pick: (e) => e.title },
  { label: "Local", pick: (e) => e.location ?? "" },
];

/**
 * Valor volta pra reais com VÍRGULA decimal — é o que Excel/Sheets em pt-BR
 * entende como número. Ponto decimal aqui vira texto na planilha e quebra a
 * soma, que é justamente pra que o arquivo existe.
 */
function centavosParaReais(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

function dataBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const DESPESA_COLUMNS: CsvColumn<DespesaRow>[] = [
  { label: "Data", pick: (d) => dataBR(d.data_despesa) },
  { label: "Estabelecimento", pick: (d) => d.estabelecimento },
  { label: "Valor (R$)", pick: (d) => centavosParaReais(d.valor_centavos) },
  { label: "Categoria", pick: (d) => d.categoria ?? "" },
  { label: "Frente", pick: (d) => d.frente ?? "" },
  { label: "Status", pick: (d) => d.status },
];

function timestampSlug(now: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(now).replace(/[-,:\s]/g, "");
}

function rangeDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  while (cur.getTime() <= stop.getTime()) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export async function exportSpreadsheet(
  input: ExportSpreadsheetInput,
  to: string,
  deps: ExportSpreadsheetDeps = defaultExportSpreadsheetDeps(),
): Promise<ExportSpreadsheetResult> {
  const slug = timestampSlug(deps.now());

  if (input.dataset === "tasks") {
    if (!input.frente) throw new Error("frente é obrigatório para tasks");
    const tasks = await deps.listTasks({
      frente: input.frente,
      list: input.list,
    });
    const csv = toCsv(tasks, TASK_COLUMNS);
    const fileName = input.file_name ??
      `tasks-${input.frente}${input.list ? `-${input.list}` : ""}-${slug}.csv`
        .replace(/\s+/g, "_");
    await deps.sendDocument(to, fileName, "text/csv; charset=utf-8", csv);
    return { dataset: "tasks", file_name: fileName, rows: tasks.length };
  }

  if (input.dataset === "calendar_events") {
    if (!input.date) throw new Error("date é obrigatório para calendar_events");
    const dates = input.end_date
      ? rangeDates(input.date, input.end_date)
      : [input.date];
    const batches = await Promise.all(
      dates.map(async (d) => {
        const events = await deps.getEventsByDate(d);
        return events.map((e) => ({ ...e, date: d }));
      }),
    );
    const flat = batches.flat();
    const csv = toCsv(flat, CALENDAR_COLUMNS);
    const range = input.end_date ? `${input.date}_a_${input.end_date}` : input.date;
    const fileName = input.file_name ?? `agenda-${range}-${slug}.csv`;
    await deps.sendDocument(to, fileName, "text/csv; charset=utf-8", csv);
    return { dataset: "calendar_events", file_name: fileName, rows: flat.length };
  }

  if (input.dataset === "despesas") {
    if (!input.mes) throw new Error("mes (YYYY-MM) é obrigatório para despesas");
    if (!deps.listarDespesas) throw new Error("despesas indisponível: tenant não resolvido");

    const { despesas, total_centavos } = await deps.listarDespesas(input.mes);
    // Linha de total no fim — é a primeira coisa que alguém procura num
    // relatório de reembolso, e evita a pessoa somar na mão de novo.
    const linhas: DespesaRow[] = [
      ...despesas,
      {
        id: "",
        data_despesa: "",
        estabelecimento: "TOTAL",
        valor_centavos: total_centavos,
        categoria: null,
        frente: null,
        status: "",
      },
    ];
    const csv = toCsv(linhas, DESPESA_COLUMNS);
    const fileName = input.file_name ?? `reembolso-${input.mes}.csv`;
    await deps.sendDocument(to, fileName, "text/csv; charset=utf-8", csv);
    return { dataset: "despesas", file_name: fileName, rows: despesas.length };
  }

  throw new Error(`dataset desconhecido: '${input.dataset}'`);
}
