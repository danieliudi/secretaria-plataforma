// Resolve qual TaskProvider usar, conforme TASK_PROVIDER (env var, hoje
// global ou tenant-scoped via _shared/tenant.ts). Ponto único de escolha — o
// resto do código (fast/index.ts, what-now.ts, spreadsheet.ts) só conhece a
// interface `TaskProvider`, nunca a plataforma concreta.
//
// SEM CACHE (de propósito): num isolate Deno que atende vários tenants, um
// cache de módulo (`let cached`) prenderia todo mundo no provider/env do
// PRIMEIRO tenant que passasse por ali — bug de produção real, não
// hipotético. Construir de novo por chamada é barato (só monta closures,
// nenhuma I/O na construção em si).

import { resolveTaskProviderKind, type TaskProvider } from "./task-provider.ts";
import { createClickUpProvider } from "./providers/clickup-provider.ts";
import { createGoogleTasksProvider } from "./providers/google-tasks-provider.ts";
import { createTrelloProvider } from "./providers/trello-provider.ts";
import { createNotionProvider, defaultNotionDeps } from "./providers/notion-provider.ts";
import { createSanweyTasksProvider } from "./providers/sanwey-tasks-provider.ts";

/** Instancia o provider ativo, conforme TASK_PROVIDER no `env` passado (ou global). */
export function getTaskProvider(
  env: (key: string) => string | undefined = (k) => Deno.env.get(k),
): TaskProvider {
  const kind = resolveTaskProviderKind(env);
  if (kind === "notion") return createNotionProvider({ ...defaultNotionDeps(), env });
  if (kind === "trello") return createTrelloProvider(env);
  if (kind === "google_tasks") return createGoogleTasksProvider(env);
  if (kind === "sanwey_tasks") return createSanweyTasksProvider(env);
  return createClickUpProvider(env);
}
