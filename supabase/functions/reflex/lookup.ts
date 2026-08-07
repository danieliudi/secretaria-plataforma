import type { ReflexResult } from "../_shared/types.ts";

export interface CalendarLookupDeps { nextMeeting: () => Promise<{ time: string; title: string } | null>; }
export async function lookupNextMeeting(deps: CalendarLookupDeps): Promise<ReflexResult> {
  try {
    const meeting = await deps.nextMeeting();
    if (!meeting) return { ok: true, message: "Agenda limpa hoje." };
    return { ok: true, message: `Próxima: ${meeting.time} — ${meeting.title}` };
  } catch { return { ok: false, message: "Erro ao acessar Calendar." }; }
}

export interface ClickUpLookupDeps { listTasks: (frente: string) => Promise<string[]>; }
export async function lookupTasks(frente: string, deps: ClickUpLookupDeps): Promise<ReflexResult> {
  try {
    const tasks = await deps.listTasks(frente);
    if (tasks.length === 0) return { ok: true, message: "Nenhuma tarefa pendente." };
    return { ok: true, message: tasks.map((t) => `• ${t}`).join("\n") };
  } catch { return { ok: false, message: "Erro ao acessar ClickUp." }; }
}

export interface OneThingReadDeps { findCurrent: (escopo: "dia" | "semana") => Promise<string | null>; }
export async function lookupOneThing(escopo: "dia" | "semana", deps: OneThingReadDeps): Promise<ReflexResult> {
  try {
    const texto = await deps.findCurrent(escopo);
    if (!texto) return { ok: true, message: `One Thing (${escopo}) não definido.` };
    return { ok: true, message: `One Thing: ${texto}` };
  } catch { return { ok: false, message: "Erro ao buscar One Thing." }; }
}
