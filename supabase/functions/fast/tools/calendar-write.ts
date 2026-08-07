// Google Calendar — criação de eventos. POST direto na API v3 com fetch nativo.
// Token trocado por chamada (sem cache, igual calendar-read.ts).
//
// API ref: https://developers.google.com/calendar/api/v3/reference/events/insert

import { getGoogleAccessToken } from "../../_shared/google-oauth.ts";

const CALENDAR_INSERT_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
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
 * Cria um evento no calendar primário do Daniel.
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
