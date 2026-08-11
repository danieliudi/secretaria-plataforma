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

// ─── conflito: dois compromissos no mesmo horário ───────────────────────────

/** Sobreposição menor que isto é encosto de borda, não conflito de verdade. */
export const SOBREPOSICAO_MIN = 5;

export interface Conflito {
  a: EventoAgenda;
  b: EventoAgenda;
  /** Minutos que os dois dividem. */
  sobreposicaoMin: number;
}

/**
 * Pares de compromissos que se sobrepõem. Devolve os pares, não os eventos
 * soltos, porque a mensagem é sobre a COLISÃO — "duas coisas às 15h" — e não
 * sobre um evento isolado.
 *
 * Ordenado pela maior sobreposição primeiro: se o dia tiver vários conflitos,
 * o pior é o que merece a mensagem.
 */
export function detectaConflitos(eventos: EventoAgenda[]): Conflito[] {
  const ordenados = [...eventos].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  const conflitos: Conflito[] = [];

  for (let i = 0; i < ordenados.length; i++) {
    for (let j = i + 1; j < ordenados.length; j++) {
      // Como está ordenado por início, o primeiro j que começa depois do fim
      // de i encerra a busca deste i — nenhum j seguinte pode sobrepor.
      if (ordenados[j].inicio.getTime() >= ordenados[i].fim.getTime()) break;
      const fimComum = Math.min(ordenados[i].fim.getTime(), ordenados[j].fim.getTime());
      const inicioComum = Math.max(ordenados[i].inicio.getTime(), ordenados[j].inicio.getTime());
      const sobreposicaoMin = (fimComum - inicioComum) / 60_000;
      if (sobreposicaoMin >= SOBREPOSICAO_MIN) {
        conflitos.push({ a: ordenados[i], b: ordenados[j], sobreposicaoMin });
      }
    }
  }
  return conflitos.sort((x, y) => y.sobreposicaoMin - x.sobreposicaoMin);
}

/**
 * Primeiro buraco livre de pelo menos `minimoMin` depois de `depoisDe`, dentro
 * do horário comercial. Serve pra secretária já chegar com proposta — avisar
 * do conflito sem sugerir saída é dar trabalho, não tirar.
 */
export function primeiroBuraco(
  eventos: EventoAgenda[],
  depoisDe: Date,
  minimoMin: number,
  fimDoDia: Date,
): Date | null {
  const ordenados = [...eventos]
    .filter((e) => e.fim.getTime() > depoisDe.getTime())
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  let cursor = depoisDe.getTime();
  for (const ev of ordenados) {
    if (ev.inicio.getTime() - cursor >= minimoMin * 60_000) return new Date(cursor);
    cursor = Math.max(cursor, ev.fim.getTime());
  }
  return fimDoDia.getTime() - cursor >= minimoMin * 60_000 ? new Date(cursor) : null;
}

// ─── carga da semana ────────────────────────────────────────────────────────

export interface CargaDia {
  /** 0 = domingo, igual a Date#getDay. */
  diaSemana: number;
  data: Date;
  minutosOcupados: number;
  compromissos: number;
}

/** Acima disto o dia entra como gargalo no card da semana. */
export const DIA_PESADO_MIN = 360;

/**
 * Minutos ocupados por dia, para os `dias` dias a partir de `inicio`.
 *
 * Soma união de intervalos, não duração bruta: duas reuniões sobrepostas de 1h
 * ocupam 1h do seu dia, não 2h. Sem isso, um dia com conflitos apareceria como
 * o mais cheio da semana só por causa da contagem dupla.
 */
export function cargaPorDia(eventos: EventoAgenda[], inicio: Date, dias: number): CargaDia[] {
  const resultado: CargaDia[] = [];

  for (let d = 0; d < dias; d++) {
    const diaInicio = new Date(inicio.getTime() + d * 24 * 3600_000);
    const diaFim = new Date(diaInicio.getTime() + 24 * 3600_000);

    const doDia = eventos
      .filter((e) => e.fim > diaInicio && e.inicio < diaFim)
      .map((e) => ({
        ini: Math.max(e.inicio.getTime(), diaInicio.getTime()),
        fim: Math.min(e.fim.getTime(), diaFim.getTime()),
      }))
      .sort((a, b) => a.ini - b.ini);

    let ocupado = 0;
    let fimAtual = 0;
    for (const it of doDia) {
      const ini = Math.max(it.ini, fimAtual);
      if (it.fim > ini) ocupado += it.fim - ini;
      fimAtual = Math.max(fimAtual, it.fim);
    }

    resultado.push({
      diaSemana: diaInicio.getDay(),
      data: diaInicio,
      minutosOcupados: Math.round(ocupado / 60_000),
      compromissos: doDia.length,
    });
  }
  return resultado;
}

// ─── tarefas atrasadas ──────────────────────────────────────────────────────

export interface TarefaAtrasada {
  titulo: string;
  diasAtraso: number;
}

/** Abaixo disto não vale um card — vira ruído semanal. */
export const MIN_TAREFAS_ATRASADAS = 3;

/**
 * Ordena por atraso e corta no limite. Devolve `null` quando não vale avisar —
 * a regra de silêncio é a mesma dos outros: se não tem o que dizer, não fala.
 */
export function priorizaAtrasadas(
  tarefas: TarefaAtrasada[],
  maximo = 5,
): TarefaAtrasada[] | null {
  const atrasadas = tarefas.filter((t) => t.diasAtraso > 0);
  if (atrasadas.length < MIN_TAREFAS_ATRASADAS) return null;
  return [...atrasadas].sort((a, b) => b.diasAtraso - a.diasAtraso).slice(0, maximo);
}

export function duracaoTexto(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
