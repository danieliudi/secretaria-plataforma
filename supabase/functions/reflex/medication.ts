import type { ReflexResult } from "../_shared/types.ts";

export interface MedicationSchedule { id: string; remedio: string; dose: string | null; horario_alvo: string; janela_min: number; }
export function timeToMinutes(time: string): number { const [h, m] = time.split(":").map(Number); return h * 60 + (m || 0); }
export function isInWindow(nowMinutes: number, targetTime: string, windowMin: number): boolean {
  const target = timeToMinutes(targetTime);
  const diff = Math.abs(nowMinutes - target);
  return Math.min(diff, 1440 - diff) <= windowMin;
}
export function filterByWindow(schedules: MedicationSchedule[], nowMinutes: number): MedicationSchedule[] {
  return schedules.filter((s) => isInWindow(nowMinutes, s.horario_alvo, s.janela_min));
}
function fmt(time: string): string { return time.slice(0, 5); }

export interface MedicationDeps {
  now: () => string;
  findActive: () => Promise<MedicationSchedule[]>;
  logIntake: (scheduleId: string, remedio: string, dose: string | null) => Promise<{ error: Error | null }>;
}

export async function logMedication(deps: MedicationDeps): Promise<ReflexResult> {
  const all = await deps.findActive();
  const nowMin = timeToMinutes(deps.now());
  const inWindow = filterByWindow(all, nowMin);
  if (inWindow.length === 0) {
    const lista = all.length > 0 ? all.map((s) => `${s.remedio} (${fmt(s.horario_alvo)})`).join(" · ") : "nenhum cadastrado";
    return { ok: false, message: `Nenhum remédio agendado agora. Horários: ${lista}` };
  }
  if (inWindow.length > 1) {
    const lista = inWindow.map((s) => `- ${s.remedio} (${fmt(s.horario_alvo)})`).join("\n");
    return { ok: false, message: `Qual remédio você tomou?\n${lista}` };
  }
  const med = inWindow[0];
  const { error } = await deps.logIntake(med.id, med.remedio, med.dose);
  if (error) return { ok: false, message: "Erro ao registrar medicação." };
  const others = all.filter((s) => s.id !== med.id);
  const proxima = others.length > 0 ? ` Próxima: ${fmt(others[0].horario_alvo)}` : "";
  const doseStr = med.dose ? ` (${med.dose})` : "";
  return { ok: true, message: `✅ ${med.remedio}${doseStr}.${proxima}` };
}
