// Testes da regra que decide quem a secretária vai INTERROMPER.
// Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque o modo de falha é comportamental, não técnico: se a regra
// alargar (cobrar quem já respondeu, cobrar sala de reunião, cobrar o próprio
// dono), o usuário aprende a ignorar o aviso das 18h30 — e no dia em que o
// aviso importava, ele passa batido. Nenhum log registra "o usuário parou de
// ler". Estreitar demais é invisível do mesmo jeito.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MAX_AVISOS,
  nomeCurto,
  pendentesDeConfirmacao,
} from "../_shared/confirmacoes.ts";
import type { CalendarAttendee, CalendarEvent } from "../fast/tools/calendar-read.ts";

function conv(
  email: string,
  resposta: CalendarAttendee["resposta"],
  extra: Partial<CalendarAttendee> = {},
): CalendarAttendee {
  return { email, nome: null, resposta, eu: false, ...extra };
}

function ev(
  id: string,
  title: string,
  time: string | null,
  attendees: CalendarAttendee[],
): CalendarEvent {
  return { id, title, time, location: null, attendees };
}

// ─── o caso que motivou tudo ────────────────────────────────────────────────

Deno.test("convidado sem resposta vira aviso", () => {
  const r = pendentesDeConfirmacao([
    ev("e1", "Alinhamento Comercial", "14:00", [conv("ana@x.com", "sem_resposta")]),
  ]);
  assertEquals(r.total, 1);
  assertEquals(r.avisos.length, 1);
  assertEquals(r.avisos[0].titulo, "Alinhamento Comercial");
  assertEquals(r.avisos[0].hora, "14:00");
  assertEquals(r.avisos[0].pendentes.length, 1);
});

// ─── quem NÃO deve ser cobrado ──────────────────────────────────────────────

Deno.test("quem aceitou não é cobrado", () => {
  const r = pendentesDeConfirmacao([ev("e1", "X", "10:00", [conv("ana@x.com", "aceito")])]);
  assertEquals(r.total, 0);
});

Deno.test("quem recusou não é cobrado", () => {
  // Pior que ruído: constrangedor. A pessoa já disse que não vai.
  const r = pendentesDeConfirmacao([ev("e1", "X", "10:00", [conv("ana@x.com", "recusou")])]);
  assertEquals(r.total, 0);
});

Deno.test("quem respondeu 'talvez' não é cobrado", () => {
  // Decisão conservadora explícita: tentative É resposta. Se um dia virar
  // aviso, é aqui que muda — e este teste é o lembrete de que foi escolha.
  const r = pendentesDeConfirmacao([ev("e1", "X", "10:00", [conv("ana@x.com", "talvez")])]);
  assertEquals(r.total, 0);
});

Deno.test("o próprio dono do calendário nunca é cobrado", () => {
  const r = pendentesDeConfirmacao([
    ev("e1", "X", "10:00", [conv("eu@x.com", "sem_resposta", { eu: true })]),
  ]);
  assertEquals(r.total, 0);
});

Deno.test("evento sem convidado nunca vira aviso", () => {
  // Bloco de foco, lembrete, compromisso pessoal — a maioria da agenda.
  const r = pendentesDeConfirmacao([ev("e1", "Foco: proposta", "09:00", [])]);
  assertEquals(r.total, 0);
});

Deno.test("evento só com o dono e um confirmado não vira aviso", () => {
  const r = pendentesDeConfirmacao([
    ev("e1", "1:1", "11:00", [
      conv("eu@x.com", "sem_resposta", { eu: true }),
      conv("bruno@x.com", "aceito"),
    ]),
  ]);
  assertEquals(r.total, 0);
});

// ─── mistura ────────────────────────────────────────────────────────────────

Deno.test("mistura: só os sem resposta entram na lista do evento", () => {
  const r = pendentesDeConfirmacao([
    ev("e1", "Comitê", "15:00", [
      conv("eu@x.com", "sem_resposta", { eu: true }),
      conv("ana@x.com", "aceito"),
      conv("bruno@x.com", "sem_resposta"),
      conv("carla@x.com", "recusou"),
      conv("diego@x.com", "sem_resposta"),
    ]),
  ]);
  assertEquals(r.total, 1);
  assertEquals(r.avisos[0].pendentes.map((p) => p.email), ["bruno@x.com", "diego@x.com"]);
});

Deno.test("evento de dia inteiro é aceito, com hora null", () => {
  const r = pendentesDeConfirmacao([ev("e1", "Feira", null, [conv("ana@x.com", "sem_resposta")])]);
  assertEquals(r.total, 1);
  assertEquals(r.avisos[0].hora, null);
});

// ─── teto de avisos ─────────────────────────────────────────────────────────

Deno.test("nunca passa de MAX_AVISOS, mas o total continua real", () => {
  // Agenda cheia de convite pendente não pode virar muro de texto às 18h30.
  const eventos = Array.from({ length: 7 }, (_, i) =>
    ev(`e${i}`, `Reunião ${i}`, "10:00", [conv(`p${i}@x.com`, "sem_resposta")]));
  const r = pendentesDeConfirmacao(eventos);
  assertEquals(r.avisos.length, MAX_AVISOS);
  assertEquals(r.total, 7);
});

Deno.test("preserva a ordem cronológica que veio da agenda", () => {
  const r = pendentesDeConfirmacao([
    ev("e1", "Manhã", "09:00", [conv("a@x.com", "sem_resposta")]),
    ev("e2", "Tarde", "15:00", [conv("b@x.com", "sem_resposta")]),
  ]);
  assertEquals(r.avisos.map((a) => a.titulo), ["Manhã", "Tarde"]);
});

Deno.test("lista vazia não explode", () => {
  const r = pendentesDeConfirmacao([]);
  assertEquals(r.total, 0);
  assertEquals(r.avisos.length, 0);
});

Deno.test("attendees ausente é tratado como sem convidado", () => {
  // Evento vindo de um caminho antigo, sem o campo. Não pode derrubar o cron.
  const semCampo = { id: "e1", title: "X", time: "10:00", location: null } as CalendarEvent;
  assertEquals(pendentesDeConfirmacao([semCampo]).total, 0);
});

// ─── nome curto ─────────────────────────────────────────────────────────────

Deno.test("usa o displayName quando o Google tem", () => {
  assertEquals(nomeCurto(conv("ana@x.com", "sem_resposta", { nome: "Ana Takahiro" })), "Ana Takahiro");
});

Deno.test("sem displayName, deriva do e-mail sem expor o domínio", () => {
  // O aviso vai pra uma mensagem de WhatsApp que pode ser lida por cima do
  // ombro. Endereço completo de terceiro ali não acrescenta nada.
  assertEquals(nomeCurto(conv("ana.takahiro@empresa.com.br", "sem_resposta")), "Ana Takahiro");
  assertEquals(nomeCurto(conv("bruno_silva@x.com", "sem_resposta")), "Bruno Silva");
  assertEquals(nomeCurto(conv("carla@x.com", "sem_resposta")), "Carla");
});

Deno.test("nome curto nunca devolve o e-mail inteiro", () => {
  const n = nomeCurto(conv("ana.takahiro@empresa.com.br", "sem_resposta"));
  if (n.includes("@") || n.includes("empresa.com")) {
    throw new Error(`vazou o e-mail: ${n}`);
  }
});

Deno.test("displayName em branco cai na derivação, não vira vazio", () => {
  assertEquals(nomeCurto(conv("ana@x.com", "sem_resposta", { nome: "   " })), "Ana");
});
