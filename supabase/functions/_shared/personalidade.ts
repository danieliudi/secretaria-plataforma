// Voz da secretária, por tenant.
//
// POR QUE EXISTE: a voz era única e embutida no prompt. Escritório de
// contabilidade e estúdio de design não querem a mesma secretária, e não havia
// como diferenciar sem editar código.
//
// REGRA DE SEGURANÇA DESTE MÓDULO: o banco guarda um RÓTULO ('direta',
// 'cordial', ...), nunca o texto da instrução. O texto mora aqui, versionado.
// Se a instrução viesse da coluna, qualquer escrita no `tenants` viraria
// injeção de prompt — quem alterasse a linha reescreveria o comportamento da
// secretária de todos os canais daquele tenant. Rótulo desconhecido cai no
// padrão em vez de explodir ou de virar texto livre.
//
// O DEGRAU DE FORMALIDADE: quase ninguém fala com o cliente do mesmo jeito que
// fala com a própria secretária. Em vez de dois campos de configuração, a
// personalidade escolhida vale pra conversa, e o texto que sai PRA TERCEIRO
// sobe um degrau sozinho. Ver `subirUmDegrau` — inclusive o caso do `direta`,
// que de propósito NÃO sobe.

export type Personalidade = "direta" | "cordial" | "formal" | "leve";

export const PERSONALIDADES: readonly Personalidade[] = [
  "direta",
  "cordial",
  "formal",
  "leve",
] as const;

/**
 * Meio-termo. Tenant que existia antes desta coluna cai aqui, e é o default do
 * banco — os dois lugares precisam concordar.
 */
export const PERSONALIDADE_PADRAO: Personalidade = "cordial";

/** Converte valor vindo do banco/entrada em personalidade válida. */
export function normalizaPersonalidade(valor: unknown): Personalidade {
  if (typeof valor !== "string") return PERSONALIDADE_PADRAO;
  const v = valor.trim().toLowerCase();
  return (PERSONALIDADES as readonly string[]).includes(v)
    ? (v as Personalidade)
    : PERSONALIDADE_PADRAO;
}

// ─── como ela fala COM o usuário ────────────────────────────────────────────

const CONVERSA: Record<Personalidade, string> = {
  direta:
    "Fale no menor número de palavras possível. Sem saudação, sem preâmbulo e " +
    "sem fecho. Frases curtas, dado primeiro. Não repita a pergunta antes de " +
    "responder. Nunca use emoji.",

  cordial:
    "Fale de forma profissional e calorosa, como uma colega prestativa. " +
    "Saudação breve só quando fizer sentido, nunca em toda mensagem. Frases " +
    "completas e diretas, sem rodeio. Nunca use emoji.",

  formal:
    "Trate a pessoa com formalidade. Frases completas, vocabulário corporativo, " +
    "sem contração informal, sem gíria e sem emoji. Prefira 'confirmo que', " +
    "'informo que', 'permanece agendado'.",

  leve:
    "Fale de forma descontraída, como uma amiga próxima que trabalha com a " +
    "pessoa. Linguagem coloquial é bem-vinda. No máximo um emoji por mensagem, " +
    "e só quando somar alguma coisa.",
};

/** Instrução de voz pro prompt de sistema, na conversa com o usuário. */
export function instrucaoConversa(p: Personalidade): string {
  return CONVERSA[p];
}

// ─── como ela redige PRA TERCEIRO ───────────────────────────────────────────

/**
 * Sobe um degrau de formalidade, pro texto que o usuário vai enviar a outra
 * pessoa.
 *
 * `direta` NÃO sobe, e isso é decisão de projeto, não esquecimento: `direta` é
 * eixo de BREVIDADE, não de informalidade. "Ana, confirmando nosso alinhamento
 * amanhã 14h." é perfeitamente enviável a um cliente. Empurrar pra `cordial`
 * devolveria justamente a saudação e o fecho que a pessoa escolheu não ter.
 */
export function subirUmDegrau(p: Personalidade): Personalidade {
  switch (p) {
    case "leve":
      return "cordial";
    case "cordial":
      return "formal";
    case "formal":
      return "formal";
    case "direta":
      return "direta";
  }
}

const REDACAO: Record<Personalidade, string> = {
  direta:
    "Vá direto ao ponto: vocativo, o fato e a pergunta. Sem saudação de " +
    "abertura e sem fecho. Uma ou duas frases no total.",

  cordial:
    "Abra com uma saudação curta, diga a que veio em uma ou duas frases e " +
    "termine com uma pergunta objetiva. Sem emoji.",

  formal:
    "Use tratamento formal ('Prezado(a)'), frases completas e vocabulário " +
    "corporativo. Sem contração informal, sem gíria, sem emoji.",

  leve:
    "Tom leve e próximo, frases curtas. No máximo um emoji.",
};

/**
 * Instrução de voz pro texto que a secretária REDIGE e o usuário vai enviar a
 * um terceiro. Já aplica o degrau — o chamador passa a personalidade do tenant,
 * não a ajustada.
 */
export function instrucaoRedacao(p: Personalidade): string {
  const alvo = subirUmDegrau(p);
  return (
    "Este texto NÃO é para o usuário: é uma mensagem que ELE vai enviar a outra " +
    "pessoa, do WhatsApp dele. Escreva na voz dele, nunca na sua, e nunca se " +
    "apresente como assistente. " +
    REDACAO[alvo]
  );
}
