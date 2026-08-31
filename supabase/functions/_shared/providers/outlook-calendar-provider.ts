// Outlook Calendar — leitura e escrita de eventos via Microsoft Graph. Mesmo
// contrato público (CalendarEvent/CalendarAttendee/CreateEventInput/
// CreatedEvent/UpdateEventInput) de ../../fast/tools/calendar-read.ts e
// calendar-write.ts — quem chama troca só as deps (ver fast/index.ts,
// resolução por CALENDAR_MAIL_PROVIDER). Um arquivo só (não split read/write
// como o lado Google) porque as duas metades compartilham o cache do
// "e-mail do próprio dono" usado em mapAttendees — ver meEmailCache.
//
// Auth: getMicrosoftAccessToken() em ../microsoft-oauth.ts — mesma troca de
// refresh_token → access_token já usada pelo Microsoft To Do.
//
// Escopo desta entrega: só o que fast/index.ts liga nas tools de conversa
// (getNextEvents, getEventsByDate, createEvent, deleteEvent, updateEvent).
// getEventsBetween (usado só pelo cron, relacionamento_esfriando) fica de
// fora de propósito — o cron ainda não resolve Google-vs-Outlook por tenant
// (task pendente separada, unificação de leitura de Calendar).
//
// API refs:
//   https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview
//   https://learn.microsoft.com/en-us/graph/api/user-post-events
//   https://learn.microsoft.com/en-us/graph/api/event-update
//   https://learn.microsoft.com/en-us/graph/api/event-delete

import { defaultMicrosoftOAuthDeps, getMicrosoftAccessToken } from "../microsoft-oauth.ts";
import type {
  EventoRemovido,
} from "../../fast/tools/calendar-write.ts";
import type { MicrosoftOAuthDeps } from "../microsoft-oauth.ts";
import { fetchComRetry } from "../http-retry.ts";
import type { CalendarAttendee, CalendarEvent, RespostaConvite } from "../../fast/tools/calendar-read.ts";
import type { CreatedEvent, CreateEventInput, UpdateEventInput } from "../../fast/tools/calendar-write.ts";

export type { CalendarAttendee, CalendarEvent, CreatedEvent, CreateEventInput, RespostaConvite, UpdateEventInput };

const GRAPH_ME = "https://graph.microsoft.com/v1.0/me";
const TIMEZONE = "America/Sao_Paulo";
// SP é UTC-3 fixo desde 2019 (sem horário de verão) — mesma constante do lado Google.
const SP_OFFSET = "-03:00";

export interface OutlookCalendarDeps {
  getAccessToken: () => Promise<string>;
  fetch: typeof fetch;
  now: () => Date;
}

export function defaultOutlookCalendarDeps(): OutlookCalendarDeps {
  return {
    getAccessToken: () => getMicrosoftAccessToken(defaultMicrosoftOAuthDeps()),
    fetch,
    now: () => new Date(),
  };
}

/** Igual defaultOutlookCalendarDeps, mas aceitando um `env` tenant-scoped (mesmo padrão do fast/index.ts). */
export function outlookCalendarDepsFromEnv(
  env: MicrosoftOAuthDeps["env"],
  fetchFn: typeof fetch = fetch,
): OutlookCalendarDeps {
  return {
    getAccessToken: () => getMicrosoftAccessToken({ env, fetch: fetchFn }),
    fetch: fetchFn,
    now: () => new Date(),
  };
}

// ─── "quem sou eu" — pra marcar CalendarAttendee.eu, mesmo espírito do `self` do Google ──
//
// Graph não marca isso na resposta de evento (ao contrário do Google, que já
// devolve `self: true` no attendee certo) — precisa saber o próprio endereço
// pra comparar. Cacheado por access_token: 1 chamada extra na primeira
// consulta do isolate, não em toda listagem.
const meEmailCache = new Map<string, string>();

