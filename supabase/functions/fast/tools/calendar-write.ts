// Google Calendar — criação, edição e remoção de eventos. Chamadas diretas na
// API v3 com fetch nativo. Token trocado por chamada (sem cache, igual
// calendar-read.ts).
//
// API ref: https://developers.google.com/calendar/api/v3/reference/events

import { getGoogleAccessToken } from "../../_shared/google-oauth.ts";

const CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const CALENDAR_INSERT_URL = CALENDAR_EVENTS_URL;
const TIMEZONE = "America/Sao_Paulo";

export interface CreateEventInput {
  /** Título do evento. */
  title: string;
  /** Início em ISO 8601 com offset (ex: "2026-06-03T14:00:00-03:00"). */
  start: string;
  /** Fim em ISO 8601 com offset. */
  end: string;
  /** Descrição/notas opcionais. */
  description?: string;
  /** Local opcional. */
  location?: string;
}

export interface CreatedEvent {
  id: string;
  htmlLink: string;
  title: string;
  start: string;
  end: string;
}

export interface UpdateEventInput {
  /** Novo título (omite pra manter o atual). */
  title?: string;
  /** Novo início em ISO 8601 com offset (omite pra manter o atual). */
  start?: string;
  /** Novo fim em ISO 8601 com offset (omite pra manter o atual). */
  end?: string;
  description?: string;
  location?: string;
}

export interface CalendarWriteDeps {
  getAccessToken: () => Promise<string>;
  fetch: typeof fetch;
}

export function defaultCalendarWriteDeps(): CalendarWriteDeps {
  return {
    getAccessToken: () => getGoogleAccessToken(),
    fetch,
  };
}

// ─── tipos internos da resposta do Calendar API ──────────────────────────────

interface GCalEventResponse {
  id: string;
  htmlLink: string;
  summary?: string;
  start: { dateTime?: string };
  end: { dateTime?: string };
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Cria um evento no calendar primário do tenant (token vem de `deps.getAccessToken`,
 * já resolvido pro tenant certo por quem monta as deps — ver fast/index.ts).
 * Lança Error com status + body em qualquer falha HTTP.
 */
export async function createEvent(
  input: CreateEventInput,
  deps: CalendarWriteDeps = defaultCalendarWriteDeps(),
): Promise<CreatedEvent> {
  const token = await deps.getAccessToken();

  const body = {
    summary: input.title,
    start: { dateTime: input.start, timeZone: TIMEZONE },
    end: { dateTime: input.end, timeZone: TIMEZONE },
    ...(input.description ? { description: input.description } : {}),
    ...(input.location ? { location: input.location } : {}),
  };

  const res = await deps.fetch(CALENDAR_INSERT_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Calendar insert failed: ${res.status} ${errBody}`);
  }

  const data = (await res.json()) as GCalEventResponse;
  return {
    id: data.id,
    htmlLink: data.htmlLink,
    title: data.summary ?? input.title,
    start: data.start.dateTime ?? input.start,
    end: data.end.dateTime ?? input.end,
  };
}

/**
 * Remove um evento do calendar primário do tenant (mesmo token tenant-scoped
 * de createEvent).
 * 410 (evento já removido antes) é tratado como sucesso — idempotente, pra
 * não travar numa mensagem de erro por algo que já aconteceu.
 */
export async function deleteEvent(
  eventId: string,
  deps: CalendarWriteDeps = defaultCalendarWriteDeps(),
): Promise<void> {
  const token = await deps.getAccessToken();

  const res = await deps.fetch(`${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (res.ok || res.status === 410) return;

  const errBody = await res.text();
  throw new Error(`Calendar delete failed: ${res.status} ${errBody}`);
}

/**
 * Atualiza campos de um evento existente (PATCH — só manda o que muda).
 * Lança Error com status + body em qualquer falha HTTP.
 */
export async function updateEvent(
  eventId: string,
  input: UpdateEventInput,
  deps: CalendarWriteDeps = defaultCalendarWriteDeps(),
): Promise<CreatedEvent> {
  const token = await deps.getAccessToken();

  const body = {
    ...(input.title !== undefined ? { summary: input.title } : {}),
    ...(input.start !== undefined ? { start: { dateTime: input.start, timeZone: TIMEZONE } } : {}),
    ...(input.end !== undefined ? { end: { dateTime: input.end, timeZone: TIMEZONE } } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
  };

  const res = await deps.fetch(`${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Calendar update failed: ${res.status} ${errBody}`);
  }

  const data = (await res.json()) as GCalEventResponse;
  return {
    id: data.id,
    htmlLink: data.htmlLink,
    title: data.summary ?? "(sem título)",
    start: data.start.dateTime ?? input.start ?? "",
    end: data.end.dateTime ?? input.end ?? "",
  };
}
