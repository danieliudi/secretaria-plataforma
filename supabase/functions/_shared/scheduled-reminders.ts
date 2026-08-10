// Lembretes agendados pelo Daniel via tool `schedule_reminder` (2G).
// O fast cria registros aqui; o cron (`task: scheduled`) varre e envia.
//
// Schema:
//   scheduled_reminders {
//     id uuid, user_id text, fire_at timestamptz, text text,
//     recurrence text NULL, sent_at timestamptz NULL, created_at timestamptz
//   }
//
// fire_at é guardado em UTC (ISO 8601 com offset); o modelo manda no fuso
// dele (-03:00 SP) e o Postgres converte. A varredura do cron compara com
// now() do servidor, então a janela de tolerância é cron-period (~5min).
//
// Recorrência (2H): quando `recurrence` está setado, o cron — depois de
// entregar e marcar sent_at — insere uma NOVA linha pendente com o próximo
// fire_at (nextOccurrence). O histórico fica preservado (uma linha por
// disparo); não há "edição in-place" da mesma linha.
//
// Anti-duplicata (2H): antes de criar, se já existir um lembrete PENDENTE
// pro mesmo usuário dentro de ±90min do horário pedido, devolve um conflito
// em vez de criar — o Daniel pediu o mesmo lembrete duas vezes em mensagens
// próximas mais de uma vez (não é bug de webhook, é esquecimento/reforço
// típico de quem já perguntou e não lembra da resposta). confirm_duplicate
// força a criação mesmo com conflito.

import { getSupabaseClient } from "./supabase.ts";

export type RecurrenceType = "daily" | "weekly" | "monthly_first_business_day";

export interface ScheduledReminder {
  id: string;
  user_id: string;
  fire_at: string;
  text: string;
  recurrence?: RecurrenceType | null;
}

type InsertRow = {
  user_id: string;
  tenant_id: string;
  fire_at: string;
  text: string;
  recurrence: RecurrenceType | null;
};

type UpdateSentRow = { sent_at: string };

export interface ScheduledReminderDeps {
  insert: (
    row: InsertRow,
  ) => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  loadPending: (
    nowISO: string,
  ) => Promise<ScheduledReminder[]>;
  loadSimilarPending: (
    userId: string,
    fromISO: string,
    toISO: string,
  ) => Promise<ScheduledReminder[]>;
  markSent: (
    id: string,
    row: UpdateSentRow,
  ) => Promise<{ error: { message: string } | null }>;
}

export function defaultScheduledReminderDeps(): ScheduledReminderDeps {
  return {
    insert: async (row) => {
      const { data, error } = await getSupabaseClient()
        .from("scheduled_reminders")
        .insert(row)
        .select("id")
        .single();
      return {
        data: (data as { id: string } | null),
        error: error as { message: string } | null,
      };
    },
    loadPending: async (nowISO) => {
      const { data, error } = await getSupabaseClient()
        .from("scheduled_reminders")
        .select("id, user_id, fire_at, text, recurrence")
        .lte("fire_at", nowISO)
        .is("sent_at", null)
        .order("fire_at", { ascending: true })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as ScheduledReminder[];
    },
    loadSimilarPending: async (userId, fromISO, toISO) => {
      const { data, error } = await getSupabaseClient()
        .from("scheduled_reminders")
        .select("id, user_id, fire_at, text, recurrence")
        .eq("user_id", userId)
        .is("sent_at", null)
        .gte("fire_at", fromISO)
        .lte("fire_at", toISO);
      if (error) throw new Error(error.message);
      return (data ?? []) as ScheduledReminder[];
    },
    markSent: async (id, row) => {
      const { error } = await getSupabaseClient()
        .from("scheduled_reminders")
        .update(row)
        .eq("id", id);
      return { error: error as { message: string } | null };
    },
  };
}

// Janela de tolerância pra considerar dois lembretes "parecidos": mesmo
// usuário, horários dentro de ±90min um do outro.
const DUPLICATE_WINDOW_MS = 90 * 60_000;

export interface CreateReminderInput {
  /** ISO 8601 com offset. Sonnet deve calcular a partir da "hoje" no system prompt. */
  fire_at: string;
  text: string;
  /** (opcional) Repete automaticamente após cada disparo. */
  recurrence?: RecurrenceType;
  /** true quando o Daniel já confirmou criar mesmo havendo lembrete parecido pendente. */
  confirm_duplicate?: boolean;
}