async function getMeEmail(token: string, fetchFn: typeof fetch): Promise<string> {
  const cached = meEmailCache.get(token);
  if (cached) return cached;

  const res = await fetchComRetry(
    `${GRAPH_ME}?$select=mail,userPrincipalName`,
    { headers: { Authorization: `Bearer ${token}` } },
    fetchFn,
  );
  if (!res.ok) {
    // Não crítico o bastante pra derrubar a listagem inteira — sem e-mail
    // próprio, `eu` fica sempre false (comportamento seguro: no pior caso,
    // alguém vê "você" listado como não-confirmado, nunca o contrário).
    console.error(`[outlook-calendar] GET /me falhou: ${res.status}`);
    return "";
  }
  const data = (await res.json()) as { mail?: string; userPrincipalName?: string };
  const email = (data.mail || data.userPrincipalName || "").toLowerCase();
  meEmailCache.set(token, email);
  return email;
}

// ─── tipos internos da Graph API (subset que usamos) ─────────────────────────

interface GraphDateTimeTimeZone {
  dateTime: string; // sem offset — a hora JÁ VEM no fuso pedido via header Prefer
  timeZone: string;
}

interface GraphAttendee {
  emailAddress?: { name?: string; address?: string };
  status?: { response?: string };
  type?: "required" | "optional" | "resource";
}

interface GraphEvent {
  id: string;
  webLink: string;
  subject?: string;
  location?: { displayName?: string };
  start: GraphDateTimeTimeZone;
  end: GraphDateTimeTimeZone;
  attendees?: GraphAttendee[];
  /** Evento de dia inteiro — start/end vêm em meia-noite; CalendarEvent.time tem que virar null nesse caso (mesmo contrato do lado Google), não "00:00". */
  isAllDay?: boolean;
}

