// Saneamento de log.
//
// POR QUE EXISTE: em 12/08/2026 a auditoria achou 191 linhas em `async_debug`
// com o telefone do usuário em texto puro (`5511…@s.whatsapp.net`), numa tabela
// sem dono, sem expurgo e sem prazo. A causa não foi descuido pontual — foi
// `String(err)` jogado direto no log. A mensagem de erro da Evolution ecoa o
// campo `number` que ela recebeu; a do Telegram ecoa o `chat_id`. Ou seja: todo
// erro de ENTREGA gravava o identificador da pessoa.
//
// A regra que este módulo aplica: NENHUM erro de origem externa vai pra log ou
// pra `async_debug` sem passar por aqui. Erro de terceiro é texto que a gente
// não escreveu e não controla — tratar como hostil vale pro log também, não só
// pro prompt.

/** Teto de tamanho. Log é pra diagnosticar, não pra arquivar corpo de resposta. */
const MAX_LEN = 300;

// A ORDEM importa: o JID do WhatsApp (`5511...@s.whatsapp.net`) casa com o
// padrão de e-mail, e o telefone casa com o de dígitos. Do mais específico pro
// mais genérico, senão a regra ampla consome a estreita e o marcador fica errado.
const REGRAS: Array<[RegExp, string]> = [
  // Chaves e tokens conhecidos — antes de tudo: alguns contêm dígitos e "@".
  [/\b(sb_secret_|sb_publishable_|sk-ant-|gsk_|ya29\.|AIza)[A-Za-z0-9._~+/-]+/g, "[segredo]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [segredo]"],
  // Token de bot do Telegram: 123456789:AAH... — o ":" separa id de segredo.
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}/g, "[segredo]"],
  // JID do WhatsApp, individual e de grupo.
  [/\b\d{5,}(-\d+)?@[a-z]\.(whatsapp|us)\.net\b/gi, "[jid]"],
  [/\b\d{5,}@g\.us\b/gi, "[jid-grupo]"],
  // E-mail.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  // Sequência longa de dígitos: telefone solto, chat_id do Telegram, epoch em ms.
  // Perder o epoch no log é aceitável — a linha já tem timestamp próprio.
  [/\b\d{7,}\b/g, "[num]"],
];

/**
 * Devolve uma versão do valor segura pra log: sem identificador de pessoa, sem
 * segredo, e com tamanho limitado.
 *
 * Aceita `unknown` de propósito — o uso quase sempre é `semDadoPessoal(err)`
 * num `catch`, onde o tipo não é garantido.
 */
export function semDadoPessoal(valor: unknown): string {
  let texto: string;
  try {
    texto = valor instanceof Error
      // `err.message` e não `String(err)`: a stack traz caminho de arquivo e
      // não ajuda em nada num log de edge function.
      ? `${valor.name}: ${valor.message}`
      : typeof valor === "string"
      ? valor
      : JSON.stringify(valor) ?? String(valor);
  } catch {
    // Objeto com referência circular ou getter que lança — não deixa o
    // saneamento derrubar o caminho de erro que ele deveria proteger.
    texto = "[valor não serializável]";
  }

  for (const [padrao, marcador] of REGRAS) texto = texto.replace(padrao, marcador);

  return texto.length > MAX_LEN ? `${texto.slice(0, MAX_LEN)}…` : texto;
}

/**
 * Apelido curto e estável pra um identificador de usuário, pra correlacionar
 * linhas de log da mesma pessoa sem gravar quem ela é.
 *
 * HONESTIDADE SOBRE O QUE ISSO É: pseudonimização, NÃO anonimização. Telefone
 * brasileiro tem pouca entropia (~10^9 combinações) — quem tiver a lista e este
 * algoritmo reconstrói o número por força bruta em segundos. Serve pra tirar o
 * número de vista, não pra tornar o log inofensivo. Log continua sendo dado
 * pessoal e continua sujeito a prazo de retenção.
 *
 * FNV-1a em vez de SHA: `crypto.subtle` é assíncrono, e um log não pode virar
 * ponto de await no meio de um catch.
 */
export function apelidoDeUsuario(userId: string | undefined | null): string {
  if (!userId) return "sem-id";
  const canal = userId.startsWith("tg:") ? "tg" : "wa";
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${canal}-${h.toString(16).padStart(8, "0")}`;
}
