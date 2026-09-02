// As duas listas que descrevem um dia — agenda e pendências — num lugar só.
//
// POR QUE EXISTE: o resumo das 06:00 e a pergunta das 19:00 falam do MESMO dia
// e, até 02/09/2026, faziam isso por caminhos diferentes — o resumo era escrito
// pelo modelo a partir de um prompt, o fim do dia era montado no código. Deu no
// que tinha que dar, no mesmo 01/09:
//
//   - um evento de dia inteiro apareceu às 06:00 e sumiu às 19:00;
//   - três tarefas atrasadas saíram como "Prazo hoje" de manhã e "venceu 31/08"
//     duas horas depois.
//
// Nome e data de tarefa são FATO, não redação. Não passam mais por modelo. O
// que continua no modelo é só o bloco de sinais do resumo, que é síntese de
// verdade — e é justamente o que o código não sabe fazer.
//
// A ESTRUTURA SE ADAPTA AO TAMANHO DO DIA, de propósito. Cabeçalho de frente
// numa lista de 3 itens custa mais linha do que economiza, e todo tenant novo
// começa com um dia pequeno: hierarquia fixa é fricção pra quem tem pouco.

/** Um compromisso do dia. */
export interface ItemAgenda {
  titulo: string;
  /** Hora de início em SP ("09:00"). `null` = evento de dia inteiro. */
  hora: string | null;
}

/** Uma tarefa em aberto que o dia de hoje precisa encarar. */
export interface Pendencia {
  nome: string;
  /** Frente/cliente. String vazia quando o tenant não usa frentes. */
  frente: string;
  /** Vencimento já formatado curto ("31/08"). */
  vence: string;
  /** Venceu antes de hoje. */
  atrasada: boolean;
}

/**
 * Acima disto a lista passa a agrupar por frente; abaixo, a frente vira sufixo
 * da linha. O corte não é estético: com poucos itens, cada cabeçalho de frente
 * é uma linha inteira gasta pra economizar uma palavra por linha — só passa a
 * valer a pena quando há linha suficiente pra amortizar.
 */
export const AGRUPA_POR_FRENTE_ACIMA_DE = 8;

/** "· 09:00 Alinhamento" ou "· Dia todo Trocar filtro" — nunca um 00:00 falso. */
export function linhaAgenda(i: ItemAgenda): string {
  return `· ${i.hora ?? "Dia todo"} ${i.titulo}`;
}

/** Sufixo de prazo: o que a pessoa precisa saber pra priorizar. */
function prazo(p: Pendencia): string {
  return p.atrasada ? `atrasada ${p.vence}` : "hoje";
}

/** Bloco da agenda. Vazio devolve "" — bloco sem conteúdo não é escrito. */
export function montaBlocoAgenda(itens: ItemAgenda[]): string {
  if (itens.length === 0) return "";
  return `*Agenda*\n${itens.map(linhaAgenda).join("\n")}`;
}

/**
 * Bloco de pendências. Vazio devolve "".
 *
 * Três formatos, escolhidos pelo tamanho e não por configuração:
 *   - uma frente só (ou nenhuma): o nome dela some — seria a mesma palavra em
 *     toda linha;
 *   - várias frentes, lista curta: frente vira sufixo;
 *   - várias frentes, lista longa: agrupa, e o sufixo sai.
 */
export function montaBlocoPendencias(itens: Pendencia[]): string {
  if (itens.length === 0) return "";
  const cabecalho = `*Pendências (${itens.length})*`;
  const frentes = new Set(itens.map((p) => p.frente).filter((f) => f.trim() !== ""));

  if (frentes.size <= 1) {
    return `${cabecalho}\n${itens.map((p) => `· ${p.nome} · ${prazo(p)}`).join("\n")}`;
  }

  if (itens.length <= AGRUPA_POR_FRENTE_ACIMA_DE) {
    return `${cabecalho}\n${itens.map((p) => `· ${p.nome} · ${p.frente} · ${prazo(p)}`).join("\n")}`;
  }

  // Ordem de aparição, não alfabética: quem tem mais coisa pendente costuma ser
  // a frente que o dia vai girar em volta, e ela já vem primeiro de quem chama.
  const porFrente = new Map<string, Pendencia[]>();
  for (const p of itens) {
    const chave = p.frente.trim() === "" ? "Outras" : p.frente;
    porFrente.set(chave, [...(porFrente.get(chave) ?? []), p]);
  }
  const grupos = [...porFrente.entries()].map(([frente, ps]) =>
    `*${frente} (${ps.length})*\n${ps.map((p) => `· ${p.nome} · ${prazo(p)}`).join("\n")}`
  );
  return `${cabecalho}\n\n${grupos.join("\n\n")}`;
}

/**
 * O resumo da manhã inteiro. `sinais` é a única parte escrita pelo modelo —
 * entra pronta, ou vazia quando não há sinal (e aí o bloco não existe).
 *
 * Dia sem nada devolve uma linha só. Silêncio total seria pior: some sem
 * explicar por quê, e a pessoa fica sem saber se a Mia quebrou.
 */
export function montaResumoDaManha(
  dataPorExtenso: string,
  agenda: ItemAgenda[],
  pendencias: Pendencia[],
  sinais = "",
): string {
  const blocos = [
    montaBlocoAgenda(agenda),
    montaBlocoPendencias(pendencias),
    sinais.trim() ? `*Sinais*\n${sinais.trim()}` : "",
  ].filter((b) => b !== "");

  if (blocos.length === 0) return `*${dataPorExtenso}*\n\nDia limpo — nada na agenda e nada pendente.`;
  return `*${dataPorExtenso}*\n\n${blocos.join("\n\n")}`;
}
