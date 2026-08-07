import type { Decision, ReflexResult } from "../_shared/types.ts";
import { lookupOneThing, type OneThingReadDeps } from "./lookup.ts";
import { type MedicationDeps, logMedication } from "./medication.ts";
import { logOneThing, logQuickCapture, logSleep, logTreino, logWater, type OneThingWriteDeps, type QuickCaptureDeps, type SleepDeps, type TreinoDeps, type WaterDeps } from "./logging.ts";

export type ReflexIntent =
  | { type: "log_water"; amountMl: number }
  | { type: "log_sleep"; hours: number }
  | { type: "log_treino"; exercicio: string; series?: number; reps?: string; carga_kg?: number }
  | { type: "log_medication" }
  | { type: "log_one_thing"; texto: string; escopo: "dia" | "semana" }
  | { type: "log_quick_capture"; texto: string }
  | { type: "lookup_one_thing"; escopo: "dia" | "semana" }
  | { type: "unknown" };

export function parseReflexIntent(input: string): ReflexIntent {
  const s = input.trim();
  const waterMatch = s.match(/^(?:água|bebi|beber)\s+(\d+(?:[,.]\d+)?)\s*(ml|l)\b/i);
  if (waterMatch) {
    let amount = parseFloat(waterMatch[1].replace(",", "."));
    if (waterMatch[2].toLowerCase() === "l") amount = amount * 1000;
    return { type: "log_water", amountMl: Math.round(amount) };
  }
  const sleepMatch = s.match(/^(?:dormi|sono)\s+(\d+(?:[,.]\d+)?)h/i);
  if (sleepMatch) return { type: "log_sleep", hours: parseFloat(sleepMatch[1].replace(",", ".")) };
  if (/^(?:tomei|remédio)\s*/i.test(s)) return { type: "log_medication" };
  const treinoMatch = s.match(/^treino[\s:]+(.+)/i);
  if (treinoMatch) return { type: "log_treino", exercicio: treinoMatch[1].trim() };
  if (/^(?:qual\s+)?one\s+thing\?/i.test(s)) return { type: "lookup_one_thing", escopo: "dia" };
  if (/^one\s+thing\s+semana\?/i.test(s)) return { type: "lookup_one_thing", escopo: "semana" };
  const otMatch = s.match(/^one\s+thing[\s:]+(.+)/i);
  if (otMatch) return { type: "log_one_thing", texto: otMatch[1].trim(), escopo: "dia" };
  const notaMatch = s.match(/^nota[\s:]+(.+)/i);
  if (notaMatch) return { type: "log_quick_capture", texto: notaMatch[1].trim() };
  return { type: "unknown" };
}

export interface OrchestratorDeps {
  water: WaterDeps;
  sleep: SleepDeps;
  treino: TreinoDeps;
  medication: MedicationDeps;
  oneThingWrite: OneThingWriteDeps;
  oneThingRead: OneThingReadDeps;
  quickCapture: QuickCaptureDeps;
}

export async function orchestrateReflex(input: string, decision: Decision, deps: OrchestratorDeps): Promise<ReflexResult> {
  const intent = parseReflexIntent(input);
  const frente = decision.frente !== "ambiguo" ? decision.frente : undefined;
  switch (intent.type) {
    case "log_water": return logWater(intent.amountMl, deps.water);
    case "log_sleep": return logSleep(intent.hours, deps.sleep);
    case "log_treino": return logTreino(intent.exercicio, { series: intent.series, reps: intent.reps, carga_kg: intent.carga_kg }, deps.treino);
    case "log_medication": return logMedication(deps.medication);
    case "log_one_thing": return logOneThing(intent.texto, intent.escopo, frente, deps.oneThingWrite);
    case "log_quick_capture": return logQuickCapture(intent.texto, deps.quickCapture);
    case "lookup_one_thing": return lookupOneThing(intent.escopo, deps.oneThingRead);
    default: return { ok: false, message: "Não entendi. Pode repetir?" };
  }
}
