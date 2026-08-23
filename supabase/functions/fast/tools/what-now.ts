// "O que eu faço agora" (2I) — reduz decisão em vez de despejar lista.
// Junta tasks com prazo de TODAS as frentes com gerenciador de tarefas
// configurado e devolve as mais urgentes (vencidas primeiro, depois por
// prazo mais próximo). O fast mostra só a #1 — as outras ficam de reserva
// se o usuário pedir mais opções.

import { getTaskProvider } from "../../_shared/task-provider-factory.ts";
import type { TaskProvider } from "../../_shared/task-provider.ts";

export interface NextActionSuggestion {
  frente: string;
  list?: string;
  name: string;
  due_date: string;
  overdue: boolean;
  url: string;
}

export async function pickNextActions(
  provider: TaskProvider = getTaskProvider(),
  limit = 3,
): Promise<NextActionSuggestion[]> {
  const tasks = await provider.listAllOpenTasksWithDue();
  const now = Date.now();

  const sorted = tasks
    .slice()
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());

  return sorted.slice(0, limit).map((t) => ({
    frente: t.frente,
    list: t.list,
    name: t.name,
    due_date: t.due_date!,
    overdue: new Date(t.due_date!).getTime() < now,
    url: t.url,
  }));
}