interface GraphListResponse {
  value?: GraphEvent[];
  "@odata.nextLink"?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatTimeInSP(isoLocal: string): string {
  // Já vem no fuso de SP (header Prefer: outlook.timezone) — só recorta HH:MM.
  const match = /T(\d{2}:\d{2})/.exec(isoLocal);
  return match ? match[1] : "";
}

function toStartISO(start: GraphDateTimeTimeZone): string {
  // dateTime do Graph vem sem offset (ex: "2026-08-26T14:00:00.0000000") —
  // acrescenta o offset de SP explicitamente, já que pedimos o evento nesse
  // fuso via Prefer. Corta o excesso de dígitos de fração de segundo.
  const semFracaoExtra = start.dateTime.replace(/(\.\d{3})\d*$/, "$1");
  const comSegundos = /:\d{2}(\.\d+)?$/.test(semFracaoExtra) ? semFracaoExtra : `${semFracaoExtra}:00`;
  return `${comSegundos}${SP_OFFSET}`;
}

function mapResposta(status: string | undefined): RespostaConvite {
  switch (status) {
    case "accepted":
      return "aceito";
    case "declined":
      return "recusou";
    case "tentativelyAccepted":
      return "talvez";
    default:
      // Inclui "none"/"notResponded"/"organizer" e qualquer valor novo — cair
      // em "sem_resposta" é o lado seguro (mesmo raciocínio do lado Google).
      return "sem_resposta";
  }
}

function mapAttendees(lista: GraphAttendee[] | undefined, meEmail: string): CalendarAttendee[] {
  if (!lista) return [];
  return lista
    // Sala/equipamento entra como attendee tipo "resource" — ninguém cobra
    // confirmação de uma sala de reunião (mesmo filtro do lado Google).
    .filter((a) => a.type !== "resource" && !!a.emailAddress?.address)
    .map((a) => {
      const email = a.emailAddress!.address!;
      return {
        email,
        nome: a.emailAddress!.name ?? null,
        resposta: mapResposta(a.status?.response),
        eu: !!meEmail && email.toLowerCase() === meEmail,
      };
    });
}

function mapEvent(e: GraphEvent, meEmail: string): CalendarEvent {
  const startISO = toStartISO(e.start);
  return {
    id: e.id,
    time: e.isAllDay ? null : formatTimeInSP(startISO),
    startISO,
    // Dia inteiro não tem fim com hora — mesma convenção do leitor do Google,
    // que devolve null quando o evento não tem `end.dateTime`. Quem calcula
    // carga de agenda filtra por esse null.
    endISO: e.isAllDay ? null : toStartISO(e.end),
    // O Graph tem `seriesMasterId`, mas o leitor de Outlook ainda não pede o
    // campo — devolver null é honesto: quem consome trata como evento avulso e
    // não promete distinguir ocorrência de série onde não sabe.
    recurringEventId: null,
    title: e.subject ?? "(sem título)",
    location: e.location?.displayName ?? null,
    attendees: mapAttendees(e.attendees, meEmail),
  };
}

async function listCalendarView(
  startISO: string,
  endISO: string,
  deps: OutlookCalendarDeps,
  { top }: { top?: number } = {},
): Promise<CalendarEvent[]> {
  const token = await deps.getAccessToken();
  const meEmail = await getMeEmail(token, deps.fetch);

  const url = new URL(`${GRAPH_ME}/calendarView`);
  url.searchParams.set("startDateTime", startISO);
  url.searchParams.set("endDateTime", endISO);
  url.searchParams.set("$orderby", "start/dateTime");
  url.searchParams.set(
    "$select",
    "subject,location,start,end,attendees,webLink,isAllDay",
  );
  if (top) url.searchParams.set("$top", String(top));

  const eventos: CalendarEvent[] = [];
  let nextUrl: string | undefined = url.toString();

  // getNextEvents já limita com $top (uma página resolve); getEventsByDate é
  // uma janela de 1 dia — segue @odata.nextLink mesmo assim por segurança,
  // mesmo raciocínio do lado Google pra getEventsBetween.
  while (nextUrl) {
    const res: Response = await fetchComRetry(
      nextUrl,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ConsistencyLevel: "eventual",
          // Devolve start/end JÁ no fuso de SP — evita reimplementar conversão de fuso aqui.
          Prefer: `outlook.timezone="${TIMEZONE}"`,
        },
      },
      deps.fetch,
    );
    if (!res.ok) {
      throw new Error(`Outlook calendarView failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as GraphListResponse;
    eventos.push(...(data.value ?? []).map((e) => mapEvent(e, meEmail)));
    nextUrl = top ? undefined : data["@odata.nextLink"];
  }

  return eventos;
}

// ─── API pública — leitura ───────────────────────────────────────────────────

/**
 * Próximos `n` eventos a partir de agora, ordenados por hora de início.
 * `n <= 0` retorna [] sem chamar a API.
 */
export async function getNextEvents(
  n: number,
  deps: OutlookCalendarDeps = defaultOutlookCalendarDeps(),
): Promise<CalendarEvent[]> {
  if (n <= 0) return [];
  // calendarView não tem um "próximos N sem data final" — usa uma janela
  // larga (1 ano) e corta em N do lado cliente, igual o efeito de $top aqui
  // sozinho não bastaria pra garantir ORDEM certa numa API que pagina.
  const de = deps.now();
  const ate = new Date(de.getTime() + 365 * 24 * 60 * 60_000);
  const eventos = await listCalendarView(de.toISOString(), ate.toISOString(), deps, { top: n });
  return eventos.slice(0, n);
}

/**
 * Eventos de um dia específico (YYYY-MM-DD), no fuso de SP, ordenados por hora.
 */
export async function getEventsByDate(
  dateYYYYMMDD: string,
  deps: OutlookCalendarDeps = defaultOutlookCalendarDeps(),
): Promise<CalendarEvent[]> {
  return listCalendarView(
    `${dateYYYYMMDD}T00:00:00${SP_OFFSET}`,
    `${dateYYYYMMDD}T23:59:59${SP_OFFSET}`,
    deps,
  );
}

// ─── API pública — escrita ────────────────────────────────────────────────────

function mapCreatedEvent(data: GraphEvent, fallbackTitle: string, fallbackStart: string, fallbackEnd: string): CreatedEvent {
  // toStartISO (não concatenação nua de SP_OFFSET) — só é seguro assumir que
  // data.start/end.dateTime já vem em horário local de SP porque create/
  // update mandam o header Prefer: outlook.timezone (ver createEvent/
  // updateEvent); sem ele o Graph devolve em UTC e a resposta confirmada ao
  // usuário sairia 3h errada (achado de revisão adversarial, 26/08/2026).
  return {
    id: data.id,
    htmlLink: data.webLink,
    title: data.subject ?? fallbackTitle,
    start: data.start?.dateTime ? toStartISO(data.start) : fallbackStart,
    end: data.end?.dateTime ? toStartISO(data.end) : fallbackEnd,
  };
}

/**
 * Cria um evento no calendar padrão do tenant.
 * Lança Error com status + body em qualquer falha HTTP.
 */
export async function createEvent(
  input: CreateEventInput,
  deps: OutlookCalendarDeps = defaultOutlookCalendarDeps(),
): Promise<CreatedEvent> {
  const token = await deps.getAccessToken();

  const body = {
    subject: input.title,
    start: { dateTime: input.start, timeZone: TIMEZONE },
    end: { dateTime: input.end, timeZone: TIMEZONE },
    ...(input.description ? { body: { contentType: "text", content: input.description } } : {}),
    ...(input.location ? { location: { displayName: input.location } } : {}),
  };

  const res = await fetchComRetry(
    `${GRAPH_ME}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Sem isto, a RESPOSTA volta em UTC mesmo com timeZone certo no
        // corpo do POST — o evento em si fica correto, mas o horário
        // confirmado ao usuário sairia errado (ver mapCreatedEvent).
        Prefer: `outlook.timezone="${TIMEZONE}"`,
      },
      body: JSON.stringify(body),
    },
    deps.fetch,
  );
  if (!res.ok) {
    throw new Error(`Outlook event create failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GraphEvent;
  return mapCreatedEvent(data, input.title, input.start, input.end);
}

/**
 * Remove um evento (mesmo token tenant-scoped de createEvent).
 * 404 (evento já removido antes) é tratado como sucesso — idempotente, mesmo
 * raciocínio do 410 no lado Google.
 */
/**
 * Mesma disciplina do lado Google (ver calendar-write.ts): lê o título antes,
 * apaga, e CONFIRMA que sumiu. Um "ok" não verificado foi o que deixou a
 * secretária dizer "Cancelado 👍" sobre um evento que continuou na agenda.
 */
export async function deleteEvent(
  eventId: string,
  deps: OutlookCalendarDeps = defaultOutlookCalendarDeps(),
): Promise<EventoRemovido> {
  const token = await deps.getAccessToken();
  const url = `${GRAPH_ME}/events/${encodeURIComponent(eventId)}`;
  const auth = { Authorization: `Bearer ${token}` };

  const antes = await fetchComRetry(url, { headers: auth }, deps.fetch);
  const titulo = antes.ok
    ? ((await antes.json()) as { subject?: string }).subject ?? "(sem título)"
    : null;

  const res = await fetchComRetry(url, { method: "DELETE", headers: auth }, deps.fetch);
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Outlook event delete failed: ${res.status} ${await res.text()}`);
  }

  const depois = await fetchComRetry(url, { headers: auth }, deps.fetch);
  if (depois.ok) {
    throw new Error(
      `O evento continua na agenda depois do delete (id ${eventId}). NÃO diga que cancelou.`,
    );
  }

  return { id: eventId, titulo };
}

