// Leitura de e-mail PRA O RESUMO DA MANHÃ, com um fato apurado junto:
// existe resposta minha pra este assunto?
//
// Sem esse fato, o brief só consegue dizer "chegou um e-mail do Everton" —
// que é o que a caixa de entrada já diz. Com ele, dá pra separar o que está
// esperando de mim do que já andou. Foi a diferença que apareceu no brief de
// referência: "ele perguntou X — não vi resposta sua".
//
// O QUE ESTE MÓDULO NÃO FAZ, de propósito:
//
//   - não decide se um e-mail "pede resposta" (isso é leitura de sentido, e
//     quem faz é o modelo, com os fatos daqui no bloco de dados);
//   - não compara assunto de e-mail com título de evento da agenda pra dizer
//     "não está marcado". Casamento aproximado de texto foi exatamente o que
//     fez "classe i" casar dentro de "CLASSIFICADOS" no filtro de editais. A
//     agenda inteira vai pro bloco e o modelo confere olhando a lista.
//
// O provider (Gmail ou Outlook) entra por parâmetro: os dois expõem a mesma
// `listRecentEmails({n, query})`, então este módulo não sabe qual está em uso.

import type { EmailBrief } from "./brief-manha.ts";

/** Quantos e-mails recebidos entram na leitura. Acima disso vira ruído no prompt. */
export const MAX_EMAILS_RECEBIDOS = 12;
/** Quantos enviados são lidos só pra procurar resposta. */
export const MAX_EMAILS_ENVIADOS = 25;
/** Janela de leitura: e-mail de três dias atrás já não é assunto de hoje. */
export const DIAS_DE_JANELA = 3;

/** O formato que Gmail e Outlook devolvem (ver fast/tools/gmail-read.ts). */
export interface EmailCru {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
}

export type LeitorDeEmail = (input: { n: number; query?: string }) => Promise<EmailCru[]>;

/**
 * Assunto comparável: sem "Re:"/"Res:"/"Fwd:"/"Enc:" repetidos, sem acento,
 * sem pontuação, minúsculo, espaço colapsado.
 *
 * Comparação é EXATA depois disso. Aproximação aqui erraria pro lado perigoso:
 * achar uma resposta que não existe faz o brief calar sobre algo que está
 * mesmo esperando.
 */
export function normalizaAssunto(assunto: string): string {
  return assunto
    .replace(/^\s*((re|res|fw|fwd|enc|encaminhando)\s*(\[\d+\])?\s*:\s*)+/gi, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Data ISO → epoch ms, ou NaN quando o provider mandou algo que não é data. */
function ms(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Promoção e rede social fora da leitura.
 *
 * Em 03/09/2026 o resumo da manhã terminou assim: "Fechou sem você: Audible,
 * Noun Project, Starbuzz, Samsung, Candy AI, Google, Netlify, Cutterman, Play,
 * Cinemark, Granola." Onze nomes, nenhum deles uma coisa que fechou — era a
 * caixa de entrada crua, que numa manhã qualquer é quase toda mala direta. O
 * modelo não inventou: recebeu doze e-mails sem filtro e fez o que dava pra
 * fazer com eles.
 *
 * `updates` NÃO entra no corte. É onde o Gmail joga confirmação de pedido e
 * aviso de fornecedor junto com notificação de deploy — cortar tiraria ruído e
 * levaria junto e-mail que importa, sem avisar ninguém. Ruído a mais é
 * incômodo; e-mail real sumindo em silêncio é o erro caro.
 *
 * O provider do Outlook traduz a mesma sintaxe (ver traduzQueryParaFiltroGraph);
 * onde a categoria não existir, o termo simplesmente não filtra nada.
 */
const SEM_MALA_DIRETA = "-category:promotions -category:social";

/**
 * Recebidos da janela, cada um marcado com "existe resposta minha depois
 * disto, com este assunto?".
 *
 * Qualquer falha na leitura dos ENVIADOS degrada pra `false` em todos — e o
 * prompt traduz `false` como "não vi resposta sua", que continua verdadeiro
 * (não vimos mesmo). O contrário — assumir que respondeu — silenciaria um
 * assunto aberto, que é o erro caro.
 */
export async function leEmailsDoBrief(
  ler: LeitorDeEmail,
  agora: Date = new Date(),
): Promise<EmailBrief[]> {
  const desde = new Date(agora.getTime() - DIAS_DE_JANELA * 86400_000);
  // Gmail entende `after:AAAA/MM/DD`; o provider do Outlook traduz a mesma
  // sintaxe pro filtro do Graph (ver traduzQueryParaFiltroGraph).
  const depoisDe = `after:${desde.getFullYear()}/${String(desde.getMonth() + 1).padStart(2, "0")}/${
    String(desde.getDate()).padStart(2, "0")
  }`;

  const recebidos = await ler({
    n: MAX_EMAILS_RECEBIDOS,
    query: `in:inbox ${SEM_MALA_DIRETA} ${depoisDe}`,
  });
  if (recebidos.length === 0) return [];

  let enviados: EmailCru[] = [];
  try {
    enviados = await ler({ n: MAX_EMAILS_ENVIADOS, query: `in:sent ${depoisDe}` });
  } catch {
    // Segue sem os enviados: melhor um "não vi resposta sua" a mais do que
    // perder o bloco inteiro de e-mail.
    enviados = [];
  }

  const respostasPorAssunto = new Map<string, number>();
  for (const e of enviados) {
    const chave = normalizaAssunto(e.subject);
    if (!chave) continue;
    const quando = ms(e.date);
    if (Number.isNaN(quando)) continue;
    const atual = respostasPorAssunto.get(chave);
    if (atual === undefined || quando > atual) respostasPorAssunto.set(chave, quando);
  }

  return recebidos.map((e): EmailBrief => {
    const chave = normalizaAssunto(e.subject);
    const respondidoEm = chave ? respostasPorAssunto.get(chave) : undefined;
    const recebidoEm = ms(e.date);
    // A resposta precisa ser DEPOIS do recebido — senão uma troca antiga com
    // o mesmo assunto contaria como resposta pra mensagem de hoje.
    const respostaSuaEncontrada = respondidoEm !== undefined &&
      !Number.isNaN(recebidoEm) &&
      respondidoEm >= recebidoEm;
    return {
      de: e.from,
      assunto: e.subject,
      trecho: e.snippet,
      respostaSuaEncontrada,
    };
  });
}
