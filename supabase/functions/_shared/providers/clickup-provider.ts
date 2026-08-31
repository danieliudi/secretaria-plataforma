// Adapter: ClickUp → TaskProvider comum. Não duplica lógica — só encaixa as
// funções já existentes de fast/tools/clickup.ts na interface compartilhada.

import type {
  CompleteTaskResult as PCompleteTaskResult,
  RescheduleTaskInput as PRescheduleTaskInput,
  RescheduleTaskResult as PRescheduleTaskResult,
  CreateTaskInput as PCreateTaskInput,
  ListTasksInput as PListTasksInput,
  OpenTaskWithDue,
  TaskItem,
  TaskProvider,
} from "../task-provider.ts";
import {
  buildClickUpSystemBlock,
  completeTask,
  createTask,
  defaultClickUpDeps,
  listAllOpenTasksWithDue,
  listTasks,
  rescheduleTask,
  tryLoadClickUpMap,
} from "../../fast/tools/clickup.ts";
import { frentesDoEnv } from "../tenant.ts";

export function createClickUpProvider(env?: (key: string) => string | undefined): TaskProvider {
  const deps = env ? { ...defaultClickUpDeps(), env } : defaultClickUpDeps();

  return {
    name: "clickup",

    listTasks: (input: PListTasksInput): Promise<TaskItem[]> =>
      listTasks({ frente: input.frente, list: input.list, limit: input.limit }, deps),

    createTask: (input: PCreateTaskInput): Promise<TaskItem> => {
      if (!input.list) {
        throw new Error(
          "ClickUp exige `list` pra criar task — pergunte em qual list.",
        );
      }
      return createTask(
        {
          frente: input.frente,
          list: input.list,
          title: input.title,
          description: input.description,
          due_date: input.due_date,
        },
        deps,
      );
    },

    completeTask: (input): Promise<PCompleteTaskResult> =>
      completeTask({ frente: input.frente, query: input.query, list: input.list }, deps),

    rescheduleTask: (input: PRescheduleTaskInput): Promise<PRescheduleTaskResult> =>
      rescheduleTask(
        { frente: input.frente, query: input.query, due_date: input.due_date, list: input.list },
        deps,
      ),

    listAllOpenTasksWithDue: (): Promise<OpenTaskWithDue[]> => listAllOpenTasksWithDue(deps),

    buildSystemBlock: (): string => {
      const map = tryLoadClickUpMap(deps.env);
      return buildClickUpSystemBlock(map, frentesDoEnv(deps.env));
    },
  };
}
