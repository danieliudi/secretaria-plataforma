// Ponto ÚNICO de escolha do provedor de diarização — mesmo papel do
// task-provider-factory.ts. O cron só conhece a interface `ProvedorDiarizacao`,
// nunca a AssemblyAI diretamente; trocar de fornecedor é mexer aqui e escrever
// um arquivo novo em providers/, sem tocar na lógica de reunião.
//
// SEM CACHE de módulo, pelo mesmo motivo documentado em
// task-provider-factory.ts: um isolate Deno atende vários tenants, e um
// `let cached` prenderia todo mundo no env do primeiro tenant que passasse.

import type { ProvedorDiarizacao } from "./diarizacao.ts";
import { createAssemblyAiProvider } from "./providers/assemblyai-provider.ts";

export function getProvedorDiarizacao(
  env: (key: string) => string | undefined = (k) => Deno.env.get(k),
): ProvedorDiarizacao {
  return createAssemblyAiProvider(env);
}
