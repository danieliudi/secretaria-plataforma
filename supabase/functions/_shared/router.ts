import { getAnthropicClient } from "./anthropic.ts";
import { registraUso } from "./uso.ts";
import type { Decision, Tier } from "./types.ts";

export type RouterResult = { route: "reflex" | "fast" | "deep" | "ask"; decision: Decision; askReason?: "ambiguo" | "low_confidence"; };

export const REFLEX_REGEX: RegExp[] = [
  /^água\s+\d/i,
  /^beber\s+\d/i,
  /^dormi\s+\d/i,
  /^sono\s+\d/i,
  /^tomei\s+/i,
  /^remédio\s+/i,
  /^treino[\s:]/i,
  /^one\s+thing[\s:]/i,
  /^nota[\s:]/i,
];

export const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Monta o enum de `frente` do prompt A PARTIR do tenant — nunca uma lista
 * fixa. Até 20/08/2026 essa lista era hardcoded com as frentes do Daniel
 * (achado da auditoria de "prompt mestre"): qualquer tenant com frentes
 * diferentes das dele caía sempre em "ambiguo", porque a frente real dele
 * nunca existia no enum.
 *
 * "pessoal" sempre entra, mesmo se o tenant não cadastrou essa frente — é o
 * balde universal pra assunto que não é de negócio nenhum específico. Pro
 * Daniel isso é zero regressão: "pessoal" já é uma das frentes dele, então o
 * enum final fica byte a byte igual ao de antes.
 */
function frenteEnum(frentes: string[]): string {
  const opcoes = [...new Set([...frentes, "pessoal"])];
  return [...opcoes.map((f) => `"${f}"`), '"ambiguo"'].join("|");
}

function buildClassifierPrompt(input: string, frentes: string[]): string {
  return `Você é o roteador de um sistema agentic pessoal. Classifique a mensagem.
Responda APENAS com JSON, sem texto adicional.
CAMPOS:
- tier: "reflex"|"fast"|"deep"
- frente: ${frenteEnum(frentes)}
- domain: "agenda"|"inbox"|"tarefas"|"saude"|"conteudo"|"proposta"|"analise"|"outro"
- action_required: boolean
- irreversible: boolean
- confidence: number 0.0-1.0
REGRAS DE TIER:
- reflex: lookup de fonte única ou registro. Sem raciocínio.
- fast: resolve numa passada. Resposta ou ação simples.
- deep: conteúdo externo, análise multi-fonte, output sustenta decisão de board/cliente.
REGRA DE FRENTE: não explícita e não inferrível → "ambiguo". Nunca chute.
MENSAGEM: ${input}`;
}

export function checkRegexReflex(input: string): boolean { return REFLEX_REGEX.some((p) => p.test(input.trim())); }

export function escalateTier(tier: Tier): Tier {
  if (tier === "reflex") return "fast";
  if (tier === "fast") return "deep";
  return "deep";
}

export function applyRules(decision: Decision): RouterResult {
  if (decision.frente === "ambiguo") return { route: "ask", decision, askReason: "ambiguo" };
  if (decision.confidence < CONFIDENCE_THRESHOLD) return { route: "ask", decision: { ...decision, tier: escalateTier(decision.tier) }, askReason: "low_confidence" };
  return { route: decision.tier, decision };
}

/**
 * `frentes` vem do tenant (`tenant.frentes`) — quem chama já resolveu o
 * tenant antes de classificar (ver reflex/index.ts). Lista vazia é um tenant
 * válido que ainda não configurou frente nenhuma, não um erro.
 */
export async function classifyWithHaiku(input: string, frentes: string[]): Promise<Decision> {
  const client = getAnthropicClient();
  const prompt = buildClassifierPrompt(input, frentes);
  const response = await client.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 256, messages: [{ role: "user", content: prompt }] });
  await registraUso("claude-haiku-4-5-20251001", "classificador", response.usage);
  const raw = (response.content[0] as { type: "text"; text: string }).text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(raw) as Decision;
}

export async function route(input: string, frentes: string[]): Promise<RouterResult> {
  if (checkRegexReflex(input)) {
    const decision: Decision = { tier: "reflex", frente: "pessoal", domain: "saude", action_required: true, irreversible: false, confidence: 1.0 };
    return { route: "reflex", decision };
  }
  const decision = await classifyWithHaiku(input, frentes);
  return applyRules(decision);
}
