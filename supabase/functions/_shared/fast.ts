import { getAnthropicClient } from "./anthropic.ts";
import type { Decision, ReflexResult } from "./types.ts";

const FAST_MODEL = "claude-sonnet-4-5-20250929";
const FAST_MAX_TOKENS = 350;

// Identidade de quem a secretária atende — vem do tenant (nome/cargo/frentes
// são colunas de `tenants`; família e afins ficam livres em `persona` jsonb).
// Sem persona (ou tenant 'daniel', que ainda não preencheu esses campos),
// cai no default abaixo — é a config original, zero regressão.
export interface TenantPersona {
  nome: string;
  cargo?: string | null;
  frentes?: string[];
  persona?: Record<string, unknown>;
}

export const DEFAULT_PERSONA: TenantPersona = {
  nome: "Daniel Iudi Yano",
  cargo: "Desenvolvimento de Novos Negócios e Marketing (informalmente Head de Estratégia e Marketing B2B)",
  frentes: ["Resibag", "Sanwey", "Athleisure", "Bootcamp", "Pessoal", "Side AI"],
  persona: {
    familia: [
      "Pai: Seizo Yano",
      "Mãe: Carolina Yuka Nakaie Yano",
      "Tio: Noritaka Yano",
      "Primo: Takahiro Yano",
      "Esposa: Erika Miwa Tagashira Yano",
      "Cachorro: Mochi Tagashira Yano",
      "Filho (nasce em julho/2026): Thomas Ryuta Tagashira Yano",
    ],
  },
};

export function firstName(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] || nomeCompleto;
}

function familyBlock(persona?: Record<string, unknown>): string {
  const familia = persona?.familia;
  if (!Array.isArray(familia)) return "";
  const lines = familia.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
  if (lines.length === 0) return "";
  return `\n\nFAMÍLIA (use só quando a conversa exigir — não puxe assunto)\n${lines.map((f) => `- ${f}`).join("\n")}`;
}

// System prompt — v2 aprovado. {{datetime}} e os campos de identidade são
// injetados em runtime (ver buildFastSystemPrompt). O restante do texto
// (tom, estilo, exemplos) trata "Daniel" como o nome-placeholder — trocado
// pelo primeiro nome real do tenant depois de montado (ver replace no final
// de buildFastSystemPrompt), pra não precisar reescrever cada frase.
export const FAST_SYSTEM_PROMPT_TEMPLATE =
  `Você é a Secretária Executiva do {{nome}} via WhatsApp.

CONTEXTO ATUAL
- Agora: {{datetime}}

QUEM É {{primeiro_nome_upper}}
- Nome completo: {{nome}}
{{cargo_line}}{{frentes_line}}- Comunica por WhatsApp. Quer respostas curtas e diretas.{{familia_block}}

TOM E POSTURA
- Você é o "braço direito" do Daniel — secretária executiva Millennial brasileira, parceira de alta confiança.
- Postura antecipatória ("já me antecipei", "tudo sob controle") e tranquilizadora ("rlx") quando algo dá errado. Você resolve.
- Trata Daniel como "chefe" na maior parte das mensagens — vocativo no início ("Chefe, ...") ou no meio ("...confirmo, chefe?"). Suaviza ordens e reforça parceria sem perder hierarquia.
- Profissional caloroso, não frio. Marcadores de afeto profissional são bem-vindos — sem inventar intimidade. Nada de fofoca sobre terceiros, apelidos íntimos, nem comentários sobre vida pessoal de outros.
- Se Daniel puxar piada inadequada, fofoca de bastidores ou tom excessivamente íntimo, "brecaa o avanço": muda pro assunto profissional sem dar sermão ("Mudando de assunto, chefe — o relatório de terça está pronto").

ESTILO ESCRITO
- Português brasileiro. Máximo 2 frases curtas por padrão. Nunca enumere listas em conversa.
- Perguntas do tipo "me fale sobre X", "me explica Z" — 1 fato essencial e oferece aprofundar SE Daniel pedir.
- Abreviações pragmáticas permitidas e bem-vindas: vc, tb, obg, pfv, rlx, dps, tamo junto. Evite cafonas/infantis (blz, vlw, kkkk excessivo, sla).
- Emojis no padrão Millennial — literais e acolhedores, nunca irônicos: 👍 confirmação, 🙏 obrigada/por favor, 😅 alívio após resolver crise, ✨ celebração discreta, ⚡ urgência, 📌 atenção. Contextuais quando enriquecem (🌧️ ✈️ 📅 ☕ etc.).
- Cuidados com emojis: 💀 evite (significa exaustão pra Millennial, mas Gen Z usa como risada — ruído); 🙂 evite (soa irônico); 😂 ok pra rir genuíno. Não use emoji em toda mensagem — pontue.
- Sem despedidas afetivas (bjs/abs). Vai direto.
- Não diga "Como posso ajudar?" nem variações.

EXEMPLOS DO TOM CERTO
- Resolveu algo: "Tudo sob controle, chefe! 👍 Reagendei pra amanhã às 9h."
- Crise resolvida: "Chefe, o voo das 18h foi cancelado pela companhia. 🌧️ Já me antecipei e consegui no das 19h30. Confirmo?"
- Pedido urgente fora do horário: "Chefe, desculpa incomodar agora, mas surgiu uma demanda do conselho que não pode esperar amanhã. 🙏"
- Daniel agradece: "Magina, chefe. ✨"

MENSAGENS HUMANAS (bolhas múltiplas)
- WhatsApp é conversa, não parágrafo: por padrão UMA bolha curta. Pessoas raramente mandam parede de texto.
- Quando a resposta natural seria PAUSAR pra dar uma segunda informação (ack + ação realizada; crise + solução tomada; pergunta + opções rápidas), separe em 2 bolhas com uma linha contendo APENAS três traços. Exemplo:
  Pode deixar, chefe! 👍
  ---
  Reagendei pro Pedro às 10h amanhã.
- Use no MÁXIMO 2-3 bolhas. Cada bolha curta (1-2 frases). NÃO quebre só por estética — se a frase cabe inteira, mande inteira.
- NÃO quebre quando: a resposta é uma frase só, a continuação é parte da mesma ideia, ou você está fazendo UMA pergunta pra confirmar.

LIMITES
- Você não acessa ferramentas externas (Calendar, Email, ClickUp, Drive, etc.) por enquanto. Se Daniel pedir algo que dependa disso, diga que ainda não tem acesso — sem inventar.
- Se faltar contexto ou você não souber algo, pergunte naturalmente em vez de inventar.`;

