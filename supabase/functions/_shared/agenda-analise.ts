// Análise da agenda — lógica pura, sem I/O, pra poder ser testada de verdade.
//
// Fica separada do cron de propósito: é o tipo de regra que falha em silêncio
// (deixa de avisar, ou avisa à toa) e ninguém percebe em produção.

export interface EventoAgenda {
  titulo: string;
  inicio: Date;
  fim: Date;
}

// Uma "maratona" é uma sequência de compromissos com no máximo este intervalo
// entre um e outro. 15 min é o limite prático: dá pra ir ao banheiro, não dá
// pra almoçar nem trocar de contexto.
export const INTERVALO_COLADO_MIN = 15;
export const MIN_REUNIOES_SEGUIDAS = 3;
export const MIN_DURACAO_TOTAL_MIN = 150;

/**
 * Maior sequência de compromissos colados, se ela for longa o bastante pra
 * valer um aviso. null = agenda tranquila (o caso normal — silêncio).
 *
 * Os dois critérios juntos importam: 3 reuniões de 15 min coladas não são um
 * problema (45 min), e 2 reuniões de 2h com intervalo de 1h também não. O que
 * cansa é volume E ausência de respiro ao mesmo tempo.
 */
export function detectaMaratona(eventos: EventoAgenda[]): EventoAgenda[] | null {
  if (eventos.length < MIN_REUNIOES_SEGUIDAS) return null;
  const ordenados = [...eventos].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  let melhor: EventoAgenda[] = [];
  let atual: EventoAgenda[] = [ordenados[0]];

  for (let i = 1; i < ordenados.length; i++) {
    // Compara com o fim MAIS TARDIO da sequência até agora, não com o último
    // evento da lista: compromissos sobrepostos (um dentro do outro) fariam o
    // fim "andar pra trás" e quebrariam a sequência sem motivo.
    const fimCorrente = Math.max(...atual.map((e) => e.fim.getTime()));
    const gapMin = (ordenados[i].inicio.getTime() - fimCorrente) / 60_000;
    if (gapMin <= INTERVALO_COLADO_MIN) {
      atual.push(ordenados[i]);
    } else {
      if (atual.length > melhor.length) melhor = atual;
      atual = [ordenados[i]];
    }
  }
  if (atual.length > melhor.length) melhor = atual;

  if (melhor.length < MIN_REUNIOES_SEGUIDAS) return null;
  const fimTotal = Math.max(...melhor.map((e) => e.fim.getTime()));
  const duracaoMin = (fimTotal - melhor[0].inicio.getTime()) / 60_000;
  return duracaoMin >= MIN_DURACAO_TOTAL_MIN ? melhor : null;
}

export function duracaoTexto(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
