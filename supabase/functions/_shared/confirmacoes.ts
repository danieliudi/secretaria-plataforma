// Quem ainda não confirmou presença — núcleo do bloco proativo.
//
// POR QUE É PURO E SEPARADO: esta é a regra que decide se a secretária vai
// INTERROMPER a pessoa. Errar pra mais treina o usuário a ignorar o aviso, que
// é como um recurso proativo morre — e o dia em que o aviso importava, ele
// passa batido. Errar pra menos é invisível. Regra de decisão que cutuca gente
// merece teste, e teste sem rede é teste que roda.
//
// AS ESCOLHAS CONSERVADORAS, todas deliberadas:
//
// - "talvez" (tentative) NÃO entra. É resposta: a pessoa viu o convite e se
//   posicionou. Cobrar quem já respondeu é exatamente o ruído que faz o usuário
//   desligar o aviso.
// - "recusou" NÃO entra, pelo mesmo motivo — e cobrar confirmação de quem disse
//   não é pior que ruído, é constrangedor.
// - O próprio dono do calendário (`eu`) nunca entra: ninguém confirma consigo.
// - Evento sem convidado nunca entra. Bloco de foco, lembrete e compromisso
//   pessoal são a maioria da agenda e não têm o que confirmar.

import type { CalendarAttendee, CalendarEvent } from "../fast/tools/calendar-read.ts";

export interface PendenteConfirmacao {
  eventoId: string;
  titulo: string;
  /** "HH:MM" no fuso de SP, ou null em evento de dia inteiro. */
  hora: string | null;
  /** Só os convidados que não responderam. Nunca vazio. */
  pendentes: CalendarAttendee[];
}

/**
 * Teto do que vira aviso. Agenda cheia de convite sem resposta viraria um muro
 * de texto às 18h30, e muro de texto não é aviso — é ruído com data.
 */
export const MAX_AVISOS = 3;

export interface ResultadoConfirmacoes {
  /** No máximo `MAX_AVISOS`, na ordem em que os eventos vieram (cronológica). */
  avisos: PendenteConfirmacao[];
  /** Total real de eventos pendentes, inclusive os que não couberam. */
  total: number;
}

/**
 * Filtra os eventos que valem uma oferta de confirmação.
 *
 * Espera os eventos já ordenados por hora (é o que `getEventsByDate` devolve).
 */
export function pendentesDeConfirmacao(eventos: CalendarEvent[]): ResultadoConfirmacoes {
  const todos: PendenteConfirmacao[] = [];

  for (const ev of eventos) {
    const pendentes = (ev.attendees ?? []).filter(
      (a) => !a.eu && a.resposta === "sem_resposta",
    );
    if (pendentes.length === 0) continue;
    todos.push({
      eventoId: ev.id,
      titulo: ev.title,
      hora: ev.time,
      pendentes,
    });
  }

  return { avisos: todos.slice(0, MAX_AVISOS), total: todos.length };
}

/**
 * Nome curto pra citar no aviso: displayName quando existe, senão a parte antes
 * do "@". Nunca devolve o e-mail inteiro — o aviso vai pra uma mensagem de
 * WhatsApp que pode ser lida por cima do ombro, e endereço completo de terceiro
 * ali não acrescenta nada.
 */
export function nomeCurto(a: CalendarAttendee): string {
  if (a.nome && a.nome.trim() !== "") return a.nome.trim();
  const antes = a.email.split("@")[0] ?? "";
  if (antes === "") return "convidado";
  // "ana.takahiro" e "ana_takahiro" viram "Ana Takahiro".
  return antes
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