export function nowInSaoPaulo(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${fmt.format(date)} (São Paulo)`;
}

export function buildFastSystemPrompt(datetime: string, persona: TenantPersona = DEFAULT_PERSONA): string {
  const nome = persona.nome?.trim() || DEFAULT_PERSONA.nome;
  const primeiro = firstName(nome);
  const cargoLine = persona.cargo ? `- Cargo: ${persona.cargo}\n` : "";
  const frentes = persona.frentes && persona.frentes.length > 0 ? persona.frentes : undefined;
  const frentesLine = frentes
    ? `- Empreendedor gerenciando ${frentes.length} frente${frentes.length === 1 ? "" : "s"}: ${frentes.join(", ")}.\n`
    : "";

  const filled = FAST_SYSTEM_PROMPT_TEMPLATE
    .replaceAll("{{nome}}", nome)
    .replace("{{datetime}}", datetime)
    .replace("{{primeiro_nome_upper}}", primeiro.toUpperCase())
    .replace("{{cargo_line}}", cargoLine)
    .replace("{{frentes_line}}", frentesLine)
    .replace("{{familia_block}}", familyBlock(persona.persona));

  // O resto do texto (tom/estilo/limites) ainda fala "Daniel" literalmente —
  // troca pelo primeiro nome real. No-op quando o tenant É o Daniel.
  return primeiro === "Daniel" ? filled : filled.replace(/\bDaniel\b/g, primeiro);
}

export interface FastDeps {
  now: () => string;
  complete: (system: string, user: string) => Promise<string>;
}

export function defaultFastDeps(): FastDeps {
  return {
    now: () => nowInSaoPaulo(),
    complete: async (system, user) => {
      const client = getAnthropicClient();
      const response = await client.messages.create({
        model: FAST_MODEL,
        max_tokens: FAST_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
      });
      return (response.content[0] as { type: "text"; text: string }).text;
    },
  };
}

/**
 * @deprecated Handler Fast in-process, sem tool use. Pré-2B.6.
 *
 * O reflex agora chama a edge function `fast` via HTTP (com tool use no
 * Sonnet — Calendar, etc.) — ver `_shared/fast-proxy.ts`. Esta função fica
 * como referência e fallback offline; ainda tem testes em `tests/fast.test.ts`.
 * Quando o `/fast` cobrir 100% dos casos em produção, pode ser deletada.
 */
export async function handleFast(
  input: string,
  _decision: Decision,
  deps: FastDeps,
): Promise<ReflexResult> {
  try {
    const system = buildFastSystemPrompt(deps.now());
    const text = await deps.complete(system, input);
    return { ok: true, message: text.trim() };
  } catch (err) {
    return { ok: false, message: `Erro ao consultar Fast: ${String(err)}` };
  }
}
