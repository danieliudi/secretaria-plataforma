// Catálogo dos templates aprovados na Meta, e o portão que monta o payload.
//
// POR QUE ISTO É UM CATÁLOGO FECHADO EM CÓDIGO: fora da janela de 24h, o
// WhatsApp só aceita template previamente aprovado. A secretária NÃO escreve a
// primeira mensagem — ela preenche variáveis de um texto que a Meta já leu.
// Se o nome do template viesse do modelo ou do banco, a gente teria construído
// exatamente o caminho que a plataforma proíbe, e descobriria pelo bloqueio da
// conta.
//
// O corpo abaixo é o texto EXATO submetido à Meta. Ele mora aqui versionado
// pra que a divergência entre o que foi aprovado e o que a gente acha que foi
// aprovado seja visível num diff — divergência silenciosa aqui significa
// mensagem rejeitada em produção, sem erro nosso.
//
// REGRAS DE VARIÁVEL DA META, todas cobertas por teste: não pode conter quebra
// de linha, tabulação, nem 5+ espaços seguidos. Violar isso não dá erro de
// validação nossa — a Meta rejeita a mensagem na hora do envio, uma a uma.

/** Só existem estes. Nome fora da lista é recusado, não enviado. */
export type NomeTemplate = "confirmacao_compromisso" | "lembrete_compromisso";

export interface DefinicaoTemplate {
  nome: NomeTemplate;
  /** Categoria na Meta. Só Utility — Marketing exige opt-in prévio e custa ~9x. */
  categoria: "utility";
  idioma: "pt_BR";
  /** Nomes das variáveis na ORDEM de {{1}}, {{2}}… que a Meta espera. */
  variaveis: readonly string[];
  /** Corpo exato submetido à Meta. */
  corpo: string;
  /** Rodapé fixo do template (não é variável). Existe por LGPD, não por exigência da Meta. */
  rodape: string;
}

export const TEMPLATES: Record<NomeTemplate, DefinicaoTemplate> = {
  confirmacao_compromisso: {
    nome: "confirmacao_compromisso",
    categoria: "utility",
    idioma: "pt_BR",
    variaveis: ["destinatario", "remetente", "compromisso", "dia", "hora"],
    corpo: [
      "Oi {{1}}, aqui é a secretária do {{2}}.",
      "",
      "Confirmando: {{3}}, {{4}} às {{5}}.",
      "",
      "Segue de pé?",
    ].join("\n"),
    rodape: "Responda SAIR para não receber mais",
  },
  lembrete_compromisso: {
    nome: "lembrete_compromisso",
    categoria: "utility",
    idioma: "pt_BR",
    variaveis: ["destinatario", "compromisso", "hora"],
    corpo: [
      "Oi {{1}}, lembrete do {{2}} hoje às {{3}}.",
      "",
      "Qualquer imprevisto é só avisar por aqui.",
    ].join("\n"),
    rodape: "Responda SAIR para não receber mais",
  },
};

/**
 * Teto por variável. A Meta corta o corpo inteiro em 1024 caracteres; manter
 * cada variável curta evita descobrir isso com a mensagem truncada no celular
 * de um cliente.
 */
export const MAX_VARIAVEL = 120;

/** Payload do Cloud API, na forma que a Meta espera em POST /messages. */
export interface PayloadTemplate {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: NomeTemplate;
    language: { code: "pt_BR" };
    components: Array<{
      type: "body";
      parameters: Array<{ type: "text"; text: string }>;
    }>;
  };
}

export type ResultadoTemplate =
  | { ok: true; payload: PayloadTemplate; previa: string }
  | { ok: false; motivo: string };

/** Regras da Meta pro conteúdo de uma variável. */
function variavelInvalida(valor: string): string | null {
  if (valor.trim() === "") return "Faltou preencher um dado da mensagem.";
  if (valor.length > MAX_VARIAVEL) return "Um dos dados da mensagem ficou longo demais.";
  // A Meta rejeita quebra de linha, tab e 5+ espaços seguidos DENTRO da
  // variável. Rejeitamos antes pra não gastar uma chamada e não deixar a falha
  // aparecer só do lado de lá.
  if (/[\n\r\t]/.test(valor)) return "Um dos dados da mensagem tem quebra de linha.";
  if (/ {5,}/.test(valor)) return "Um dos dados da mensagem tem espaçamento inválido.";
  return null;
}

/**
 * Monta o payload de envio a partir de um template conhecido.
 *
 * Recusa nome desconhecido, variável faltando, sobrando ou inválida. Não existe
 * caminho aqui que envie texto livre.
 */
export function montaTemplate(
  nome: string,
  telefoneE164: string,
  valores: Record<string, string>,
): ResultadoTemplate {
  // `Object.hasOwn`, NUNCA `TEMPLATES[nome]` direto: busca por chave caminha na
  // cadeia de protótipos, então "constructor", "__proto__" e "toString"
  // devolvem valor truthy de Object.prototype e ATRAVESSAM um `if (!def)`.
  // Um nome de template arbitrário furando o portão é precisamente o que este
  // módulo existe pra impedir — pego por teste em 14/08/2026.
  if (!Object.hasOwn(TEMPLATES, nome)) {
    // O portão. Texto livre e template não aprovado morrem aqui.
    return { ok: false, motivo: "Essa mensagem não tem modelo aprovado — vai por link." };
  }
  const def = TEMPLATES[nome as NomeTemplate];

  if (!/^55[1-9][0-9]{9,10}$/.test(telefoneE164)) {
    return { ok: false, motivo: "O telefone não está no formato esperado." };
  }

  const parametros: Array<{ type: "text"; text: string }> = [];
  for (const chave of def.variaveis) {
    const valor = valores[chave];
    if (typeof valor !== "string") {
      return { ok: false, motivo: "Faltou preencher um dado da mensagem." };
    }
    const erro = variavelInvalida(valor);
    if (erro) return { ok: false, motivo: erro };
    parametros.push({ type: "text", text: valor });
  }

  // Variável a mais indica descompasso entre quem chama e o catálogo — sinal de
  // que o template mudou na Meta e o código não acompanhou. Recusar é melhor do
  // que enviar com dado que ninguém sabe onde vai parar.
  const extras = Object.keys(valores).filter((k) => !def.variaveis.includes(k));
  if (extras.length > 0) {
    return { ok: false, motivo: "A mensagem recebeu dados que o modelo não conhece." };
  }

  // Prévia com as variáveis substituídas — é o que a Yuka mostra pro usuário
  // antes de enviar, e o que fica legível numa auditoria.
  let previa = def.corpo;
  def.variaveis.forEach((chave, i) => {
    previa = previa.replaceAll(`{{${i + 1}}}`, valores[chave]);
  });

  return {
    ok: true,
    previa: `${previa}\n\n${def.rodape}`,
    payload: {
      messaging_product: "whatsapp",
      to: telefoneE164,
      type: "template",
      template: {
        name: def.nome,
        language: { code: def.idioma },
        components: [{ type: "body", parameters: parametros }],
      },
    },
  };
}
