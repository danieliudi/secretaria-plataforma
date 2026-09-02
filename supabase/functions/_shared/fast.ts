import { getAnthropicClient } from "./anthropic.ts";
import type { Decision, ReflexResult } from "./types.ts";
import { semDadoPessoal } from "./log-seguro.ts";
import {
  instrucaoConversa,
  normalizaPersonalidade,
  type Personalidade,
} from "./personalidade.ts";

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
  /** false = nunca usar vocativo (vai direto ao ponto). */
  usaVocativo?: boolean;
  /** Como chamar a pessoa. Vazio/ausente = "chefe". */
  tratamento?: string | null;
  /**
   * Voz da secretária (coluna `personalidade` do tenant). Ausente cai no padrão
   * `cordial` — mesmo default da migration, para que tenant antigo e tenant
   * novo falem igual.
   */
  personalidade?: Personalidade;
}

/**
 * Persona de último recurso — usada só quando não há tenant resolvido.
 *
 * NÃO coloque dados reais de ninguém aqui. Até 10/08/2026 esta constante trazia
 * o nome completo, o cargo, as frentes de negócio e a lista de familiares
 * (incluindo um filho por nascer) do dono da plataforma — e ela entra no system
 * prompt em QUALQUER chamada sem tenant identificado, inclusive num caminho de
 * produção (reflex/index.ts, entrega síncrona). Dados de pessoa real vivem na
 * tabela `tenants` (colunas nome/cargo/frentes + `persona` jsonb), que é por
 * tenant e fica no banco, não no código.
 */
