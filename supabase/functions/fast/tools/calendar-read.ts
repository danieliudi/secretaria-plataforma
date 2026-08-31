// Google Calendar — leitura de eventos. Chamada direta na API v3, fetch nativo.
// Token vem de getGoogleAccessToken(), que já cacheia em memória (ver
// _shared/google-oauth.ts).
//
// API ref: https://developers.google.com/calendar/api/v3/reference/events/list

import { getGoogleAccessToken } from "../../_shared/google-oauth.ts";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TIMEZONE = "America/Sao_Paulo";
// SP é UTC-3 fixo desde 2019 (sem horário de verão). Usado em getEventsByDate.
const SP_OFFSET = "-03:00";

/** Como um convidado respondeu ao convite. */
export type RespostaConvite = "aceito" | "recusou" | "talvez" | "sem_resposta";

export interface CalendarAttendee {
  email: string;
  /** displayName quando o Google tem; senão null. */
  nome: string | null;
  resposta: RespostaConvite;
  /** true quando é o próprio dono do calendário (o Google marca com `self`). */
  eu: boolean;
}

export interface CalendarEvent {
  /** ID do evento na Calendar API — necessário pra delete_event/update_event. */
  id: string;
  /** "HH:MM" no fuso de SP. `null` para eventos de dia inteiro. */
  time: string | null;
  /**
   * Início em ISO — `dateTime` quando o evento tem horário, ou a meia-noite
   * (SP) de `date` pra evento de dia inteiro. Usado por rotinas que precisam
   * saber QUANDO o evento foi/será, não só a hora do dia (ex: última reunião
   * com alguém, dentro de uma janela que olha meses pra trás).
   */
  startISO: string;
  /**
   * Fim em ISO, quando o evento tem horário. `null` em evento de dia inteiro.
   *
   * Existe pra análise de CARGA de agenda (maratona de reuniões, dia pesado) —
   * ver _shared/agenda-analise.ts. Sem o fim não dá pra saber quanto tempo o
   * dia realmente consome.
   */
  endISO: string | null;
  title: string;
  location: string | null;
  /**
   * Convidados, pro bloco proativo de confirmação ("ninguém confirmou as 14h").
   * Vazio quando o evento não tem convidado — que é o caso da maioria.
   *
   * Não custa chamada extra: não usamos `fields` na listagem, então o Google já
   * mandava isto e a gente descartava.
   */
  attendees: CalendarAttendee[];
  /**
   * Quando este evento é UMA OCORRÊNCIA de um evento repetido, o id da série.
   * `null` em evento avulso.
   *
   * Existe por causa de um erro real (31/08/2026): o Daniel pediu "cancela o
   * alinhamento" sobre uma reunião que se repetia todo dia útil até dezembro,
   * e "o alinhamento" tinha duas leituras possíveis — aquela quarta, ou a
   * série inteira. Sem este campo a secretária não tem nem como saber que a
   * pergunta existe, e escolhe sozinha uma coisa irreversível.
   *
   * Vem de graça: o Google já manda `recurringEventId` quando a listagem usa
   * `singleEvents=true`, que é o caso de todas as nossas.
   */
  recurringEventId: string | null;
}

export interface CalendarReadDeps {
  getAccessToken: () => Promise<string>;
  fetch: typeof fetch;
  now: () => Date;
}

export function defaultCalendarReadDeps(): CalendarReadDeps {
  return {
    getAccessToken: () => getGoogleAccessToken(),
    fetch,
    now: () => new Date(),
  };
}

// ─── tipos internos da Calendar API (subset que usamos) ──────────────────────

interface GCalEventTime {
  dateTime?: string; // ISO com offset, eventos com horário
  date?: string; // YYYY-MM-DD, eventos de dia inteiro
  timeZone?: string;
}

interface GCalAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  resource?: boolean;
}

interface GCalEvent {
  id: string;
  summary?: string;
  location?: string;
  start: GCalEventTime;
  end: GCalEventTime;
  attendees?: GCalAttendee[];
  /** Só presente quando o evento é ocorrência de uma série. */
  recurringEventId?: string;
}