/**
 * Atualiza campos de um evento existente (PATCH — só manda o que muda).
 * Lança Error com status + body em qualquer falha HTTP.
 */
export async function updateEvent(
  eventId: string,
  input: UpdateEventInput,
  deps: OutlookCalendarDeps = defaultOutlookCalendarDeps(),
): Promise<CreatedEvent> {
  const token = await deps.getAccessToken();

  const body = {
    ...(input.title !== undefined ? { subject: input.title } : {}),
    ...(input.start !== undefined ? { start: { dateTime: input.start, timeZone: TIMEZONE } } : {}),
    ...(input.end !== undefined ? { end: { dateTime: input.end, timeZone: TIMEZONE } } : {}),
    ...(input.description !== undefined ? { body: { contentType: "text", content: input.description } } : {}),
    ...(input.location !== undefined ? { location: { displayName: input.location } } : {}),
  };

  const res = await fetchComRetry(
    `${GRAPH_ME}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Mesmo motivo do createEvent — sem isto a resposta volta em UTC.
        Prefer: `outlook.timezone="${TIMEZONE}"`,
      },
      body: JSON.stringify(body),
    },
    deps.fetch,
  );
  if (!res.ok) {
    throw new Error(`Outlook event update failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GraphEvent;
  return mapCreatedEvent(data, "(sem título)", input.start ?? "", input.end ?? "");
}