export interface CreatedReminder {
  id: string;
  fire_at: string;
  text: string;
  recurrence?: RecurrenceType | null;
}

export type ScheduleResult =
  | { created: true; reminder: CreatedReminder }
  | { created: false; conflict: ScheduledReminder[] };

/**
 * Cria um lembrete agendado. Recusa fire_at no passado ou texto vazio — o
 * executeTool no fast traduz o throw em {error} pro modelo. Se já existir um
 * lembrete pendente parecido (±90min) e confirm_duplicate não foi setado,
 * devolve { created: false, conflict } em vez de criar.
 */
// `tenantId` é obrigatório: o cron entrega os lembretes filtrando por ele.
// Gravar sem dono faz o lembrete nunca disparar — e some em silêncio, porque
// ninguém reclama de uma mensagem que não chegou.
export async function createScheduledReminder(
  userId: string,
  input: CreateReminderInput,
  tenantId: string,
  deps: ScheduledReminderDeps = defaultScheduledReminderDeps(),
  now: Date = new Date(),
): Promise<ScheduleResult> {
  if (!tenantId) throw new Error("scheduled_reminders: tenantId obrigatório");
  const text = input.text.trim();
  if (!text) throw new Error("text vazio");

  const fireAt = new Date(input.fire_at);
  if (isNaN(fireAt.getTime())) {
    throw new Error(`fire_at inválido: '${input.fire_at}'`);
  }
  // Tolerância pequena pra latência de relógio — 60s no passado ainda passa.
  if (fireAt.getTime() < now.getTime() - 60_000) {
    throw new Error("fire_at está no passado");
  }

  if (!input.confirm_duplicate) {
    const similar = await deps.loadSimilarPending(
      userId,
      new Date(fireAt.getTime() - DUPLICATE_WINDOW_MS).toISOString(),
      new Date(fireAt.getTime() + DUPLICATE_WINDOW_MS).toISOString(),
    );
    if (similar.length > 0) {
      return { created: false, conflict: similar };
    }
  }

  const result = await deps.insert({
    user_id: userId,
    tenant_id: tenantId,
    fire_at: fireAt.toISOString(),
    text,
    recurrence: input.recurrence ?? null,
  });
  if (result.error) {
    throw new Error(`scheduled_reminders insert falhou: ${result.error.message}`);
  }
  if (!result.data) throw new Error("scheduled_reminders insert sem id");

  return {
    created: true,
    reminder: {
      id: result.data.id,
      fire_at: fireAt.toISOString(),
      text,
      recurrence: input.recurrence ?? null,
    },
  };
}

// ─── Recorrência: cálculo do próximo disparo ────────────────────────────────
// América/Sao_Paulo é UTC-3 fixo (sem horário de verão desde 2019) — mesma
// premissa usada no resto do código (ver fast.ts, cron/index.ts).
const SP_OFFSET_HOURS = 3;

function spParts(
  d: Date,
): { y: number; mo: number; day: number; h: number; mi: number; s: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    day: Number(parts.day),
    h: Number(parts.hour === "24" ? "0" : parts.hour),
    mi: Number(parts.minute),
    s: Number(parts.second),
  };
}

function spToUtc(y: number, mo: number, day: number, h: number, mi: number, s: number): Date {
  return new Date(Date.UTC(y, mo - 1, day, h + SP_OFFSET_HOURS, mi, s));
}

// Dia (1-31) do 1º dia útil (seg-sex) do mês. Dia-da-semana de uma data de
// calendário independe de timezone — UTC serve só pra achar o weekday.
function firstBusinessDayOfMonth(y: number, mo: number): number {
  let day = 1;
  while (true) {
    const weekday = new Date(Date.UTC(y, mo - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return day;
    day++;
  }
}

/** Calcula o próximo fire_at a partir do atual, conforme o tipo de recorrência. */
export function nextOccurrence(current: Date, recurrence: RecurrenceType): Date {
  if (recurrence === "daily") return new Date(current.getTime() + 24 * 3600_000);
  if (recurrence === "weekly") return new Date(current.getTime() + 7 * 24 * 3600_000);

  // monthly_first_business_day: mesmo horário, no 1º dia útil do mês seguinte.
  const { y, mo, h, mi, s } = spParts(current);
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextY = mo === 12 ? y + 1 : y;
  const day = firstBusinessDayOfMonth(nextY, nextMo);
  return spToUtc(nextY, nextMo, day, h, mi, s);
}