interface GCalListResponse {
  items?: GCalEvent[];
  nextPageToken?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatTimeInSP(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Traduz o `responseStatus` do Google. Valor desconhecido vira "sem_resposta". */
function mapResposta(status: string | undefined): RespostaConvite {
  switch (status) {
    case "accepted":
      return "aceito";
    case "declined":
      return "recusou";
    case "tentative":
      return "talvez";
    default:
      // Inclui "needsAction" e qualquer status novo que o Google invente. Cair
      // em "sem_resposta" é o lado seguro: no máximo sugere confirmar algo que
      // já estava confirmado, em vez de calar sobre o que não está.
      return "sem_resposta";
  }
}

function mapAttendees(lista: GCalAttendee[] | undefined): CalendarAttendee[] {
  if (!lista) return [];
  return lista
    // Sala e equipamento entram como convidado no Google (`resource: true`).
    // Ninguém cobra confirmação de uma sala de reunião.
    .filter((a) => !a.resource && typeof a.email === "string" && a.email !== "")
    .map((a) => ({
      email: a.email!,
      nome: a.displayName ?? null,
      resposta: mapResposta(a.responseStatus),
      eu: a.self === true,
    }));
}

function mapEvent(e: GCalEvent): CalendarEvent {
  return {
    id: e.id,
    time: e.start.dateTime ? formatTimeInSP(e.start.dateTime) : null,
    startISO: e.start.dateTime ?? `${e.start.date}T00:00:00${SP_OFFSET}`,
    endISO: e.end?.dateTime ?? null,
    title: e.summary ?? "(sem título)",
    location: e.location ?? null,
    attendees: mapAttendees(e.attendees),
    recurringEventId: e.recurringEventId ?? null,
  };
}

async function listEvents(
  params: Record<string, string>,
  deps: CalendarReadDeps,
): Promise<CalendarEvent[]> {
  const token = await deps.getAccessToken();
  const eventos: CalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(CALENDAR_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await deps.fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Calendar list failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as GCalListResponse;
    eventos.push(...(data.items ?? []).map(mapEvent));

    // `maxResults` explícito (getNextEvents) significa "só quero N no total"
    // — não seguir paginação nesse caso, uma página já basta. Sem
    // `maxResults` (getEventsBetween/getEventsByDate), a página default do
    // Google é 250 itens — sem seguir `nextPageToken`, uma janela com mais de
    // 250 eventos perderia o excedente em silêncio.
    pageToken = params.maxResults ? undefined : data.nextPageToken;
  } while (pageToken);

  return eventos;
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Próximos `n` eventos a partir de agora, ordenados por hora de início.
 * `n <= 0` retorna [] sem chamar a API.
 */
export async function getNextEvents(
  n: number,
  deps: CalendarReadDeps = defaultCalendarReadDeps(),
): Promise<CalendarEvent[]> {
  if (n <= 0) return [];
  return listEvents(
    {
      timeMin: deps.now().toISOString(),
      maxResults: String(n),
      singleEvents: "true",
      orderBy: "startTime",
    },
    deps,
  );
}

/**
 * Eventos entre dois instantes ISO quaisquer (passado incluso), COM
 * attendees — diferente de getNextEvents/getEventsByDate, que são pensados
 * pro futuro. Usada por rotinas proativas que precisam olhar pra trás (ex:
 * quando foi a última reunião com alguém), não só pra frente.
 */
export async function getEventsBetween(
  deISO: string,
  ateISO: string,
  deps: CalendarReadDeps = defaultCalendarReadDeps(),
): Promise<CalendarEvent[]> {
  return listEvents(
    { timeMin: deISO, timeMax: ateISO, singleEvents: "true", orderBy: "startTime" },
    deps,
  );
}

/**
 * Eventos de um dia específico (YYYY-MM-DD), no fuso de SP, ordenados por hora.
 */
export async function getEventsByDate(
  dateYYYYMMDD: string,
  deps: CalendarReadDeps = defaultCalendarReadDeps(),
): Promise<CalendarEvent[]> {
  return listEvents(
    {
      timeMin: `${dateYYYYMMDD}T00:00:00${SP_OFFSET}`,
      timeMax: `${dateYYYYMMDD}T23:59:59${SP_OFFSET}`,
      singleEvents: "true",
      orderBy: "startTime",
    },
    deps,
  );
}
