// A mensagem de alerta de prazo (roda 08:00 e 14:00).
//
// POR QUE VIROU UM MÓDULO. Até 03/09/2026 o texto era montado dentro do cron,
// agrupado por (frente × vencida?). Num dia com duas frentes isso vira até
// QUATRO mensagens no mesmo minuto — e foi o que aconteceu: às 14:00 chegaram
// três bolhas seguidas, com a mais urgente no meio, porque a ordem era a de
// inserção num Map. Agora é uma mensagem só, e função pura dá pra testar.
//
// NÃO PERGUNTA NADA, de propósito. O dia já tem duas mensagens que pedem
// resposta (13:00 e 19:00). Esta é aviso: chega, informa, e sai. Uma terceira
// pergunta sobre o mesmo assunto é a redundância que o Daniel já apontou.
//
// SEM NEGRITO. WhatsApp faz com `*um*`, Telegram só converte `**dois**`, e a
// mesma string vai pros dois canais — o cabeçalho de seção é o próprio emoji.

/** Um prazo em aberto, com tudo já formatado por quem leu. */
export interface PrazoEmAberto {
  nome: string;
  /** Frente (ou frente/lista). Vazio quando o tenant não usa frentes. */
  frente: string;
  /** Vencimento já escrito: "02/09" quando o prazo é só data, "03/09, 15:00" quando tem hora. */
  quando: string;
}

/** Teto de linhas — o mesmo do fim do dia, pelo mesmo motivo. */
export const PRAZOS_MAX_ITENS = 15;

function linhas(itens: PrazoEmAberto[], mostraFrente: boolean, verbo: string): string {
  return itens
    .map((p) => {
      const frente = mostraFrente && p.frente.trim() !== "" ? ` · ${p.frente}` : "";
      return `· ${p.nome}${frente} — ${verbo} ${p.quando}`;
    })
    .join("\n");
}

/**
 * A mensagem inteira, ou `null` quando não há nada a avisar.
 *
 * Vencidas SEMPRE primeiro: era o contrário na prática, e ler "vence amanhã"
 * antes de "venceu ontem" inverte a ordem em que a pessoa precisa agir.
 */
export function montaMensagemDePrazos(
  vencidas: PrazoEmAberto[],
  vencendo: PrazoEmAberto[],
): string | null {
  const total = vencidas.length + vencendo.length;
  if (total === 0) return null;

  // O corte respeita a prioridade: vencida ocupa vaga antes de vencendo.
  const v = vencidas.slice(0, PRAZOS_MAX_ITENS);
  const s = vencendo.slice(0, Math.max(0, PRAZOS_MAX_ITENS - v.length));

  // Frente só aparece quando há mais de uma em jogo — com uma só, é a mesma
  // palavra repetida em toda linha.
  const frentes = new Set([...v, ...s].map((p) => p.frente).filter((f) => f.trim() !== ""));
  const mostraFrente = frentes.size > 1;

  const blocos: string[] = [];
  if (v.length > 0) blocos.push(`🔴 Venceram\n${linhas(v, mostraFrente, "venceu")}`);
  if (s.length > 0) blocos.push(`🟡 Vencem em breve\n${linhas(s, mostraFrente, "vence")}`);

  const corte = total > PRAZOS_MAX_ITENS ? `\n\n(mostrei ${PRAZOS_MAX_ITENS} de ${total})` : "";
  return `${blocos.join("\n\n")}${corte}`;
}
