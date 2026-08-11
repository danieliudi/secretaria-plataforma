// Testes da análise de agenda. Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque estas regras falham em SILÊNCIO: se `detectaConflitos` parar
// de achar conflito, ninguém recebe erro — a secretária simplesmente cala a
// boca, e leva semanas pra alguém notar. Casos-limite (encosto de borda,
// evento dentro de outro, sobreposição dupla) são exatamente onde uma
// refatoração inocente quebra tudo.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cargaPorDia,
  detectaConflitos,
  detectaMaratona,
  primeiroBuraco,
  priorizaAtrasadas,
  type EventoAgenda,
} from "../_shared/agenda-analise.ts";

/** Evento no dia 1 de agosto de 2026, em UTC. */
function ev(titulo: string, hIni: number, mIni: number, hFim: number, mFim: number, dia = 1): EventoAgenda {
  return {
    titulo,
    inicio: new Date(Date.UTC(2026, 7, dia, hIni, mIni)),
    fim: new Date(Date.UTC(2026, 7, dia, hFim, mFim)),
  };
}

// ─── conflitos ──────────────────────────────────────────────────────────────

Deno.test("agenda encadeada não gera conflito", () => {
  assertEquals(detectaConflitos([ev("A", 9, 0, 10, 0), ev("B", 10, 0, 11, 0)]).length, 0);
});

Deno.test("encosto de 4 min não é conflito", () => {
  // Reunião que vaza um pouquinho da anterior é rotina, não colisão. Avisar
  // disso treinaria a pessoa a ignorar o aviso.
  assertEquals(detectaConflitos([ev("A", 9, 0, 10, 0), ev("B", 9, 56, 11, 0)]).length, 0);
});

Deno.test("sobreposição real é detectada com a duração certa", () => {
  const c = detectaConflitos([ev("A", 15, 0, 16, 0), ev("B", 15, 0, 15, 30)]);
  assertEquals(c.length, 1);
  assertEquals(c[0].sobreposicaoMin, 30);
});

Deno.test("evento inteiramente dentro de outro conta como conflito", () => {
  const c = detectaConflitos([ev("Longo", 9, 0, 12, 0), ev("Curto", 10, 0, 10, 30)]);
  assertEquals(c[0].sobreposicaoMin, 30);
});

Deno.test("o pior conflito vem primeiro", () => {
  // É ele que vira mensagem — se a ordem inverter, a secretária avisa do
  // conflito menos importante do dia.
  const c = detectaConflitos([ev("A", 9, 0, 12, 0), ev("B", 9, 30, 10, 0), ev("C", 10, 0, 11, 30)]);
  assertEquals(c[0].sobreposicaoMin, 90);
});

Deno.test("agenda vazia não quebra", () => {
  assertEquals(detectaConflitos([]).length, 0);
});

// ─── buraco livre ───────────────────────────────────────────────────────────

const DIA = [ev("A", 9, 0, 10, 0), ev("B", 11, 0, 12, 0)];
const FIM_DO_DIA = new Date(Date.UTC(2026, 7, 1, 18, 0));

Deno.test("acha a janela de 1h entre os dois compromissos", () => {
  const b = primeiroBuraco(DIA, new Date(Date.UTC(2026, 7, 1, 10, 0)), 60, FIM_DO_DIA);
  assertEquals(b?.toISOString(), new Date(Date.UTC(2026, 7, 1, 10, 0)).toISOString());
});

Deno.test("pula a janela que não cabe e devolve a próxima", () => {
  const b = primeiroBuraco(DIA, new Date(Date.UTC(2026, 7, 1, 10, 0)), 90, FIM_DO_DIA);
  assertEquals(b?.toISOString(), new Date(Date.UTC(2026, 7, 1, 12, 0)).toISOString());
});

Deno.test("sem espaço até o fim do dia devolve null", () => {
  assertEquals(primeiroBuraco(DIA, new Date(Date.UTC(2026, 7, 1, 12, 0)), 400, FIM_DO_DIA), null);
});

// ─── carga da semana ────────────────────────────────────────────────────────

Deno.test("carga soma união, não duração bruta", () => {
  // Duas reuniões de 2h sobrepostas em 1h ocupam 3h do dia, não 4h. Sem isso
  // um dia com conflito apareceria como o mais cheio da semana só por causa
  // da contagem dupla — e a proposta de remanejar viria pro dia errado.
  const inicio = new Date(Date.UTC(2026, 7, 1, 3, 0));
  const semana = cargaPorDia([ev("A", 12, 0, 14, 0), ev("B", 13, 0, 15, 0)], inicio, 7);
  assertEquals(semana[0].minutosOcupados, 180);
  assertEquals(semana[0].compromissos, 2);
});

Deno.test("sempre devolve os 7 dias, inclusive os vazios", () => {
  const semana = cargaPorDia([], new Date(Date.UTC(2026, 7, 1, 3, 0)), 7);
  assertEquals(semana.length, 7);
  assertEquals(semana.every((d) => d.minutosOcupados === 0), true);
});

// ─── atrasadas ──────────────────────────────────────────────────────────────

Deno.test("menos de 3 atrasadas é silêncio", () => {
  assertEquals(priorizaAtrasadas([{ titulo: "A", diasAtraso: 5 }, { titulo: "B", diasAtraso: 2 }]), null);
});

Deno.test("tarefa em dia não conta pro limiar", () => {
  const r = priorizaAtrasadas([
    { titulo: "A", diasAtraso: 5 },
    { titulo: "B", diasAtraso: 2 },
    { titulo: "C", diasAtraso: 0 },
  ]);
  assertEquals(r, null);
});

Deno.test("ordena da mais atrasada e corta no máximo", () => {
  const r = priorizaAtrasadas([
    { titulo: "A", diasAtraso: 1 },
    { titulo: "B", diasAtraso: 9 },
    { titulo: "C", diasAtraso: 4 },
    { titulo: "D", diasAtraso: 6 },
  ]);
  assertEquals(r?.map((t) => t.diasAtraso), [9, 6, 4, 1]);

  const muitas = priorizaAtrasadas(
    Array.from({ length: 9 }, (_, i) => ({ titulo: `T${i}`, diasAtraso: i + 1 })),
  );
  assertEquals(muitas?.length, 5);
});

// ─── maratona (regressão do que já existia) ─────────────────────────────────

Deno.test("3 reuniões coladas de 1h viram maratona", () => {
  const m = detectaMaratona([ev("A", 9, 0, 10, 0), ev("B", 10, 0, 11, 0), ev("C", 11, 0, 12, 0)]);
  assertEquals(m?.length, 3);
});

Deno.test("3 reuniões curtas coladas não viram maratona", () => {
  // 45 min no total: volume sem cansaço. O critério é volume E ausência de
  // respiro ao mesmo tempo.
  const m = detectaMaratona([ev("A", 9, 0, 9, 15), ev("B", 9, 15, 9, 30), ev("C", 9, 30, 9, 45)]);
  assertEquals(m, null);
});
