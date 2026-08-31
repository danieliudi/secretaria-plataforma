// Google Calendar — criação, edição e remoção de eventos. Chamadas diretas na
// API v3 com fetch nativo. Token vem de getGoogleAccessToken(), que já
// cacheia em memória (ver _shared/google-oauth.ts).
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

/** O que sumiu, confirmado. `titulo` é null quando o evento já não existia. */
export interface EventoRemovido {
  id: string;
  titulo: string | null;
}

/**
 * Remove um evento do calendar primário do tenant e CONFIRMA que sumiu.
 *
 * Por que a confirmação existe (erro real de 31/08/2026): a secretária
 * respondeu "Cancelado 👍" e o evento continuou na agenda. Ela não mentiu por
 * conta própria — esta função devolvia `void`, o executeTool traduzia em
 * `{ ok: true }`, e "ok" era a única coisa que o modelo tinha pra ir. Um
 * resultado que diz "deu certo" sem ter olhado é pior que um erro: o usuário
 * confia e só descobre dias depois, olhando a agenda.
 *
 * Então agora: lê o evento ANTES (pra saber o título de verdade, e poder
 * confirmar pelo nome em vez de pelo id), apaga, e lê DE NOVO. Só devolve
 * sucesso se a segunda leitura disser que não está mais lá.
 *
 * 410 e 404 na hora do DELETE continuam sendo sucesso — evento que já não
 * existe é o estado que o usuário pediu. O que mudou é que isso agora é
 * VERIFICADO, não presumido.
 */
export async function deleteEvent(
  eventId: string,
  deps: CalendarWriteDeps = defaultCalendarWriteDeps(),
): Promise<EventoRemovido> {
  const token = await deps.getAccessToken();
  const url = `${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`;
  const auth = { "Authorization": `Bearer ${token}` };

  // Título de antes: é o que a secretária vai repetir pro usuário. Confirmar
  // com o nome ("Cancelei o alinhamento diário") em vez de um "ok" genérico é
  // o que deixa ele perceber na hora se ela pegou o evento errado.
  const antes = await deps.fetch(url, { headers: auth });
  const titulo = antes.ok
    ? ((await antes.json()) as { summary?: string }).summary ?? "(sem título)"
    : null;

  const res = await deps.fetch(url, { method: "DELETE", headers: auth });
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const errBody = await res.text();
    throw new Error(`Calendar delete failed: ${res.status} ${errBody}`);
  }

  // A verificação. Google responde 404/410 pra evento apagado, e status
  // "cancelled" pra ocorrência de série que foi cancelada.
  const depois = await deps.fetch(url, { headers: auth });
  if (depois.ok) {
    const corpo = (await depois.json()) as { status?: string };
    if (corpo.status !== "cancelled") {
      throw new Error(
        `O evento continua na agenda depois do delete (id ${eventId}). NÃO diga que cancelou.`,
      );
    }
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
