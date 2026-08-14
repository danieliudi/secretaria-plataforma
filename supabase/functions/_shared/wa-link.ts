// Construtor do link `wa.me` — o mecanismo de "redigir, não enviar".
//
// POR QUE EXISTE: a plataforma NÃO dispara mensagem pra terceiro. Rodamos em
// Evolution API, que é WhatsApp não-oficial; disparo pra quem não pediu contato
// é a via mais rápida de banimento do número — e o número É a plataforma do
// tenant. Some o número, some o cliente inteiro, não uma funcionalidade.
//
// Então a Yuka redige e devolve um link. Quem toca é o usuário, quem envia é o
// número DELE, pra alguém com quem ELE já tem relação. Sem banimento, sem base
// legal pra buscar (LGPD), sem agente autônomo comprometendo horário errado.
//
// A ARMADILHA DESTE MÓDULO é o encoding. `encodeURI` NÃO escapa `&`, `#` nem
// `+` — e um texto inocente como "confirmando 14h & levo o orçamento" vira
// query string cortada: a mensagem chega truncada em "confirmando 14h" e o
// resto some. Isso não gera erro em lugar nenhum, o link abre normalmente. Só
// `encodeURIComponent` serve aqui, e existe teste travando exatamente isso.

import { normalizaTelefoneBr } from "./telefone.ts";

/**
 * Teto do texto. Mensagem de confirmação é curta por natureza; texto gigante
 * indica que o modelo alucinou ou que entrada hostil vazou pra cá. Também
 * protege o comprimento da URL, que alguns clientes truncam sem avisar.
 */
export const MAX_TEXTO = 1000;

export type LinkOk = {
  ok: true;
  url: string;
  /** E.164 sem "+", útil pro chamador guardar em `contatos`. */
  e164: string;
};

export type LinkErro = {
  ok: false;
  /** Em pt-BR, pronto pra Yuka repetir. Nunca ecoa telefone nem texto. */
  motivo: string;
};

export type Link = LinkOk | LinkErro;

/**
 * Monta o link que abre a conversa do WhatsApp com a mensagem já digitada.
 *
 * O telefone entra em qualquer formato — a normalização pra E.164 acontece
 * aqui dentro.
 */
export function montaLinkWhatsApp(telefone: string, texto: string): Link {
  const tel = normalizaTelefoneBr(telefone);
  if (!tel.ok) return { ok: false, motivo: tel.motivo };

  if (typeof texto !== "string" || texto.trim() === "") {
    return { ok: false, motivo: "Não tenho texto nenhum pra colocar na mensagem." };
  }

  if (texto.length > MAX_TEXTO) {
    return { ok: false, motivo: "O texto ficou longo demais pra uma mensagem." };
  }

  // encodeURIComponent, NUNCA encodeURI. Ver comentário do topo.
  const url = `https://wa.me/${tel.e164}?text=${encodeURIComponent(texto)}`;

  return { ok: true, url, e164: tel.e164 };
}