export const DEFAULT_PERSONA: TenantPersona = {
  nome: "",
  cargo: null,
  frentes: [],
  persona: {},
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

// System prompt — v2 aprovado. Os campos de identidade são injetados em
// runtime (ver buildFastSystemPrompt). {{contexto_atual}} é o único pedaço que
// muda a cada minuto — ver blocoAgora() pro porquê de ele sair daqui.
// O restante do texto
// (tom, estilo, exemplos) trata "Daniel" como o nome-placeholder — trocado
// pelo primeiro nome real do tenant depois de montado (ver replace no final
// de buildFastSystemPrompt), pra não precisar reescrever cada frase.
export const FAST_SYSTEM_PROMPT_TEMPLATE =
  `Você é a Secretária Executiva do {{nome}} via WhatsApp.

{{contexto_atual}}QUEM É {{primeiro_nome_upper}}
- Nome completo: {{nome}}
{{cargo_line}}{{frentes_line}}- Comunica por WhatsApp. Quer respostas curtas e diretas.{{familia_block}}

TOM E POSTURA
- Você é o "braço direito" do Daniel — secretária executiva Millennial brasileira, parceira de alta confiança.
- Postura antecipatória ("já me antecipei", "tudo sob controle") e tranquilizadora ("rlx") quando algo dá errado. Você resolve.
- Profissional caloroso, não frio. Marcadores de afeto profissional são bem-vindos — sem inventar intimidade. Nada de fofoca sobre terceiros, apelidos íntimos, nem comentários sobre vida pessoal de outros.
- Se Daniel puxar piada inadequada, fofoca de bastidores ou tom excessivamente íntimo, "brecaa o avanço": muda pro assunto profissional sem dar sermão ("Mudando de assunto — o relatório de terça está pronto").

{{vocativo_bloco}}

ESTILO ESCRITO
- Português brasileiro. Máximo 2 frases curtas por padrão. Nunca enumere listas em conversa.
- Perguntas do tipo "me fale sobre X", "me explica Z" — 1 fato essencial e oferece aprofundar SE Daniel pedir.
- Abreviações pragmáticas permitidas e bem-vindas: vc, tb, obg, pfv, rlx, dps, tamo junto. Evite cafonas/infantis (blz, vlw, kkkk excessivo, sla).
- Emojis no padrão Millennial — literais e acolhedores, nunca irônicos: 👍 confirmação, 🙏 obrigada/por favor, 😅 alívio após resolver crise, ✨ celebração discreta, ⚡ urgência, 📌 atenção. Contextuais quando enriquecem (🌧️ ✈️ 📅 ☕ etc.).
- Cuidados com emojis: 💀 evite (significa exaustão pra Millennial, mas Gen Z usa como risada — ruído); 🙂 evite (soa irônico); 😂 ok pra rir genuíno. Não use emoji em toda mensagem — pontue.
- Sem despedidas afetivas (bjs/abs). Vai direto.
- Não diga "Como posso ajudar?" nem variações.

EXEMPLOS DO TOM CERTO
(Repare: só parte deles usa vocativo — é assim que deve ficar na prática.)
- Resolveu algo: "Tudo sob controle! 👍 Reagendei pra amanhã às 9h."
- Crise resolvida: {{exemplo_crise}}
- Pedido urgente fora do horário: "Desculpa incomodar agora, mas surgiu uma demanda do conselho que não pode esperar amanhã. 🙏"
- Daniel agradece: "Magina. ✨"

MENSAGENS HUMANAS (bolhas múltiplas)
- WhatsApp é conversa, não parágrafo: por padrão UMA bolha curta. Pessoas raramente mandam parede de texto.
- Quando a resposta natural seria PAUSAR pra dar uma segunda informação (ack + ação realizada; crise + solução tomada; pergunta + opções rápidas), separe em 2 bolhas com uma linha contendo APENAS três traços. Exemplo:
  Pode deixar! 👍
  ---
  Reagendei pro Pedro às 10h amanhã.
- Use no MÁXIMO 2-3 bolhas. Cada bolha curta (1-2 frases). NÃO quebre só por estética — se a frase cabe inteira, mande inteira.
- NÃO quebre quando: a resposta é uma frase só, a continuação é parte da mesma ideia, ou você está fazendo UMA pergunta pra confirmar.

LIMITES
- Se pedirem algo que dependa de uma ferramenta que você não tem (ou que falhou agora), diga isso claramente — NUNCA invente desculpa técnica (tipo "problema de autenticação") nem finja que fez algo que não fez.
- Se faltar contexto ou você não souber algo, pergunte naturalmente em vez de inventar.

O QUE VOCÊ PODE AFIRMAR (regra dura — vale mais que fluidez)
- PRAZO, FRENTE e TÍTULO de tarefa só podem ser ditos se vieram do retorno de uma tool NESTA conversa. Tarefa sem prazo é "sem prazo" — nunca "amanhã", nunca "quinta". Se você não leu a frente, não escreva a frente.
- Ao listar tarefas, use o título EXATO que a tool devolveu. Não conserte, não encurte, não troque o verbo.
- CONFIRMAÇÃO DE ESCRITA vem do RETORNO da tool, nunca da sua intenção. Se a tool não voltou confirmando, diga que não conseguiu — "Marquei como feito ✅" sem retorno de sucesso é a pior coisa que você pode fazer, porque a pessoa para de conferir.
- COMPROMISSO DE AGENDA NÃO TEM "CONCLUÍDO". Se pedirem pra marcar uma reunião como feita, explique que agenda não tem esse estado e ofereça abrir uma tarefa de follow-up. Nunca responda "marquei" pra um item de agenda.
- Na dúvida entre uma frase redonda e uma frase verdadeira, escolha a verdadeira.`;

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

/**
 * Regra de vocativo. O ponto central é o RITMO, não a palavra: a versão
 * anterior mandava tratar como "chefe" "na maior parte das mensagens", e o
 * resultado era "chefe" em toda resposta — que é justamente o que denuncia um
 * robô. Vocativo é tempero: acolhe quando pontual, irrita quando constante.
 *
 * Não precisa de estado pra controlar a frequência: o histórico da conversa
 * já vai no prompt, então o modelo consegue olhar as próprias mensagens
 * anteriores e decidir. Por isso a regra é "olhe acima", e não um contador.
 */
export function buildVocativoBlock(persona: TenantPersona): string {
  if (persona.usaVocativo === false) {
    return `TRATAMENTO
- NUNCA use vocativo. Nada de "chefe", nome, "Sr./Sra." nem apelido — esta pessoa pediu explicitamente pra não ser chamada de nada.
- Vá direto ao conteúdo: "Reagendei pra amanhã às 9h." em vez de "Chefe, reagendei...".`;
  }

  // No meio da frase o padrão "chefe" é substantivo comum e vai minúsculo
  // ("confirmo, chefe?"), mas qualquer coisa que a pessoa configurou é usada
  // COMO ELA ESCREVEU — minusculizar aqui produzia "confirmo, marina?", que
  // é erro de português com nome próprio, "Sr. Yano" e afins.
  const configurado = persona.tratamento?.trim();
  const Voc = configurado || "Chefe";
  const meioFrase = configurado || "chefe";

  return `TRATAMENTO
- Quando for chamar a pessoa, use "${Voc}" — no início ("${Voc}, ...") ou no meio ("...confirmo, ${meioFrase}?"). Escreva exatamente assim, sem variar.
- RITMO (regra dura): no MÁXIMO uma vez a cada 3-4 mensagens suas, NUNCA duas seguidas, e nunca duas vezes na mesma mensagem. Olhe suas mensagens anteriores no histórico: se a última já usou, esta NÃO usa.
- Use quando ele ACOLHE: abrindo conversa depois de um tempo parado, dando notícia ruim ou urgente, ou quando é você que fala primeiro (lembrete, resumo, alerta).
- Não use em troca rápida de mensagens nem em confirmação curta ("Feito ✅", "Marquei", "Magina").
- Repetir a cada resposta é o erro mais comum e o que mais faz parecer robô. Na dúvida, omita — a conversa flui melhor sem.`;
}

// Único exemplo do prompt que carrega vocativo — é de propósito: notícia ruim
// é justamente o momento em que ele acolhe. Sem vocativo configurado, o
// exemplo perde o vocativo em vez de sumir, pra não enfraquecer o tom.
function exemploCrise(persona: TenantPersona): string {
  const base = "o voo das 18h foi cancelado pela companhia. 🌧️ Já me antecipei e consegui no das 19h30. Confirmo?";
  if (persona.usaVocativo === false) return `"O ${base.slice(2)}"`;
  const voc = persona.tratamento?.trim() || "Chefe";
  return `"${voc}, ${base}" (notícia ruim é onde o vocativo acolhe)`;
}

/**
 * A ÚNICA parte do system prompt que muda a cada minuto.
 *
 * Fica isolada de propósito: o prefixo do prompt vai com `cache_control` na
 * chamada com tools (ver fast/index.ts), e o cache do Anthropic casa por
 * prefixo EXATO. Com o "Agora: ..." lá dentro — e ele tem minuto —, o prefixo
 * inteiro (~17k tokens) virava outro a cada minuto que passava, e toda mensagem
 * nova pagava escrita de cache (1,25x) em vez de leitura (0,1x). Medido em
 * `uso_modelo` (31/08/2026): 45% das chamadas escreviam um cache que ninguém
 * leu. Agora este bloco entra num segundo bloco de system, DEPOIS do
 * breakpoint, e não invalida mais o prefixo.
 */
export function blocoAgora(datetime: string): string {
  return `CONTEXTO ATUAL\n- Agora: ${datetime}`;
}

/**
 * `datetime = null` devolve o prompt SEM o bloco "agora" — é a forma usada no
 * caminho com tools, que manda esse bloco separado (ver blocoAgora). Passando
 * a string, o prompt sai completo como sempre foi.
 */
export function buildFastSystemPrompt(
  datetime: string | null,
  persona: TenantPersona = DEFAULT_PERSONA,
): string {
  // Sem tenant resolvido não existe nome real pra usar — e inventar um default
  // com dados de pessoa real foi exatamente o problema corrigido em 10/08/2026.
  const temNome = Boolean(persona.nome?.trim());
  const nome = temNome ? persona.nome!.trim() : "a pessoa que você atende";
  const primeiro = temNome ? firstName(nome) : "CHEFE";
  const cargoLine = persona.cargo ? `- Cargo: ${persona.cargo}\n` : "";
  const frentes = persona.frentes && persona.frentes.length > 0 ? persona.frentes : undefined;
  const frentesLine = frentes
    ? `- Empreendedor gerenciando ${frentes.length} frente${frentes.length === 1 ? "" : "s"}: ${frentes.join(", ")}.\n`
    : "";

  const filled = FAST_SYSTEM_PROMPT_TEMPLATE
    .replaceAll("{{nome}}", nome)
    .replace("{{contexto_atual}}", datetime === null ? "" : `${blocoAgora(datetime)}\n\n`)
    .replace("{{primeiro_nome_upper}}", primeiro.toUpperCase())
    .replace("{{cargo_line}}", cargoLine)
    .replace("{{frentes_line}}", frentesLine)
    .replace("{{familia_block}}", familyBlock(persona.persona))
    .replace("{{vocativo_bloco}}", buildVocativoBlock(persona))
    .replace("{{exemplo_crise}}", exemploCrise(persona));

  // O resto do texto (tom/estilo/limites) ainda fala "Daniel" literalmente —
  // troca pelo primeiro nome real. No-op quando o tenant É o Daniel.
  const comNome = primeiro === "Daniel" ? filled : filled.replace(/\bDaniel\b/g, primeiro);

  // VOZ POR TENANT, sempre por último: o que vem depois no system prompt pesa
  // mais na hora de escolher o tom, e o template acima é genérico de propósito.
  // Passa por `normalizaPersonalidade` mesmo o tipo já sendo `Personalidade`:
  // o valor nasce numa coluna de texto, e um CHECK contornado ou uma migration
  // futura mal aplicada não podem transformar isto em "undefined" no prompt.
  const voz = instrucaoConversa(normalizaPersonalidade(persona.personalidade));
  return `${comNome}\n\n## Sua voz\n${voz}`;
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
    return { ok: false, message: `Erro ao consultar Fast: ${semDadoPessoal(err)}` };
  }
}
