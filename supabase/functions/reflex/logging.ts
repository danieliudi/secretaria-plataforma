import type { ReflexResult } from "../_shared/types.ts";

type InsertResult = { error: Error | null };

function formatTotal(totalMl: number): string {
  if (totalMl >= 1000) return `${(totalMl / 1000).toFixed(1).replace(".", ",")}L`;
  return `${totalMl}ml`;
}

export interface WaterDeps {
  insert: (data: { tipo: string; valor: number; unidade: string }) => Promise<InsertResult>;
  sumToday: () => Promise<number>;
}

export async function logWater(amountMl: number, deps: WaterDeps): Promise<ReflexResult> {
  const { error } = await deps.insert({ tipo: "agua", valor: amountMl, unidade: "ml" });
  if (error) return { ok: false, message: "Erro ao registrar água." };
  const totalMl = await deps.sumToday();
  return { ok: true, message: `✅ ${amountMl}ml. Total hoje: ${formatTotal(totalMl)}` };
}

export interface SleepDeps { insert: (data: { habito: string; valor: string }) => Promise<InsertResult>; }
export async function logSleep(hours: number, deps: SleepDeps): Promise<ReflexResult> {
  const { error } = await deps.insert({ habito: "sono", valor: `${hours}h` });
  if (error) return { ok: false, message: "Erro ao registrar sono." };
  return { ok: true, message: `✅ ${hours}h de sono registradas.` };
}

export interface TreinoDeps {
  insert: (data: { exercicio: string; series?: number; reps?: string; carga_kg?: number; observacao?: string }) => Promise<InsertResult>;
}
export async function logTreino(exercicio: string, extras: { series?: number; reps?: string; carga_kg?: number; observacao?: string }, deps: TreinoDeps): Promise<ReflexResult> {
  const { error } = await deps.insert({ exercicio, ...extras });
  if (error) return { ok: false, message: "Erro ao registrar treino." };
  return { ok: true, message: `✅ Treino registrado: ${exercicio}.` };
}

export interface OneThingWriteDeps {
  insert: (data: { escopo: string; texto: string; periodo_ref: string; frente?: string }) => Promise<InsertResult>;
  today: () => string;
}
export async function logOneThing(texto: string, escopo: "dia" | "semana", frente: string | undefined, deps: OneThingWriteDeps): Promise<ReflexResult> {
  const { error } = await deps.insert({ escopo, texto, periodo_ref: deps.today(), frente });
  if (error) return { ok: false, message: "Erro ao registrar One Thing." };
  return { ok: true, message: `✅ One Thing: ${texto}` };
}

export interface QuickCaptureDeps { insert: (data: { texto: string }) => Promise<InsertResult>; }
export async function logQuickCapture(texto: string, deps: QuickCaptureDeps): Promise<ReflexResult> {
  const { error } = await deps.insert({ texto });
  if (error) return { ok: false, message: "Erro ao salvar nota." };
  return { ok: true, message: "✅ Nota salva." };
}
